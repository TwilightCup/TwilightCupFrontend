/**
 * 裁判端词条选图逻辑（PrepPanel / BanPickPanel 共用）。
 *
 * 所选 pick 为 CT / EX 类别时可选 0-2 个词条，随 referee_select_pick 的 tags
 * 字段提交。CT 选项按当前图池 CT 类别的 `ct_tags` 配置（旧图池回退内置枚举，
 * 单关另加 Achievement）；CT 过滤本场词条 ban 环节（draft.bannedTags）已禁用
 * 的词条，EX 不受禁用词条约束；冲突对（Checkpoint + No Checkpoint）互相置灰。
 * CP 类别不显示选择器，提交时自动携带 Checkpoint。
 * 词条名沿用原文（不翻译），仅提示语走 i18n。
 */
import { computed, ref, watch } from "vue";
import { useMatchStore } from "@/stores/match";
import { useDraftStore } from "@/stores/draft";
import { CategoryKind, PickType } from "@/api/types";
import { CT_TAG_CONFLICTS } from "@/api/types";
import { ctTagsFor } from "@/utils/mappool";

export function useCtTagSelect() {
  const match = useMatchStore();
  const draft = useDraftStore();

  const tagInput = ref<string[]>([]);

  /** 比赛配置的词条数上限（0=本場禁用词条，不显示选择器；默认 2）。 */
  const tagLimit = computed(() => draft.ctTagCount);

  /** 当前选中的 pick 的类别。 */
  const pickCategory = computed(
    () => match.pickInfo[match.pendingPickCode ?? ""]?.category ?? null,
  );

  /** 当前选中的 pick 是否为词条类别（CT/EX；未知类别视为否，不显示选择器）。 */
  const isCtPick = computed(
    () =>
      tagLimit.value > 0 &&
      (pickCategory.value === CategoryKind.CT || pickCategory.value === CategoryKind.EX),
  );

  /** 当前选中的 pick 是否为 CP 类别（自动携带 Checkpoint，无选择器）。 */
  const isCpPick = computed(() => pickCategory.value === CategoryKind.CP);

  /** EX 不受本场禁用词条约束。 */
  const isExPick = computed(() => pickCategory.value === CategoryKind.EX);

  /** 单关选图额外可选 Achievement。 */
  const isSinglePick = computed(
    () => match.pickInfo[match.pendingPickCode ?? ""]?.type === PickType.SINGLE,
  );

  /** 当前选中的 Pick（词条候选按图池 CT 类别配置；无图池时回退全局函数）。 */
  const currentPick = computed(() => draft.pickByCode(match.pendingPickCode ?? ""));

  const tagChoices = computed<string[]>(() => {
    const p = currentPick.value;
    if (p) return draft.ctTagChoicesFor(p);
    return ctTagsFor(isSinglePick.value);
  });

  /** CT/EX 单关：重试次数改由裁判选图时指定（必填）。 */
  const needsRetry = computed(() => {
    const cat = pickCategory.value;
    return isSinglePick.value && (cat === CategoryKind.CT || cat === CategoryKind.EX);
  });

  /** 词条可选项（CT 过滤已 ban，EX 不过滤）；与已选词条有冲突的标记 disabled。 */
  const tagOptions = computed<{ value: string; disabled: boolean }[]>(() => {
    const all = tagChoices.value.filter(
      (t) => isExPick.value || !draft.state.bannedTags.includes(t),
    );
    return all.map((t) => ({
      value: t,
      disabled: CT_TAG_CONFLICTS.some(
        ([a, b]) => (a === t && tagInput.value.includes(b)) || (b === t && tagInput.value.includes(a)),
      ),
    }));
  });

  /** 已选词条命中本场新禁词条（tag ban 晚于选择的兜底提示；仅 CT）。 */
  const bannedHit = computed(() =>
    isExPick.value ? [] : tagInput.value.filter((t) => draft.state.bannedTags.includes(t)),
  );

  /** 本轮选图要随消息提交的词条（CP 恒 Checkpoint，非词条类别恒为空数组）。 */
  const tagsToSubmit = computed(() => {
    if (isCpPick.value) return ["Checkpoint"];
    return isCtPick.value ? [...tagInput.value] : [];
  });

  function resetTags(): void {
    tagInput.value = [];
  }

  /**
   * 提交前整理词条：换 pick 时丢弃上一 pick 的词条选择（避免误随新 pick 提交），
   * 返回本次应随 referee_select_pick 携带的词条数组。
   */
  function prepareSubmit(code: string): string[] {
    if (code !== match.pendingPickCode) {
      resetTags();
      return [];
    }
    return tagsToSubmit.value;
  }

  // 换 pick（或进入全新准备阶段清空 pending）时重置词条选择；
  // 平局重赛时服务端沿用原词条，pendingPickCode 由 match store 继承，这里同步展示。
  watch(
    () => match.pendingPickCode,
    () => {
      if (match.pendingTags.length > 0) tagInput.value = [...match.pendingTags];
      else resetTags();
    },
    { immediate: true },
  );

  return {
    tagInput,
    tagLimit,
    isCtPick,
    isCpPick,
    isExPick,
    isSinglePick,
    needsRetry,
    tagOptions,
    bannedHit,
    tagsToSubmit,
    resetTags,
    prepareSubmit,
  };
}
