/**
 * 比赛详情场景计时中枢：双方计时器数值。
 *
 * 数据来自 director store 的 player_status（关卡完成 / 尝试明细）：多关主计时 =
 * 最近完成关卡的累计耗时（副计时 = 该关单段），单关 = 回合权威成绩（无则按
 * 计分制折算尝试明细：最快 / 平均）。
 *
 * 多关偏差条不在此计算——已改由 subsegment 实时时间差驱动（subsegment_gap
 * 广播 → director store.subsegmentGap → DiffBar，双方 TwilightTimer 时间线与
 * 计分同源，见 ignored/需求-subsegment实时时间差追踪与前端接入.md）。
 */
import { computed, type ComputedRef } from "vue";
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
  /** 多关选图模式（计时器口径） */
  isMulti: () => boolean;
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

  return { sideA, sideB };
}
