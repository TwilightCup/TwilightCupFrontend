<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { ElMessageBox } from "element-plus";
import { Delete } from "@element-plus/icons-vue";
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
 * 图池编辑器：左侧类别侧栏 → 右侧当前类别选图。
 *
 * 类别名即文档固定 kind（ML/IL/CP/CT/EX/TB），创建后不可更改；每个 kind 至多一个类别，
 * TB 类别限定 1 个选图。直接 mutate 父级传入的 reactive mappool 引用。
 */
const props = defineProps<{ mappool: Mappool }>();

/** 当前选中的类别下标；-1 表示未选择（无类别）。 */
const selectedIndex = ref(-1);

const selectedCategory = computed(() =>
  selectedIndex.value >= 0 && selectedIndex.value < props.mappool.categories.length
    ? props.mappool.categories[selectedIndex.value]
    : null,
);

watch(
  () => props.mappool,
  () => {
    selectedIndex.value = props.mappool.categories.length > 0 ? 0 : -1;
  },
  { immediate: true },
);

watch(
  () => props.mappool.categories.length,
  () => {
    if (selectedIndex.value < 0) {
      selectedIndex.value = props.mappool.categories.length > 0 ? 0 : -1;
    } else if (selectedIndex.value >= props.mappool.categories.length) {
      selectedIndex.value = props.mappool.categories.length > 0 ? props.mappool.categories.length - 1 : -1;
    }
  },
);

function selectCategory(ci: number): void {
  if (ci >= 0 && ci < props.mappool.categories.length) {
    selectedIndex.value = ci;
  }
}

/** 各类别已用 kind（用于新增类别时避免重复）。 */
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
  selectedIndex.value = props.mappool.categories.length - 1;
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
  if (selectedIndex.value >= props.mappool.categories.length) {
    selectedIndex.value = props.mappool.categories.length > 0 ? props.mappool.categories.length - 1 : -1;
  }
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
    <div class="editor-layout">
      <aside class="category-sidebar">
        <div class="sidebar-header">
          <span class="sidebar-title">{{ $t("mappoolEditor.sidebarTitle") }}</span>
          <span class="sidebar-hint">{{ $t("mappoolEditor.sidebarHint") }}</span>
        </div>

        <div v-if="mappool.categories.length === 0" class="sidebar-empty">
          {{ $t("mappoolEditor.emptySidebar") }}
        </div>

        <div
          v-for="(cat, ci) in mappool.categories"
          :key="ci"
          class="category-row"
          :class="{ active: ci === selectedIndex }"
        >
          <button type="button" class="category-item" @click="selectCategory(ci)">
            <span class="cat-short">{{ categoryKindInfo(cat.name)?.short ?? cat.name }}</span>
            <span class="cat-label-main">{{ categoryKindInfo(cat.name)?.label ?? cat.name }}</span>
            <span class="cat-count">{{ cat.picks.length }}</span>
          </button>
          <el-button
            link
            type="danger"
            class="cat-delete"
            :title="$t('mappoolEditor.deleteCategoryBtn')"
            :aria-label="$t('mappoolEditor.deleteCategoryBtn')"
            @click="removeCategory(ci)"
          >
            <el-icon><Delete /></el-icon>
          </el-button>
        </div>

        <el-button class="add-cat" type="primary" plain :disabled="!canAddCategory" @click="addCategory">
          {{ canAddCategory ? $t("mappoolEditor.addCategoryBtn") : $t("mappoolEditor.maxCategories") }}
        </el-button>
      </aside>

      <section class="category-main">
        <div v-if="!selectedCategory" class="main-empty">
          <p>{{ $t("mappoolEditor.selectCategoryHint") }}</p>
          <el-button v-if="canAddCategory" type="primary" plain @click="addCategory">
            {{ $t("mappoolEditor.addCategoryBtn") }}
          </el-button>
        </div>

        <template v-else>
          <div class="picks">
            <MappoolPickEditor
              v-for="(pick, pi) in selectedCategory.picks"
              :key="pi"
              :pick="pick"
              :index="pi"
              :category-name="selectedCategory.name"
              @remove="removePick(selectedIndex, pi)"
            />
          </div>

          <el-button
            class="add-pick"
            plain
            size="small"
            :disabled="categoryKindOf(selectedCategory.name) === CategoryKind.TB && selectedCategory.picks.length >= 1"
            @click="addPick(selectedIndex)"
          >
            {{
              categoryKindOf(selectedCategory.name) === CategoryKind.TB && selectedCategory.picks.length >= 1
                ? $t("mappoolEditor.tbOnlyOne")
                : $t("mappoolEditor.addPickBtn")
            }}
          </el-button>
        </template>
      </section>
    </div>
  </div>
</template>

<style scoped>
.mappool-editor {
  width: 100%;
  height: 100%;
  min-height: 0;
}
.editor-layout {
  display: flex;
  gap: 12px;
  align-items: stretch;
  height: 100%;
  min-height: 0;
}
.category-sidebar {
  width: 190px;
  flex-shrink: 0;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  background: var(--tc-bg-soft);
  border: 1px solid var(--tc-border);
  border-radius: 10px;
}
.sidebar-header {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.sidebar-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--tc-text);
}
.sidebar-hint {
  font-size: 11px;
  color: var(--tc-text-dim);
}
.sidebar-empty {
  font-size: 12px;
  color: var(--tc-text-dim);
  padding: 8px 4px;
  text-align: center;
  border: 1px dashed var(--tc-border);
  border-radius: 8px;
}
.category-row {
  display: flex;
  align-items: center;
  width: 100%;
  border: 1px solid transparent;
  border-radius: 8px;
  transition: background 0.15s, border-color 0.15s;
}
.category-row:hover {
  background: var(--tc-hover);
}
.category-row.active {
  background: var(--tc-bg-soft);
  border-color: var(--tc-border);
  font-weight: 600;
  box-shadow: inset 2px 0 0 var(--el-color-primary);
}
.category-item {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 10px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--tc-text);
  cursor: pointer;
  font-size: 13px;
  text-align: left;
}
.category-item:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: -2px;
}
.cat-delete {
  flex-shrink: 0;
  padding: 4px 6px;
  margin-right: 4px;
  font-size: 12px;
}
.cat-short {
  width: 30px;
  flex-shrink: 0;
  font-weight: 700;
  letter-spacing: 0.5px;
}
.cat-label-main {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
}
.cat-count {
  flex-shrink: 0;
  font-size: 11px;
  color: var(--tc-text-dim);
  background: var(--tc-hover);
  border-radius: 10px;
  padding: 1px 7px;
}
.add-cat {
  width: 100%;
  margin-top: auto;
}
.category-main {
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 10px;
  background: var(--tc-bg-soft);
  border: 1px solid var(--tc-border);
  border-radius: 10px;
  padding: 12px;
}
.main-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: var(--tc-text-dim);
  font-size: 13px;
  text-align: center;
}
.main-empty p {
  margin: 0;
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
</style>
