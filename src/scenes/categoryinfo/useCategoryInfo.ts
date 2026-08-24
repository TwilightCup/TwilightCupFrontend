/**
 * 项目信息场景数据 hook：watch 当前选图 → 解析 speedrun.com 榜单参数并拉取
 * Top N，把本场双方选手（speedrun.com 绑定）在榜单中的行标出高亮。
 *
 * 榜单参数两级解析：图池编辑器配置的显式映射（pick.speedrun_*）优先；
 * 未配置时按杯赛规则自动解析（多关→名称匹配全游戏 % 项目；单关→关卡名经
 * 官方展示名对照匹配 IL；子分类 Solo 默认，Glitchless 取标题、其余取词条，
 * 见 utils/speedrunResolve.ts）。
 *
 * - pick_announced 与 round_start 会先后两次写入 currentRound：按
 *   code + 名称 + 词条 + 映射字段计算 key，相同不重拉（另加 300ms 防抖）。
 * - 绑定解析（/users?lookup=）与榜单拉取互不阻塞：绑定迟到只重算高亮、
 *   不重新请求榜单。
 * - 限流（HTTP 420）/网络失败 → error 状态，不自动重试，待下次选图再拉。
 * - 后续扩展位：选手当前项目 PB（fetchUserPb）——榜单行高亮之外为未上榜
 *   选手展示 PB，数据层在此 hook 内加一路 resolveUser + personal-bests 即可。
 */
import { computed, ref, watch, type Ref } from "vue";
import type { Pick } from "@/api/types";
import { LEADERBOARD_TOP, SpeedrunError, fetchLeaderboard, resolveUser } from "@/api/speedrun";
import { resolveSpeedrunBoard } from "@/utils/speedrunResolve";

/** 当前回合的解析输入：pick + 消息级 collection（关卡已展开为名字）。 */
export interface CategoryInfoRound {
  pick: Pick;
  collection?: { raw: Record<string, unknown> } | null;
}

/** 榜单行（timeSec 为 speedrun.com primary_t 秒口径） */
export interface CategoryRow {
  place: number;
  playerName: string;
  userId: string | null;
  timeSec: number;
  highlight: "A" | "B" | null;
}

export type CategoryInfoStatus =
  | "idle" // 无选图（等待裁判宣布）
  | "loading"
  | "ok"
  | "noMapping" // 选图未配置 speedrun 映射 → 占位卡
  | "error" // 网络 / HTTP 失败
  | "rateLimit"; // speedrun.com 限流（420）

