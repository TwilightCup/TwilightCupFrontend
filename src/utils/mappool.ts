/**
 * 图池领域工具：类别识别、CT 词条编解码 / 冲突检测、规范化与校验。
 *
 * 后端 Pick/Category 为 extra=ignore（见 TwilightCupBackend datatypes.py），
 * 故 CT 的结构化词条必须编码进既有 `tag` 字段才能往返持久化：
 *   - CT 选图：`tag` = 逗号分隔的词条串（如 "Glitchless,Checkpoint"）。
 *   - 前端 `Pick.tags` / `Pick.isTiebreaker` 为不入库的派生字段，由此处 normalize 填充。
 */
import {
  CATEGORY_KINDS,
  CT_TAGS,
  CT_TAG_ACHIEVEMENT,
  CT_TAG_CONFLICTS,
  CategoryKind,
  type Category,
  type CategoryKind as CK,
  type Mappool,
  type Pick,
} from "@/api/types";
import { t as tr } from "@/locales";
import { officialLevelBg, officialLevelIdOf } from "@/utils/officialLevels";

/** 把类别名（如 "ml"/"ML "）归一为固定 kind；无法识别返回 null（视作普通分组，不参与 ban/pick 规则）。 */
export function categoryKindOf(name?: string | null): CK | null {
  if (!name) return null;
  const k = name.trim().toUpperCase();
  return (CATEGORY_KINDS as readonly string[]).includes(k) ? (k as CK) : null;
}

/** CT 基础词条（可变数组，便于多选组件消费）。 */
export const CT_TAG_BASE: string[] = [...CT_TAGS];

/** 单关 CT 选图可选的词条集合（基础 + Achievement）。 */
export function ctTagsFor(single: boolean): string[] {
  return single ? [...CT_TAG_BASE, CT_TAG_ACHIEVEMENT] : [...CT_TAG_BASE];
}

/**
 * 选图默认背景图：无自定义展示图（logo_url）时按名称回退官方关卡背景。
 * 名称解析（容忍「Carry 12」「Dark% CP」这类带重试/模式后缀的写法，取整串与首词分别匹配）：
 * - 「Any%」→ Ice（全游戏流程，以 Ice 作视觉代表）；
 * - 「X%」→ X 对应关卡（X 为官方展示名，如 Dark → Halloween）；
 * - 单关「X …」→ X 对应关卡背景（如 Red Rock → RedRock）。
 * 未命中（自定义名 / 非官方关）→ null，卡片回退类别色底。
 */
export function pickDefaultBg(pick: Pick): string | null {
  const name = pick.name.trim();
  if (!name) return null;
  const first = name.split(/\s+/)[0]!;
  for (const cand of [name, first]) {
    const key = cand.endsWith("%") ? cand.slice(0, -1) : cand;
    if (!key) continue;
    if (key === "Any") return officialLevelBg("Ice");
    const id = officialLevelIdOf(key);
    if (id) {
      const bg = officialLevelBg(id);
      if (bg) return bg;
    }
  }
  return null;
}

/** 类别 → 选图卡左侧类别色块底色（高对比亮色；图池 MapCard 与比赛详情选图角标共用）。 */
export function categoryTagBg(kind: string | null | undefined): string {
  switch (kind) {
    case CategoryKind.ML:
      return "#2f6fe0";
    case CategoryKind.IL:
      return "#1f9d61";
    case CategoryKind.CP:
      return "#d98324";
    case CategoryKind.CT:
      return "#d13a55";
    case CategoryKind.EX:
      return "#7a4fd6";
    case CategoryKind.TB:
      return "#ffd166";
    default:
      return "#4a4460";
  }
}

/** 类别 → 选图卡无背景图时的占位底色（暗色系）。 */
export function categoryBgFallback(kind: string | null | undefined): string {
  switch (kind) {
    case CategoryKind.ML:
      return "#1b3a6b";
    case CategoryKind.IL:
      return "#1d4d36";
    case CategoryKind.CP:
      return "#5a3a12";
    case CategoryKind.CT:
      return "#5a1620";
    case CategoryKind.TB:
      return "#4a0f2a";
    default:
      return "#33313f";
  }
}

/** 解码 `Pick.tag` 为 CT 词条数组（仅保留已知枚举值；兼容旧自由文本→空数组）。 */
export function pickTagsOf(pick: Pick): string[] {
  const raw = pick.tag;
  if (!raw) return [];
  const known = new Set<string>([...CT_TAG_BASE, CT_TAG_ACHIEVEMENT]);
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && known.has(s));
}

