/**
 * 项目信息场景 mock 数据（独立入口无回合/无 token 时的预览兜底）。
 */
import { CategoryKind, PickType, type Pick } from "@/api/types";

/** 已映射的示例选图（Any% 全游戏项目） */
export const MOCK_CATEGORY_PICK: Pick = {
  code: "ML1",
  name: "Any%",
  type: PickType.MULTI,
  retry_count: null,
  collection: { raw: { name: "Any%", levels: [] } },
  tag: null,
  category: CategoryKind.ML,
  speedrun_category_id: "n2yo3jzd",
  speedrun_level_id: null,
  speedrun_variables: {},
};

/** 未映射的示例选图（场景显示占位卡） */
export const MOCK_UNMAPPED_PICK: Pick = {
  code: "EX01",
  name: "工坊·杂项",
  type: PickType.SINGLE,
  retry_count: null,
  collection: { raw: { name: "工坊·杂项", levels: [] } },
  tag: null,
  category: CategoryKind.EX,
  speedrun_category_id: null,
  speedrun_level_id: null,
  speedrun_variables: {},
};

/** 示例榜单（place 2 与 4 模拟本场 A/B 选手高亮；含并列名次跳号） */
export const MOCK_LEADERBOARD: { place: number; playerName: string; userId: string | null; timeSec: number }[] = [
  { place: 1, playerName: "DouBai", userId: "jpmye20j", timeSec: 1423.56 },
  { place: 2, playerName: "选手A", userId: "mock0001", timeSec: 1512.4 },
  { place: 2, playerName: "yuutaku", userId: "xzlkldr8", timeSec: 1512.4 },
  { place: 4, playerName: "kottu", userId: "8wlw6w4j", timeSec: 1601.87 },
  { place: 5, playerName: "选手B", userId: "mock0002", timeSec: 1688.02 },
  { place: 6, playerName: "Zeix", userId: "mock0003", timeSec: 1710.9 },
  { place: 7, playerName: "Loona", userId: "mock0004", timeSec: 1755.31 },
  { place: 8, playerName: "GuestRunner", userId: null, timeSec: 1802.74 },
  { place: 9, playerName: "Mikoto", userId: "mock0005", timeSec: 1859.18 },
  { place: 10, playerName: "Aster", userId: "mock0006", timeSec: 1904.6 },
  { place: 11, playerName: "Nori", userId: "mock0007", timeSec: 1977.23 },
  { place: 12, playerName: "Fay", userId: "mock0008", timeSec: 2031.49 },
  { place: 13, playerName: "Revv", userId: "mock0009", timeSec: 2110.05 },
  { place: 14, playerName: "Sora", userId: "mock0010", timeSec: 2188.66 },
  { place: 15, playerName: "Kite", userId: "mock0011", timeSec: 2264.12 },
];

/** mock 绑定（高亮演示：用户名口径） */
export const MOCK_SPEEDRUN_A = "选手A";
export const MOCK_SPEEDRUN_B = "选手B";