/** 回合变化判据：code + 名称 + 词条 + 关卡序列 + 三个映射字段（均为解析输入）。 */
function roundKey(round: CategoryInfoRound | null): string {
  if (!round) return "";
  const pick = round.pick;
  const vars = Object.entries(pick.speedrun_variables ?? {})
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}:${v}`)
    .join(",");
  const levels = ((round.collection?.raw as { levels?: unknown[] })?.levels ?? [])
    .map((x) => String(x ?? ""))
    .join(",");
  return [
    pick.code,
    pick.name ?? "",
    (pick.tags ?? []).join(","),
    levels,
    pick.speedrun_category_id ?? "",
    pick.speedrun_level_id ?? "",
    vars,
  ].join("|");
}

export function useCategoryInfo(
  roundRef: Ref<CategoryInfoRound | null>,
  bindA: Ref<string | null>,
  bindB: Ref<string | null>,
): {
  status: Ref<CategoryInfoStatus>;
  rows: Ref<CategoryRow[]>;
  refreshedAt: Ref<number | null>;
  /** 失败时的诊断信息（错误卡小字展示；成功时为空） */
  errDetail: Ref<string>;
} {
  const status = ref<CategoryInfoStatus>("idle");
  const rawRows = ref<CategoryRow[]>([]);
  const refreshedAt = ref<number | null>(null);
  const errDetail = ref("");

  // ── 榜单拉取（防抖 300ms；相同 key 不重拉） ────────────────────────
  let lastKey = "";
  let timer: ReturnType<typeof setTimeout> | null = null;

  /** 统一失败处理：限流与一般错误分流 + 记录诊断信息。 */
  function fail(err: unknown): void {
    rawRows.value = [];
    refreshedAt.value = null;
    errDetail.value = err instanceof Error ? err.message : String(err);
    // eslint-disable-next-line no-console -- OBS 现场排障靠控制台
    console.error("[categoryinfo] speedrun 拉取失败:", err);
    status.value =
      err instanceof SpeedrunError && err.kind === "rate-limit" ? "rateLimit" : "error";
  }

  async function load(round: CategoryInfoRound): Promise<void> {
    const pick = round.pick;
    status.value = "loading";
    errDetail.value = "";
    // 榜单参数：显式映射优先；未配置则按杯赛规则自动解析（含消息级 collection）
    let board = pick.speedrun_category_id
      ? {
          categoryId: pick.speedrun_category_id,
          levelId: pick.speedrun_level_id ?? null,
          variables: pick.speedrun_variables ?? {},
        }
      : null;
    if (!board) {
      try {
        board = await resolveSpeedrunBoard(pick, round.collection ?? null);
      } catch (err) {
        fail(err);
        return;
      }
      if (!board) {
        status.value = "noMapping";
        rawRows.value = [];
        refreshedAt.value = null;
        return;
      }
    }
    try {
      const rows = await fetchLeaderboard({
        categoryId: board.categoryId,
        levelId: board.levelId,
        variables: board.variables,
        top: LEADERBOARD_TOP,
      });
      rawRows.value = rows.map((r) => ({ ...r, highlight: null }));
      refreshedAt.value = Date.now();
      status.value = "ok";
    } catch (err) {
      fail(err);
    }
  }

  watch(
    roundRef,
    (round) => {
      if (timer) clearTimeout(timer);
      if (!round) {
        lastKey = "";
        status.value = "idle";
        rawRows.value = [];
        refreshedAt.value = null;
        return;
      }
      const key = roundKey(round);
      if (key === lastKey) return;
      lastKey = key;
      timer = setTimeout(() => void load(round), 300);
    },
    { immediate: true },
  );

  // ── 选手绑定 → 高亮（解析失败/未上榜静默缺失，不阻塞榜单） ──────────
  const resolvedA = ref<{ id: string; name: string } | null>(null);
  const resolvedB = ref<{ id: string; name: string } | null>(null);

  async function resolveBind(
    lookup: string | null,
    into: Ref<{ id: string; name: string } | null>,
  ): Promise<void> {
    if (!lookup) {
      into.value = null;
      return;
    }
    try {
      into.value = await resolveUser(lookup);
    } catch {
      into.value = null; // 解析失败回退：按原始绑定串匹配名字
    }
  }

  watch(bindA, (v) => void resolveBind(v, resolvedA), { immediate: true });
  watch(bindB, (v) => void resolveBind(v, resolvedB), { immediate: true });

  /** 行 → 选手方：优先解析出的 userId 相等；回退展示名与绑定串全等（不区分大小写）。 */
  const rows = computed<CategoryRow[]>(() =>
    rawRows.value.map((r) => {
      const hit = (resolved: { id: string; name: string } | null, raw: string | null): boolean => {
        if (resolved) {
          if (r.userId && r.userId === resolved.id) return true;
          if (r.playerName.toLowerCase() === resolved.name.toLowerCase()) return true;
        }
        return !!raw && r.playerName.toLowerCase() === raw.trim().toLowerCase();
      };
      const highlight = hit(resolvedA.value, bindA.value)
        ? ("A" as const)
        : hit(resolvedB.value, bindB.value)
          ? ("B" as const)
          : null;
      return { ...r, highlight };
    }),
  );

  return { status, rows, refreshedAt, errDetail };
}