/** 编码词条数组为 `tag` 字段串（空数组→null）。 */
export function encodePickTags(tags: string[] | null | undefined): string | null {
  if (!tags || tags.length === 0) return null;
  return tags.filter((t) => t.trim()).join(",");
}

/** 给定词条集合是否存在已知冲突对（如 Checkpoint + No Checkpoint）。 */
export function hasTagConflict(tags: string[]): boolean {
  const set = new Set(tags);
  return CT_TAG_CONFLICTS.some(([a, b]) => set.has(a) && set.has(b));
}

/**
 * 规范化图池（不修改入参，返回深拷贝）：
 *  - 类别按 CATEGORY_KINDS 顺序排序（未知 kind 排到末尾，保持原相对顺序）；
 *  - 每个选图填充派生 `tags`（CT）/ `isTiebreaker`（TB）；
 *  - CT 选图 `category` 字段对齐为父类别 kind。
 */
export function normalizeMappool(m: Mappool): Mappool {
  const cats = m.categories.map((c) => {
    const kind = categoryKindOf(c.name);
    return {
      name: c.name,
      picks: c.picks.map((p) => normalizePick(p, kind)),
    };
  });
  cats.sort((a, b) => {
    const ia = indexOfKind(a.name);
    const ib = indexOfKind(b.name);
    return ia - ib;
  });
  return { categories: cats };
}

function indexOfKind(name: string): number {
  const k = categoryKindOf(name);
  return k ? CATEGORY_KINDS.indexOf(k) : CATEGORY_KINDS.length;
}

/** 填充单个选图的派生字段（tags / isTiebreaker），并按 kind 校正 category。 */
export function normalizePick(pick: Pick, kind: CK | null): Pick {
  const tags = kind === CategoryKind.CT ? pickTagsOf(pick) : [];
  return {
    ...pick,
    tags,
    isTiebreaker: kind === CategoryKind.TB,
    category: kind ?? pick.category ?? null,
  };
}

/** 全图池选图扁平列表。 */
export function allPicks(m: Mappool): Pick[] {
  return m.categories.flatMap((c) => c.picks);
}

/** 取指定 kind 的类别（不存在返回 null）。 */
export function categoryOf(m: Mappool, kind: CK): Category | null {
  return m.categories.find((c) => categoryKindOf(c.name) === kind) ?? null;
}

export interface MappoolIssue {
  level: "error" | "warn";
  msg: string;
}

/**
 * 校验图池合法性（MatchFormDialog 提交前 / 草稿引擎载入前用）。
 * 返回 issue 列表（空表示通过）。规则依文档：
 *  - 选图 code 全图池唯一；
 *  - 每个类别 ≥1 选图；
 *  - TB 类别最多 1 个、恰好 1 个选图；
 *  - CT 选图词条在枚举内且无冲突（0-2 个）。
 */
export function validateMappool(m: Mappool): MappoolIssue[] {
  const issues: MappoolIssue[] = [];
  const picks = allPicks(m);

  // code 唯一性
  const seen = new Map<string, number>();
  for (const p of picks) {
    const code = (p.code ?? "").trim();
    if (!code) {
      issues.push({ level: "error", msg: tr("mappoolValidate.missingCode") });
      continue;
    }
    seen.set(code, (seen.get(code) ?? 0) + 1);
  }
  for (const [code, n] of seen) {
    if (n > 1) issues.push({ level: "error", msg: tr("mappoolValidate.duplicateCode", { code, n }) });
  }

  // 类别选图数
  for (const c of m.categories) {
    const kind = categoryKindOf(c.name);
    if (c.picks.length === 0) {
      issues.push({ level: "error", msg: tr("mappoolValidate.emptyCategory", { name: c.name }) });
    }
    if (kind === CategoryKind.TB && c.picks.length > 1) {
      issues.push({ level: "error", msg: tr("mappoolValidate.tbOnlyOne") });
    }
  }

  // CT 选图词条
  for (const p of picks) {
    const tags = pickTagsOf(p);
    if (tags.length === 0) continue;
    if (tags.length > 2) {
      issues.push({ level: "error", msg: tr("mappoolValidate.tagTooMany", { code: p.code }) });
    }
    if (hasTagConflict(tags)) {
      issues.push({
        level: "error",
        msg: tr("mappoolValidate.tagConflict", { code: p.code }),
      });
    }
  }
  return issues;
}
