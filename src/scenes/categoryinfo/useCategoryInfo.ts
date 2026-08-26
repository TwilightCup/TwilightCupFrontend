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
import { computed, onUnmounted, ref, watch, type Ref } from "vue";
import type { Pick } from "@/api/types";
import {
  LEADERBOARD_TOP,
  SPEEDRUN_GAMES,
  SpeedrunError,
  fetchLeaderboard,
  fetchUserPb,
  resolveUser,
  type SrPersonalBest,
} from "@/api/speedrun";
import {
  describeBoard,
  resolveSpeedrunBoard,
  type BoardDisplay,
} from "@/utils/speedrunResolve";

/** 当前回合的解析输入：pick + 消息级 collection（关卡已展开为名字）。 */
export interface CategoryInfoRound {
  pick: Pick;
  collection?: { raw: Record<string, unknown> } | null;
}

/**
 * 最近一次榜单快照（模块级，跨组件挂载存活）：舞台切场景会重挂载场景
 * 组件，同一选图重进时先同步回显快照（零加载直接出榜），再后台静默刷新。
 */
interface BoardSnapshot {
  key: string;
  status: "ok" | "noMapping";
  rows: CategoryRow[];
  display: BoardDisplay | null;
  refreshedAt: number | null;
  /** 榜单参数（回显时恢复，PB 拉取即刻可用） */
  board: {
    gameId: string;
    categoryId: string;
    levelId: string | null;
    variables: Record<string, string>;
  } | null;
}
let snapshot: BoardSnapshot | null = null;

