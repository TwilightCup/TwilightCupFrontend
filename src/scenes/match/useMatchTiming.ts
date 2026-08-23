/**
 * 比赛详情场景计时中枢：双方计时器数值 + 多关偏差条的实时计算。
 *
 * 数据来自 director store 的 player_status（关卡完成 / 尝试明细）。多关模式下
 * 关卡完成事件之间没有后端计时推送，偏差条以「开赛墙钟」外推落后方的实时耗时：
 *   - 锚点关卡 L = 双方任一已完成的最高 level_index；
 *   - 双方都完成 L → 偏差 = 双方在 L 的累计耗时之差（静态，落后方过关瞬间定格）；
 *   - 仅一方完成 L → 偏差 = 落后方实时外推耗时 − 领先方在 L 的累计耗时
 *     （领先方过关后随墙钟累加；落后方过关时收敛为其真实差值，领先方再度
 *     过关则游标回退，被反超时越过中线——与需求 4.2 的追逐语义一致）。
 * 开赛墙钟在 round_start 时锚定，此后每次关卡完成事件按「到达时刻 − 累计耗时」
 * 校准（吸收消息延迟与中途接入的漂移）；回合结束（round_result）即冻结外推。
 * 单关模式不外推：主计时器直接用后端成绩（最快 / 平均尝试）。
 */
import { computed, onUnmounted, ref, watch, type ComputedRef } from "vue";
import { AttemptStatus, type Attempt, type LevelTime } from "@/api/types";

/** 单侧计时器数值（展示格式化交给组件层） */
export interface SideTiming {
  /** 主计时器：多关 = 最近完成关卡的累计耗时；单关 = 后端成绩 */
  mainMs: number | null;
  /** 副计时器：多关 = 最近完成关卡的单段耗时；单关 = null（隐藏） */
  subMs: number | null;
}

/** 计时数据源（scene 层把 director store / mock 折算成这几个 getter） */
export interface MatchTimingSource {
  /** 多关选图模式（偏差条显隐 + 计时器口径） */
  isMulti: () => boolean;
  /** 某侧已完成关卡列表（多关） */
  levelsOf: (side: "A" | "B") => LevelTime[];
  /** 某侧尝试明细（单关） */
  attemptsOf: (side: "A" | "B") => Attempt[];
  /** 计分制（空串按 FASTEST 兜底） */
  scoring: () => "FASTEST" | "AVERAGE" | "";
  /** 回合权威成绩（round_result 下发；单关回合结束后优先展示），无则 null */
  scoreOf: (side: "A" | "B") => number | null;
  /** 当前回合标识（变化 = 新回合开赛，重锚墙钟） */
  roundKey: () => string | null;
  /** 回合是否进行中（false 时冻结墙钟外推） */
  running: () => boolean;
  /** 是否启用墙钟外推（mock 静态演示时为 false） */
  liveClock: () => boolean;
}

/** 最近完成关卡（level_index 最高）的累计 / 单段耗时；累计优先 total_ms，缺省回退求和 */
function lastLevel(levels: LevelTime[]): { idx: number; cum: number; seg: number } | null {
  if (!levels.length) return null;
  const idx = levels.reduce((m, l) => Math.max(m, l.level_index), -1);
  const upTo = levels.filter((l) => l.level_index <= idx);
  const sum = upTo.reduce((s, l) => s + l.time_ms, 0);
  const hit = upTo.find((l) => l.level_index === idx)!;
  return { idx, cum: hit.total_ms ?? sum, seg: hit.time_ms };
}

/** 单关成绩：FASTEST = 最快有效尝试；AVERAGE = 有效尝试平均（口径对齐后端计分制） */
function attemptScore(
  attempts: Attempt[],
  method: "FASTEST" | "AVERAGE",
): number | null {
  const times = attempts
    .filter((a) => a.status === AttemptStatus.VALID && a.time_ms != null)
    .map((a) => a.time_ms as number);
  if (!times.length) return null;
  if (method === "AVERAGE") {
    return Math.round(times.reduce((s, v) => s + v, 0) / times.length);
  }
  return Math.min(...times);
}

