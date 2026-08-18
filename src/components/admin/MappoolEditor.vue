<script setup lang="ts">
import { computed } from "vue";
import { ElMessageBox } from "element-plus";
import { useI18n } from "vue-i18n";
import {
  CATEGORY_KINDS,
  CategoryKind,
  PickType,
  type CategoryKind as CK,
  type Mappool,
  type Pick,
} from "@/api/types";
import { categoryKindOf } from "@/utils/mappool";
import { categoryKindInfo } from "@/utils/format";
import MappoolPickEditor from "./MappoolPickEditor.vue";

const { t } = useI18n();

/**
 * 图池编辑器：类别（kind）→ 选图。
 *
 * 类别名即文档固定 kind（ML/IL/CP/CT/EX/TB），故用下拉而非自由文本；每个 kind 至多一个类别，
 * TB 类别限定 1 个选图。直接 mutate 父级传入的 reactive mappool 引用。
 */
const props = defineProps<{ mappool: Mappool }>();

const kindOptions = CATEGORY_KINDS.map((k) => {
  const info = categoryKindInfo(k);
  return { value: k, short: info?.short ?? k, label: info?.label ?? k };
});

/** 各类别已用 kind（用于下拉禁用）。 */
function usedKinds(excludeIndex: number): Set<string> {
  const s = new Set<string>();
  props.mappool.categories.forEach((c, i) => {
    if (i === excludeIndex) return;
    const k = categoryKindOf(c.name);
    if (k) s.add(k);
  });
  return s;
}

/** 首个尚未使用的 kind（新增类别默认名）。 */
function firstUnusedKind(): string {
  const used = usedKinds(-1);
  const free = CATEGORY_KINDS.find((k) => !used.has(k));
  return free ?? CategoryKind.ML;
}

function addCategory(): void {
  props.mappool.categories.push({
    name: firstUnusedKind(),
    picks: [],
  });
}

function onKindChange(ci: number): void {
  const cat = props.mappool.categories[ci];
  // 切到 TB 时收敛到 1 个选图
  if (categoryKindOf(cat.name) === CategoryKind.TB && cat.picks.length > 1) {
    cat.picks = cat.picks.slice(0, 1);
  }
  renumberCategory(cat);
}

/** 按类别 + 序号自动分配编号：ML→ML1/ML2…、TB→TB；未知类别保持原值。 */
function renumberCategory(cat: { name: string; picks: Pick[] }): void {
  const k = categoryKindOf(cat.name);
  cat.picks.forEach((p, i) => {
    if (k === CategoryKind.TB) p.code = "TB";
    else if (k) p.code = `${k}${i + 1}`;
    p.isTiebreaker = k === CategoryKind.TB;
  });
}

async function removeCategory(ci: number): Promise<void> {
  const cat = props.mappool.categories[ci];
  try {
    await ElMessageBox.confirm(
      t("mappoolEditor.deleteCategoryConfirmMsg", { name: cat.name, count: cat.picks.length }),
      t("mappoolEditor.deleteCategoryConfirmTitle"),
      { type: "warning", confirmButtonText: t("common.delete"), cancelButtonText: t("common.cancel") },
    );
  } catch {
    return;
  }
  props.mappool.categories.splice(ci, 1);
}

function addPick(ci: number): void {
  const cat = props.mappool.categories[ci];
  const k = categoryKindOf(cat.name);
  // TB 仅允许 1 个选图
  if (k === CategoryKind.TB && cat.picks.length >= 1) return;
  const pick: Pick = {
    code: "",
    name: "",
    type: defaultPickType(k),
    collection: { raw: {} },
    category: cat.name,
    isTiebreaker: k === CategoryKind.TB,
  };
  cat.picks.push(pick);
  renumberCategory(cat);
}

function removePick(ci: number, pi: number): void {
  const cat = props.mappool.categories[ci];
  cat.picks.splice(pi, 1);
  renumberCategory(cat);
}

/** 各类别选图的默认类型：IL/CP/CT/EX 默认单关，ML/TB 默认多关。 */
function defaultPickType(k: CK | null): PickType {
  if (k === CategoryKind.IL || k === CategoryKind.CP || k === CategoryKind.CT || k === CategoryKind.EX) {
    return PickType.SINGLE;
  }
  return PickType.MULTI;
}

const canAddCategory = computed(() => props.mappool.categories.length < CATEGORY_KINDS.length);
</script>

<template>
  <div class="mappool-editor">
    <div v-if="mappool.categories.length === 0" class="empty">
      {{ $t("mappoolEditor.empty") }}
    </div>

    <div
      v-for="(cat, ci) in mappool.categories"
      :key="ci"
      class="category-card"
    >
      <div class="cat-head">
        <div class="cat-name-wrap">
          <span class="cat-label">{{ $t("mappoolEditor.labelCategory") }}</span>
          <el-select
            v-model="cat.name"
            class="cat-name-input"
            :placeholder="$t('mappoolEditor.categoryPlaceholder')"
            @change="onKindChange(ci)"
          >
            <el-option
              v-for="o in kindOptions"
              :key="o.value"
              :value="o.value"
              :label="`${o.short} · ${o.label.split(' · ')[0]}`"
              :disabled="usedKinds(ci).has(o.value)"
            />
          </el-select>
          <span class="cat-desc">{{ categoryKindInfo(cat.name)?.label }}</span>
        </div>
        <el-button link type="danger" @click="removeCategory(ci)">
          {{ $t("mappoolEditor.deleteCategoryBtn") }}
        </el-button>
      </div>

      <div class="picks">
        <MappoolPickEditor
          v-for="(pick, pi) in cat.picks"
          :key="pi"
          :pick="pick"
          :index="pi"
          :category-name="cat.name"
          @remove="removePick(ci, pi)"
        />
      </div>

      <el-button
        class="add-pick"
        plain
        size="small"
        :disabled="categoryKindOf(cat.name) === CategoryKind.TB && cat.picks.length >= 1"
        @click="addPick(ci)"
      >
        {{
          categoryKindOf(cat.name) === CategoryKind.TB && cat.picks.length >= 1
            ? $t("mappoolEditor.tbOnlyOne")
            : $t("mappoolEditor.addPickBtn")
        }}
      </el-button>
    </div>

    <el-button class="add-cat" type="primary" plain :disabled="!canAddCategory" @click="addCategory">
      {{ canAddCategory ? $t("mappoolEditor.addCategoryBtn") : $t("mappoolEditor.maxCategories") }}
    </el-button>
  </div>
</template>

<style scoped>
.mappool-editor {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.empty {
  color: var(--tc-text-dim);
  font-size: 13px;
  padding: 16px;
  text-align: center;
  border: 1px dashed var(--tc-border);
  border-radius: 8px;
}
.category-card {
  background: var(--tc-bg-soft);
  border: 1px solid var(--tc-border);
  border-radius: 10px;
  padding: 12px;
}
.cat-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}
.cat-name-wrap {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.cat-label {
  font-size: 12px;
  color: var(--tc-text-dim);
}
.cat-name-input {
  width: 200px;
}
.cat-desc {
  font-size: 12px;
  color: var(--tc-text-dim);
}
.picks {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-bottom: 10px;
}
.add-pick {
  width: 100%;
}
.add-cat {
  width: 100%;
}
</style>