/** 榜单行（timeSec 为 speedrun.com primary_t 秒口径；date 为 "YYYY-MM-DD"） */
export interface CategoryRow {
  place: number;
  playerName: string;
  userId: string | null;
  timeSec: number;
  date: string | null;
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
  /** 榜单展示信息（项目名面板用：分类/关卡名 + 已选子分类值标签） */
  boardDisplay: Ref<BoardDisplay | null>;
  /**
   * 选手当前项目 PB（personal-bests 口径，未进 Top 15 也有）。
   * 三态：undefined = 待拉取（裁判宣布选图后立即置此态，画面显示空串）；
   * null = 已拉取但无成绩（N/A）；对象 = PB 数据。
   */
  pbA: Ref<SrPersonalBest | null | undefined>;
  pbB: Ref<SrPersonalBest | null | undefined>;
} {
  const status = ref<CategoryInfoStatus>("idle");
  const rawRows = ref<CategoryRow[]>([]);
  const refreshedAt = ref<number | null>(null);
  const errDetail = ref("");
  const boardDisplay = ref<BoardDisplay | null>(null);
  /** 最近一次成功榜单的参数（PB 按项目过滤用；gameId 默认 HFF） */
  const boardParams = ref<{
    gameId: string;
    categoryId: string;
    levelId: string | null;
    variables: Record<string, string>;
  } | null>(null);
  const pbA = ref<SrPersonalBest | null | undefined>(undefined);
  const pbB = ref<SrPersonalBest | null | undefined>(undefined);

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

  /**
   * 拉取榜单。silent = 回显快照后的后台刷新：不动 status（不闪加载卡），
   * 失败也保留旧内容；成功则更新数据与快照。
   */
  async function load(round: CategoryInfoRound, key: string, silent: boolean): Promise<void> {
    const pick = round.pick;
    if (!silent) {
      status.value = "loading";
      errDetail.value = "";
      boardDisplay.value = null;
    }
    // 榜单参数：显式映射优先；未配置则按杯赛规则自动解析（含消息级 collection）
    let board: {
      gameId: string;
      categoryId: string;
      levelId: string | null;
      variables: Record<string, string>;
    } | null = pick.speedrun_category_id
      ? {
          gameId: SPEEDRUN_GAMES.hff,
          categoryId: pick.speedrun_category_id,
          levelId: pick.speedrun_level_id ?? null,
          variables: pick.speedrun_variables ?? {},
        }
      : null;
    let display: BoardDisplay | null = null;
    if (!board) {
      try {
        const resolved = await resolveSpeedrunBoard(pick, round.collection ?? null);
        if (!resolved) {
          status.value = "noMapping";
          rawRows.value = [];
          refreshedAt.value = null;
          boardParams.value = null;
          snapshot = {
            key,
            status: "noMapping",
            rows: [],
            display: null,
            refreshedAt: null,
            board: null,
          };
          return;
        }
        board = resolved;
        display = resolved.display;
      } catch (err) {
        if (!silent) fail(err);
        return;
      }
    }
    if (!board) return; // 类型收窄守卫（上方两条路径均已保证非空）
    try {
      const rows = await fetchLeaderboard({
        gameId: board.gameId,
        categoryId: board.categoryId,
        levelId: board.levelId,
        variables: board.variables,
        top: LEADERBOARD_TOP,
      });
      const at = Date.now();
      rawRows.value = rows.map((r) => ({ ...r, highlight: null }));
      refreshedAt.value = at;
      status.value = "ok";
      boardDisplay.value = display;
      boardParams.value = {
        gameId: board.gameId,
        categoryId: board.categoryId,
        levelId: board.levelId,
        variables: board.variables,
      };
      // 显式映射路径没有现成展示名：ids 反查（缓存查表，失败不阻塞榜单）
      if (!boardDisplay.value) {
        try {
          boardDisplay.value = await describeBoard(board);
        } catch {
          boardDisplay.value = null;
        }
      }
      snapshot = {
        key,
        status: "ok",
        rows: rawRows.value,
        display: boardDisplay.value,
        refreshedAt: at,
        board: boardParams.value,
      };
    } catch (err) {
      if (!silent) fail(err);
    }
  }

  // 挂载即回显：同一选图有快照时同步上屏（零加载，含榜单参数 → PB 即刻
  // 可拉），随后仅做静默刷新。注意：watch 的 immediate 触发会先执行回调，
  // 回调里 key 相同走提前返回——不能在提前返回前清理 timer，否则回显的
  // 静默刷新 timer 会被误清（PB 丢失的根因）。
  const initRound = roundRef.value;
  const initKey = roundKey(initRound);
  if (initRound && snapshot && snapshot.key === initKey) {
    lastKey = initKey;
    status.value = snapshot.status;
    rawRows.value = snapshot.rows;
    boardDisplay.value = snapshot.display;
    refreshedAt.value = snapshot.refreshedAt;
    boardParams.value = snapshot.board;
    timer = setTimeout(() => void load(initRound, initKey, true), 300);
  }

  watch(
    roundRef,
    (round) => {
      if (!round) {
        if (timer) clearTimeout(timer);
        lastKey = "";
        status.value = "idle";
        rawRows.value = [];
        refreshedAt.value = null;
        return;
      }
      const key = roundKey(round);
      // key 相同（含挂载回显场景）：不清理 timer——保住静默刷新
      if (key === lastKey) return;
      if (timer) clearTimeout(timer);
      lastKey = key;
      // 立即离开 idle（防抖期间也显示加载中）：舞台切场景重挂载组件且无
      // 快照可回显时，避免先闪一张「等待选图」卡
      status.value = "loading";
      // 新选图：PB 立即清空（待拉取态），拉到数据后再显示
      pbA.value = undefined;
      pbB.value = undefined;
      timer = setTimeout(() => void load(round, key, false), 300);
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

  // ── 选手当前项目 PB（personal-bests 口径：未进 Top 15 也有成绩） ────
  async function refreshPb(
    userId: string | null,
    into: Ref<SrPersonalBest | null | undefined>,
  ): Promise<void> {
    if (!boardParams.value) {
      into.value = undefined; // 榜单未就绪：保持待拉取（显示空串）
      return;
    }
    if (!userId) {
      into.value = null; // 未绑定 speedrun 账号：N/A
      return;
    }
    try {
      into.value = await fetchUserPb(userId, boardParams.value);
    } catch {
      into.value = undefined; // PB 非关键路径，失败保持待拉取（下次榜单再试）
    }
  }

  watch(
    [boardParams, resolvedA],
    () => void refreshPb(resolvedA.value?.id ?? null, pbA),
    { immediate: true },
  );
  watch(
    [boardParams, resolvedB],
    () => void refreshPb(resolvedB.value?.id ?? null, pbB),
    { immediate: true },
  );

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

  /** 手动/事件触发：绕过同 key 去重，重新拉当前选图的 speedrun 数据。 */
  function refresh(): void {
    const round = roundRef.value;
    if (!round) return;
    const key = roundKey(round);
    lastKey = key;
    if (timer) clearTimeout(timer);
    void load(round, key, false);
  }

  // 接收“重新拉取 speedrun”通知：同一页面 window 事件、同源标签页
  // BroadcastChannel、以及兼容 OBS CEF 的 localStorage storage 事件。
  const onRefresh = () => refresh();
  const storageKey = "twc-speedrun-refresh";
  const onStorage = (e: StorageEvent) => {
    if (e.key === storageKey) refresh();
  };
  let channel: BroadcastChannel | null = null;
  if (typeof BroadcastChannel !== "undefined") {
    try {
      channel = new BroadcastChannel("twc-speedrun-refresh");
      channel.onmessage = onRefresh;
    } catch {
      channel = null;
    }
  }
  globalThis.addEventListener("twc-speedrun-refresh", onRefresh);
  globalThis.addEventListener("storage", onStorage);
  onUnmounted(() => {
    globalThis.removeEventListener("twc-speedrun-refresh", onRefresh);
    globalThis.removeEventListener("storage", onStorage);
    channel?.close();
  });

  return { status, rows, refreshedAt, errDetail, boardDisplay, pbA, pbB, refresh };
}
