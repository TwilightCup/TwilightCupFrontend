/**
 * 比赛详情场景计时中枢：双方计时器数值。
 *
 * 多关主计时 = live_time 实时走表（选手端每秒上报真实计时器累计读数，
 * useLiveTimers 两次上报间墙钟外推 + 新样本矫正；无上报 / 回合外回退
 * 最近完成关卡的累计耗时）；副计时 = 最近完成关卡的单段耗时（离线口径，
 * 不随 live_time 走）。单关主计时 = 回合权威成绩（无则按计分制折算尝试
 * 明细：最快 / 平均）。单关副计时 = 当前尝试的实时分段时间（live_time
 * segment，见 MatchScene / useLiveTimers）+ 上一次尝试的离线成绩（这里只算
 * 上一次尝试，当前尝试实时值由上层 liveSeg 提供）。
 *
 * 多关偏差条不在此计算——已改由 subsegment 实时时间差驱动（subsegment_gap
 * 广播 → director store.subsegmentGap → DiffBar，双方 TwilightTimer 时间线与
 * 计分同源，见 ignored/需求-subsegment实时时间差追踪与前端接入.md）。
 */
import { computed, type ComputedRef } from "vue";
import { AttemptStatus, type Attempt, type LevelTime } from "@/api/types";

/** 单侧计时器数值（展示格式化交给组件层） */
export interface SideTiming {
  /** 主计时器：多关 = live_time 实时走表（回退最近完成关卡累计）；单关 = 后端成绩 */
  mainMs: number | null;
  /** 副计时器：多关 = 最近完成关卡的单段耗时；单关 = 上一次尝试（最近一次已上报）
   *  的用时；当前尝试实时分段时间由上层 liveSeg 单独提供 */
  subMs: number | null;
}

/** 计时数据源（scene 层把 director store / mock 折算成这几个 getter） */
export interface MatchTimingSource {
  /** 多关选图模式（计时器口径） */
  isMulti: () => boolean;
  /** 多关主计时实时走表值（live_time 外推，毫秒）；null = 无实时数据，回退离线口径 */
  liveOf: (side: "A" | "B") => number | null;
  /** 某侧已完成关卡列表（多关） */
  levelsOf: (side: "A" | "B") => LevelTime[];
  /** 某侧尝试明细（单关） */
  attemptsOf: (side: "A" | "B") => Attempt[];
  /** 计分制（空串按 FASTEST 兜底） */
  scoring: () => "FASTEST" | "AVERAGE" | "";
  /** 回合权威成绩（round_result 下发；单关回合结束后优先展示），无则 null */
  scoreOf: (side: "A" | "B") => number | null;
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

/** 单关上一次尝试：取最近一条带用时的尝试（跳过/未完成无成绩不计入） */
function lastAttemptMs(attempts: Attempt[]): number | null {
  const withTime = attempts
    .filter((a) => a.time_ms != null)
    .sort((a, b) => a.index - b.index);
  const last = withTime[withTime.length - 1];
  return last?.time_ms ?? null;
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
} {
  const lastA = computed(() => lastLevel(src.levelsOf("A")));
  const lastB = computed(() => lastLevel(src.levelsOf("B")));

  const method = computed<"FASTEST" | "AVERAGE">(() => src.scoring() || "FASTEST");

  function multiSide(
    side: "A" | "B",
    last: { cum: number; seg: number } | null,
  ): SideTiming {
    return {
      // 实时走表优先；无 live_time（插件未升级 / 回合外）回退离线累计口径
      mainMs: src.liveOf(side) ?? (last ? last.cum : 0),
      subMs: last ? last.seg : null,
    };
  }
  function singleSide(side: "A" | "B"): SideTiming {
    return {
      mainMs: src.scoreOf(side) ?? attemptScore(src.attemptsOf(side), method.value),
      // 当前尝试的实时分段时间由上层 liveSeg 提供；这里给下行“上一次尝试”用时
      subMs: lastAttemptMs(src.attemptsOf(side)),
    };
  }
  const sideA = computed(() => (src.isMulti() ? multiSide("A", lastA.value) : singleSide("A")));
  const sideB = computed(() => (src.isMulti() ? multiSide("B", lastB.value) : singleSide("B")));

  return { sideA, sideB };
}
