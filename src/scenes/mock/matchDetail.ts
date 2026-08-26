/**
 * 比赛详情场景 mock 数据。
 *
 * 无 matchId 或 WS 断线时兜底，绝不让 OBS 黑屏。字段对齐 useMatchTiming 的数据源
 * 形态：多关给 completedLevels（含累计耗时，供计时器计算），单关给 attempts
 * （重试明细，按计分制取最快 / 平均）。isMulti 控制演示模式显隐（偏差条 +
 * 副计时器）。后端连上后由 WS 实时覆盖。
 */
import { AttemptStatus, type Attempt, type LevelTime } from "@/api/types";
import type { TopBarMock } from "@/scenes/components/TopBar.vue";

export const MOCK_MATCH = {
  /** 演示模式：true = 多关（偏差条 + 副计时器），false = 单关 */
  isMulti: true,
  /** 单关计分制（对齐 match_log initial_info.scoring_method） */
  scoringMethod: "FASTEST" as const,
  /** 演示偏差（毫秒，有符号：正 = B 落后）：mock 关卡累计 B 快 3.68s → A 落后。
   *  真实数据来自 subsegment_gap 广播（director.subsegmentGap），mock 为静态值 */
  gapDiffMs: -3680,
  /** 演示多关合集关卡名序列（关卡标识，与 currentLevel* 的 0 起序号配合，
   *  驱动选手计时器旁的当前关卡名标签；经官方展示名对照后上屏） */
  levelNames: ["Intro", "Train", "Climb", "Water", "Power"],
  /** 双方当前所处关卡序号（0 起；与下方 levels* 已完成三关衔接，双方同在第 4 关） */
  currentLevelA: 3,
  currentLevelB: 3,
  /** 双方已完成关卡（含累计用时 total_ms），供偏差条 / 计时器计算 */
  levelsA: [
    { level_index: 0, time_ms: 42180, total_ms: 42180 },
    { level_index: 1, time_ms: 38900, total_ms: 81080 },
    { level_index: 2, time_ms: 51200, total_ms: 132280 },
  ] as LevelTime[],
  levelsB: [
    { level_index: 0, time_ms: 39600, total_ms: 39600 },
    { level_index: 1, time_ms: 41200, total_ms: 80800 },
    { level_index: 2, time_ms: 47800, total_ms: 128600 },
  ] as LevelTime[],
  /** 单关演示用尝试明细 */
  attemptsA: [
    { index: 0, status: AttemptStatus.VALID, time_ms: 41230 },
    { index: 1, status: AttemptStatus.VALID, time_ms: 39870 },
  ] as Attempt[],
  attemptsB: [{ index: 0, status: AttemptStatus.VALID, time_ms: 38940 }] as Attempt[],
};

/** 顶部信息栏 mock（MatchScene mock 模式传给 TopBar 演示完整版式） */
export const MOCK_TOPBAR: TopBarMock = {
  tournamentName: "TWILIGHT CUP",
  matchName: "黄昏杯 · 胜者组半决赛",
  nameA: "HeyBlack",
  nameB: "星野",
  winsA: 3,
  winsB: 2,
  pipCount: 5,
};
