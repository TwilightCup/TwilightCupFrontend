/**
 * 图池场景 mock 数据。
 *
 * 后端缺口#4（导播可读独立图池端点）未实现前用此兜底。结构对齐 api/types.ts 的
 * Mappool（categories → picks）。占位配图走类别纯色底（见 MapCard.vue）。
 */
import {
  CategoryKind,
  PickType,
  type Mappool,
} from "@/api/types";

export const MOCK_MAPPOOL: Mappool = {
  categories: [
    {
      name: CategoryKind.ML,
      picks: [
        mkPick("ML-01", "晨曦之桥", PickType.MULTI, CategoryKind.ML),
        mkPick("ML-02", "回声长廊", PickType.MULTI, CategoryKind.ML),
        mkPick("ML-03", "星河渡口", PickType.MULTI, CategoryKind.ML),
      ],
    },
    {
      name: CategoryKind.IL,
      picks: [
        mkPick("IL-01", "孤峰", PickType.SINGLE, CategoryKind.IL),
        mkPick("IL-02", "霜降", PickType.SINGLE, CategoryKind.IL),
      ],
    },
    {
      name: CategoryKind.CP,
      picks: [
        mkPick("CP-01", "存档点·潮汐", PickType.MULTI, CategoryKind.CP),
        mkPick("CP-02", "存档点·南屿", PickType.MULTI, CategoryKind.CP),
      ],
    },
    {
      name: CategoryKind.CT,
      picks: [
        mkPick("CT-01", "词条·Pinch", PickType.SINGLE, CategoryKind.CT, "Pinch"),
        mkPick("CT-02", "词条·Glitchless", PickType.SINGLE, CategoryKind.CT, "Glitchless"),
      ],
    },
    {
      name: CategoryKind.EX,
      picks: [mkPick("EX-01", "工坊·杂项", PickType.SINGLE, CategoryKind.EX)],
    },
    {
      name: CategoryKind.TB,
      picks: [mkPick("TB-01", "决胜局", PickType.MULTI, CategoryKind.TB)],
    },
  ],
};

function mkPick(
  code: string,
  name: string,
  type: PickType,
  category: string,
  tag: string | null = null,
) {
  return {
    code,
    name,
    type,
    collection: { raw: {} },
    category,
    tag,
  };
}
