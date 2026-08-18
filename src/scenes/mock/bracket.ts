/**
 * 赛程图场景 mock 数据。
 *
 * 后端缺口#1/#3 未实现前（导播 token 调 /admin/tournaments/{id}/bracket 会 403、无名字解析）
 * 场景页用此兜底，并显示 mock 角标。结构对齐 api/types.ts 的 BracketView / FixtureOut。
 *
 * 示例为单淘汰 8 人（3 轮）+ 模拟已产生的比分与胜方，便于联调渲染与 SVG 连线。
 */
import {
  BracketSide,
  FixtureStatus,
  TournamentFormat,
  type BracketView,
} from "@/api/types";

/** account_id → 展示名（mock，后端补 participants 端点后用真实） */
export const MOCK_NAMES: Record<string, string> = {
  p1: "星河",
  p2: "回声",
  p3: "暮色",
  p4: "晨曦",
  p5: "朔风",
  p6: "潮汐",
  p7: "霜降",
  p8: "南屿",
};

/** 单淘汰 8 人 mock 对阵树（3 轮：四强→决赛→冠军） */
export const MOCK_BRACKET: BracketView = {
  tournament_id: "mock-tournament",
  format: TournamentFormat.SINGLE_ELIM,
  current_round: 2,
  total_rounds: 3,
  rounds: [
    {
      round_no: 1,
      bracket_side: BracketSide.MAIN,
      fixtures: [
        mkFixture("f1", 1, 0, "p1", "p2", "p1", "m1", FixtureStatus.COMPLETED),
        mkFixture("f2", 1, 1, "p3", "p4", "p3", "m2", FixtureStatus.COMPLETED),
        mkFixture("f3", 1, 2, "p5", "p6", "p6", "m3", FixtureStatus.COMPLETED),
        mkFixture("f4", 1, 3, "p7", "p8", null, "m4", FixtureStatus.RUNNING),
      ],
    },
    {
      round_no: 2,
      bracket_side: BracketSide.MAIN,
      fixtures: [
        mkFixture("f5", 2, 0, "p1", "p3", "p1", "m5", FixtureStatus.COMPLETED),
        mkFixture("f6", 2, 1, "p6", null, null, null, FixtureStatus.PENDING),
      ],
    },
    {
      round_no: 3,
      bracket_side: BracketSide.MAIN,
      fixtures: [mkFixture("f7", 3, 0, null, null, null, null, FixtureStatus.PENDING)],
    },
  ],
};

/** 决赛/已结束对阵的 mock 比分（wins_a / wins_b），FixtureOut 自身无比分字段 */
export const MOCK_SCORES: Record<string, { a: number; b: number }> = {
  m1: { a: 4, b: 2 },
  m2: { a: 3, b: 4 },
  m3: { a: 2, b: 4 },
  m5: { a: 4, b: 3 },
};

function mkFixture(
  id: string,
  roundNo: number,
  matchIndex: number,
  aId: string | null,
  bId: string | null,
  winnerId: string | null,
  matchId: string | null,
  status: FixtureStatus,
) {
  return {
    id,
    tournament_id: "mock-tournament",
    round_no: roundNo,
    bracket_side: BracketSide.MAIN,
    match_index: matchIndex,
    player_a_id: aId,
    player_b_id: bId,
    is_bye: false,
    advances_to: null,
    advances_slot: null,
    losers_drops_to: null,
    losers_drop_slot: null,
    depends_on: [],
    referee_id: null,
    director_id: null,
    match_id: matchId,
    winner_id: winnerId,
    status,
    created_at: "2026-08-01T00:00:00Z",
    started_at: null,
    completed_at: null,
  };
}