export function useMatchTiming(src: MatchTimingSource): {
  sideA: ComputedRef<SideTiming>;
  sideB: ComputedRef<SideTiming>;
  /** 偏差条数值（有符号：正 = B 落后，游标向 B 侧；负 = A 落后） */
  diffMs: ComputedRef<number>;
} {
  const lastA = computed(() => lastLevel(src.levelsOf("A")));
  const lastB = computed(() => lastLevel(src.levelsOf("B")));

  const method = computed<"FASTEST" | "AVERAGE">(() => src.scoring() || "FASTEST");

  function multiSide(last: { cum: number; seg: number } | null): SideTiming {
    return { mainMs: last ? last.cum : 0, subMs: last ? last.seg : null };
  }
  function singleSide(side: "A" | "B"): SideTiming {
    return {
      mainMs: src.scoreOf(side) ?? attemptScore(src.attemptsOf(side), method.value),
      subMs: null,
    };
  }
  const sideA = computed(() => (src.isMulti() ? multiSide(lastA.value) : singleSide("A")));
  const sideB = computed(() => (src.isMulti() ? multiSide(lastB.value) : singleSide("B")));

  // ---- 开赛墙钟（外推落后方实时耗时用） ----
  /** 开赛锚点（Date.now() 时刻）；null = 未知（未开赛 / 中途接入尚未校准） */
  let anchorWall: number | null = null;
  /** 回合结束后冻结的外推耗时；null = 进行中（未冻结） */
  const frozenElapsed = ref<number | null>(null);
  /** 节拍现在时刻（仅 running 时推进，供 computed 响应） */
  const now = ref(Date.now());

  /** 双方最高累计耗时（无锚点时的外推近似下限） */
  const maxCum = computed(() => Math.max(lastA.value?.cum ?? 0, lastB.value?.cum ?? 0));

  function elapsed(): number {
    if (frozenElapsed.value !== null) return frozenElapsed.value;
    if (anchorWall !== null && src.liveClock()) return now.value - anchorWall;
    return maxCum.value;
  }

  // 50ms 节拍：偏差值厘秒位的平滑刷新
  const timer = window.setInterval(() => {
    if (src.running() && src.liveClock()) now.value = Date.now();
  }, 50);
  onUnmounted(() => window.clearInterval(timer));

  // 新回合开赛：重锚 + 解冻 + 重置完成关卡跟踪（回合结束冻结在 running 的 watch 里）
  watch(
    () => src.roundKey(),
    (key, old) => {
      frozenElapsed.value = null;
      seenIdxA = -1;
      seenIdxB = -1;
      if (key && key !== old) anchorWall = Date.now();
    },
  );
  // 回合结束冻结外推 / 重新开始解冻
  watch(
    () => src.running(),
    (r) => {
      if (!r && frozenElapsed.value === null) frozenElapsed.value = elapsed();
      else if (r) frozenElapsed.value = null;
    },
  );
  // 关卡完成事件校准锚点：增量过关（或无锚点时的首见快照）按到达时刻回推开赛时刻
  let seenIdxA = -1;
  let seenIdxB = -1;
  function calibrate(side: "A" | "B", last: { idx: number; cum: number } | null): void {
    if (!last || !src.liveClock()) return;
    const seen = side === "A" ? seenIdxA : seenIdxB;
    if (side === "A") seenIdxA = last.idx;
    else seenIdxB = last.idx;
    const fresh = (seen >= 0 && last.idx > seen) || anchorWall === null;
    if (fresh) anchorWall = Date.now() - last.cum;
  }
  watch(lastA, (l) => calibrate("A", l));
  watch(lastB, (l) => calibrate("B", l));

  const diffMs = computed<number>(() => {
    const a = lastA.value;
    const b = lastB.value;
    if (!a && !b) return 0;
    if (!a) return -(elapsed() - b!.cum); // 仅 B 过关：A 落后 → 负（向 A）
    if (!b) return elapsed() - a.cum; // 仅 A 过关：B 落后 → 正（向 B）
    if (a.idx === b.idx) return b.cum - a.cum; // 双方同关：静态差（正 = B 慢）
    return a.idx > b.idx ? elapsed() - a.cum : -(elapsed() - b.cum); // 高者领先
  });

  return { sideA, sideB, diffMs };
}
