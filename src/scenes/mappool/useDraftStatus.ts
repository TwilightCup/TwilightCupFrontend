/**
 * 图池场景的 ban/pick 草稿状态解析。
 *
 * 数据源：director store 的 draft ref（WS `draft_state` 广播，裁判端 draft_sync 原样
 * 转发），形状对齐裁判端 src/stores/draft.ts 的 DraftState。此处做防御性解析——
 * 形状不对/字段缺失一律得空状态，绝不让 OBS 画面抛错。
 *
 * 「回合重置」语义：picks 跨回合累积，每条 pick 携带的词条按 code 持久记录
 * （选图卡片右下角的词条角标据此整场显示）；词条板的高亮只取当前回合
 * activePick 的词条并由消费侧按阶段门控复位，新 pick 到来后上一回合的
 * 词条自动回默认，无需额外清理逻辑。
 */
import { computed, type ComputedRef } from "vue";

import type { Pick } from "@/api/types";

/** 单个选图的终态（ban / pick 互斥，规则上每 code 至多一条；protect 单独跟踪） */
export interface PickCardStatus {
  kind: "ban" | "pick";
  by: "A" | "B";
}

export interface DraftStatus {
  /** code → 终态 */
  statusByCode: Map<string, PickCardStatus>;
  /** code → protect 方（protect 整场有效，pick 后仍保留角标叠加显示） */
  protectedByCode: Map<string, "A" | "B">;
  /** code → 裁判指定的重试次数（无则 undefined，卡片回退 pick.retry_count） */
  retryByCode: Map<string, number | undefined>;
  /** picks 最后一条的 code（当前回合）；无 pick 过为 null */
  activePickCode: string | null;
  /** TAG_BAN 环节禁用的词条（整场有效） */
  bannedTags: string[];
  /** 各方 ban 的词条（TAG_BAN 环节每方一个；供词条板按选手色划线） */
  tagBanBy: { A: string | null; B: string | null };
  /** code → 该选图被 pick 时携带的词条（跨回合持久，不随回合重置） */
  pickedTagsByCode: Map<string, string[]>;
}

const EMPTY: DraftStatus = {
  statusByCode: new Map(),
  protectedByCode: new Map(),
  retryByCode: new Map(),
  activePickCode: null,
  bannedTags: [],
  tagBanBy: { A: null, B: null },
  pickedTagsByCode: new Map(),
};

interface RawAction {
  by?: unknown;
  code?: unknown;
  kind?: unknown;
}
interface RawPick {
  by?: unknown;
  code?: unknown;
  tags?: unknown;
  retry?: unknown;
}

function isSide(v: unknown): v is "A" | "B" {
  return v === "A" || v === "B";
}
function isActionKind(v: unknown): v is "ban" | "protect" {
  return v === "ban" || v === "protect";
}

/** 解析一份 draft payload 为展示状态（null / 形状不对 → 空状态） */
export function parseDraftStatus(raw: unknown): DraftStatus {
  if (!raw || typeof raw !== "object") return EMPTY;

  const statusByCode = new Map<string, PickCardStatus>();
  const retryByCode = new Map<string, number | undefined>();
  const pickedTagsByCode = new Map<string, string[]>();
  let activePickCode: string | null = null;

  // 1) ban / protect 动作（后到的覆盖先到的；规则上同 code 不会重复操作）。
  //    ban 入终态；protect 单独跟踪（pick 后仍保留，卡片角标持续显示）
  const actions = Array.isArray((raw as { actions?: unknown }).actions)
    ? ((raw as { actions: unknown[] }).actions as RawAction[])
    : [];
  const protectedByCode = new Map<string, "A" | "B">();
  for (const a of actions) {
    if (!a || typeof a.code !== "string" || !isSide(a.by) || !isActionKind(a.kind))
      continue;
    if (a.kind === "ban") statusByCode.set(a.code, { kind: "ban", by: a.by });
    else protectedByCode.set(a.code, a.by);
  }

  // 2) picks（跨回合累积）：终态 pick + 重试次数 + 词条（每条 pick 携带的
  //    词条按 code 持久记录、跨回合不复位；词条板的「回合重置」由消费侧
  //    只取 activePick + 阶段门控实现，与此处持久数据无关）
  const picks = Array.isArray((raw as { picks?: unknown }).picks)
    ? ((raw as { picks: unknown[] }).picks as RawPick[])
    : [];
  for (const p of picks) {
    if (!p || typeof p.code !== "string" || !isSide(p.by)) continue;
    statusByCode.set(p.code, { kind: "pick", by: p.by });
    if (typeof p.retry === "number") retryByCode.set(p.code, p.retry);
    if (Array.isArray(p.tags)) {
      const tags = p.tags.filter((t): t is string => typeof t === "string");
      if (tags.length) pickedTagsByCode.set(p.code, tags);
    }
    activePickCode = p.code; // 最后一条即当前回合
  }

  // 3) TAG_BAN 禁用词条 + 各方归属（划线按选手色）
  const rawTags = (raw as { bannedTags?: unknown }).bannedTags;
  const bannedTags = Array.isArray(rawTags)
    ? rawTags.filter((t): t is string => typeof t === "string")
    : [];
  const rawBanBy = (raw as { tagBanBy?: unknown }).tagBanBy;
  const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
  const tagBanBy =
    rawBanBy && typeof rawBanBy === "object"
      ? {
          A: str((rawBanBy as { A?: unknown }).A),
          B: str((rawBanBy as { B?: unknown }).B),
        }
      : { A: null, B: null };

  return { statusByCode, protectedByCode, retryByCode, activePickCode, bannedTags, tagBanBy, pickedTagsByCode };
}

/** 图池卡片可消费的组合入口：响应式解析 draft ref（null-safe）。 */
export function useDraftStatus(
  draft: ComputedRef<Record<string, unknown> | null> | { value: Record<string, unknown> | null },
): ComputedRef<DraftStatus> {
  return computed(() => parseDraftStatus(draft.value));
}

/** 卡片取重试次数：draft 指定值优先，否则回退选图自身的 retry_count。 */
export function retryOf(draft: DraftStatus, pick: Pick): number | null {
  if (draft.retryByCode.has(pick.code)) return draft.retryByCode.get(pick.code) ?? null;
  return pick.retry_count ?? null;
}
