/**
 * 比赛详情场景 mock 数据。
 *
 * 无 matchId 或 WS 断线时兜底，绝不让 OBS 黑屏。字段对齐 director store 的形态，
 * 供 MatchScene 在未连 WS 时也能渲染完整布局。后端连上后由 WS 实时覆盖。
 */
import { MatchPhase, PlayerStatus, type LevelTime } from "@/api/types";

export const MOCK_MATCH = {
  matchName: "黄昏杯 · 模拟决赛",
  boFormat: 9,
  winThreshold: 5,
  nameA: "星河",
  nameB: "回声",
  winsA: 2,
  winsB: 3,
  /** 双方已完成关卡（含累计用时 total_ms），供 TugBar 计算计时差 */
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
  statusA: PlayerStatus.IN_GAME,
  statusB: PlayerStatus.IN_GAME,
  phase: MatchPhase.IN_ROUND,
};
