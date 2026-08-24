<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import type { Pick } from "@/api/types";
import { useAuthStore } from "@/stores/auth";
import {
  fetchHffMeta,
  fetchVariables,
  setSpeedrunToken,
  type SrCategory,
  type SrLevel,
  type SrVariable,
} from "@/api/speedrun";

/**
 * 选图的 speedrun.com 排行榜映射编辑器（导播 categoryinfo 场景拉榜依据）。
 *
 * - 直接 mutate 父级传入的 pick 引用（与 MappoolPickEditor 同风格），
 *   写 speedrun_category_id / speedrun_level_id / speedrun_variables。
 * - 选项源为 speedrun.com API（匿名直连 + 模块级缓存）：分类 →（单关分类时）
 *   关卡 → 该分类/关卡适用的子分类变量（is-subcategory），级联显示。
 * - 当前值不在选项列表时注入伪选项（与关卡下拉同款防丢值策略）。
 * - speedrun.com 拉取失败（网络/限流）时整体降级为三个手输 id 文本框，
 *   不阻塞图池保存。
 */
const props = defineProps<{ pick: Pick }>();

const { t } = useI18n();
const auth = useAuthStore();

const metaLoading = ref(true);
const metaFailed = ref(false);
const categories = ref<SrCategory[]>([]);
const levels = ref<SrLevel[]>([]);
const varsLoading = ref(false);
const variables = ref<SrVariable[]>([]);

/** 手动降级模式下子分类对的文本表示（"varId=valueId, ..."） */
const manualVarsText = ref("");

onMounted(async () => {
  // speedrun 数据走后端同源代理（需 JWT）
  setSpeedrunToken(auth.token);
  try {
    const meta = await fetchHffMeta();
    categories.value = meta.categories;
    levels.value = meta.levels;
  } catch {
    metaFailed.value = true;
  } finally {
    metaLoading.value = false;
  }
  syncManualVarsText();
});

// ── 分类 ─────────────────────────────────────────────
/** 分类选项：全游戏在前、单关在后；当前值不在列表时注入伪选项防丢值。 */
const categoryOptions = computed(() => {
  const sorted = [...categories.value].sort((a, b) => {
    if (a.type !== b.type) return a.type === "per-game" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  const cur = props.pick.speedrun_category_id ?? "";
  if (cur && !sorted.some((c) => c.id === cur)) {
    sorted.unshift({ id: cur, name: `${cur}（未知）`, type: "per-game" });
  }
  return sorted;
});

/** 当前选中分类（未知 id 时按全游戏处理：不显示关卡下拉）。 */
const currentCategory = computed<SrCategory | null>(
  () => categories.value.find((c) => c.id === props.pick.speedrun_category_id) ?? null,
);

function categoryLabel(c: SrCategory): string {
  return c.type === "per-level" ? `${c.name}（${t("pickEditor.srPerLevelTag")}）` : c.name;
}

function onCategoryChange(v: string | number | boolean | object): void {
  const id = String(v ?? "").trim() || null;
  props.pick.speedrun_category_id = id;
  // 换分类即换作用域：关卡与子分类一并重置
  props.pick.speedrun_level_id = null;
  props.pick.speedrun_variables = {};
  loadVariables();
}

// ── 关卡（仅单关分类） ────────────────────────────────
const isPerLevel = computed(() => currentCategory.value?.type === "per-level");

const levelOptions = computed(() => {
  const sorted = [...levels.value].sort((a, b) => a.name.localeCompare(b.name));
  const cur = props.pick.speedrun_level_id ?? "";
  if (cur && !sorted.some((l) => l.id === cur)) {
    sorted.unshift({ id: cur, name: `${cur}（未知）` });
  }
  return sorted;
});

function onLevelChange(v: string | number | boolean | object): void {
  props.pick.speedrun_level_id = String(v ?? "").trim() || null;
  props.pick.speedrun_variables = {};
  loadVariables();
}

// ── 子分类变量 ───────────────────────────────────────
async function loadVariables(): Promise<void> {
  const catId = props.pick.speedrun_category_id;
  const lvId = props.pick.speedrun_level_id;
  if (!catId && !lvId) {
    variables.value = [];
    return;
  }
  varsLoading.value = true;
  try {
    const all = await fetchVariables({ categoryId: catId ?? undefined, levelId: lvId ?? undefined });
    variables.value = all.filter((v) => v.isSubcategory);
  } catch {
    variables.value = []; // 选项拉不到不阻塞编辑；已存值仍随图池保存
  } finally {
    varsLoading.value = false;
  }
}

/** 分类/关卡异步就绪后补拉一次子分类选项（初始 category 已有值时）。 */
watch(
  () => metaLoading.value,
  (loading) => {
    if (!loading) void loadVariables();
  },
);

/** 子分类当前值（缺失时空串 = 不过滤）。 */
function varValueOf(varId: string): string {
  return props.pick.speedrun_variables?.[varId] ?? "";
}

function onVarChange(varId: string, v: string | number | boolean | object): void {
  const value = String(v ?? "").trim();
  const vars = { ...(props.pick.speedrun_variables ?? {}) };
  if (value) vars[varId] = value;
  else delete vars[varId];
  props.pick.speedrun_variables = vars;
}

// ── 清除 / 摘要 ─────────────────────────────────────
function clearMapping(): void {
  props.pick.speedrun_category_id = null;
  props.pick.speedrun_level_id = null;
  props.pick.speedrun_variables = {};
  manualVarsText.value = "";
  variables.value = [];
}

/** 已映射摘要（场景与列表页一眼可见）。 */
const mappedSummary = computed<string>(() => {
  const cat = props.pick.speedrun_category_id;
  if (!cat) return "";
  const catName = categories.value.find((c) => c.id === cat)?.name ?? cat;
  const lv = props.pick.speedrun_level_id;
  const lvName = lv ? (levels.value.find((l) => l.id === lv)?.name ?? lv) : "";
  const vars = Object.values(props.pick.speedrun_variables ?? {});
  return [catName, lvName, ...vars].filter(Boolean).join(" · ");
});

// ── 手动降级模式 ────────────────────────────────────
function syncManualVarsText(): void {
  const pairs = Object.entries(props.pick.speedrun_variables ?? {}).map(
    ([k, v]) => `${k}=${v}`,
  );
  manualVarsText.value = pairs.join(", ");
}

/** 解析 "varId=valueId, ..." 文本写回 pick（坏行忽略）。 */
function onManualVarsInput(v: string): void {
  manualVarsText.value = v;
  const vars: Record<string, string> = {};
  for (const part of v.split(/[,，\n]/)) {
    const m = part.trim().match(/^(\S+)\s*=\s*(\S+)$/);
    if (m) vars[m[1]] = m[2];
  }
  props.pick.speedrun_variables = vars;
}
</script>

<template>
  <div class="sr-editor">
    <div class="sr-head">
      <span class="sr-title">{{ $t("pickEditor.srTitle") }}</span>
      <el-button v-if="props.pick.speedrun_category_id" link type="danger" size="small" @click="clearMapping">
        {{ $t("pickEditor.srClear") }}
      </el-button>
    </div>

    <!-- 拉取失败降级：手输 id（不阻塞图池保存） -->
    <template v-if="metaFailed">
      <el-alert :title="$t('pickEditor.srLoadFail')" type="warning" :closable="false" show-icon />
      <div class="grid">
        <el-form-item :label="$t('pickEditor.srManualCategory')" class="col">
          <el-input
            :model-value="props.pick.speedrun_category_id ?? ''"
            :placeholder="$t('pickEditor.srCategoryPlaceholder')"
            @update:model-value="(v: string) => (props.pick.speedrun_category_id = v.trim() || null)"
          />
        </el-form-item>
        <el-form-item :label="$t('pickEditor.srManualLevel')" class="col">
          <el-input
            :model-value="props.pick.speedrun_level_id ?? ''"
            :placeholder="$t('pickEditor.srManualLevel')"
            @update:model-value="(v: string) => (props.pick.speedrun_level_id = v.trim() || null)"
          />
        </el-form-item>
      </div>
      <el-form-item :label="$t('pickEditor.srManualVars')">
        <el-input
          :model-value="manualVarsText"
          :placeholder="$t('pickEditor.srManualVarsPlaceholder')"
          @update:model-value="onManualVarsInput"
        />
      </el-form-item>
    </template>

    <template v-else>
      <div v-if="metaLoading" class="sr-hint">{{ $t("pickEditor.srLoading") }}</div>
      <template v-else>
        <div class="grid">
          <el-form-item :label="$t('pickEditor.srCategory')" class="col">
            <el-select
              :model-value="props.pick.speedrun_category_id ?? ''"
              filterable
              clearable
              :placeholder="$t('pickEditor.srCategoryPlaceholder')"
              @change="onCategoryChange"
            >
              <el-option
                v-for="c in categoryOptions"
                :key="c.id"
                :value="c.id"
                :label="categoryLabel(c)"
              />
            </el-select>
          </el-form-item>
          <el-form-item v-if="isPerLevel" :label="$t('pickEditor.srLevel')" class="col">
            <el-select
              :model-value="props.pick.speedrun_level_id ?? ''"
              filterable
              clearable
              :placeholder="$t('pickEditor.srLevelPlaceholder')"
              @change="onLevelChange"
            >
              <el-option
                v-for="l in levelOptions"
                :key="l.id"
                :value="l.id"
                :label="l.name"
              />
            </el-select>
          </el-form-item>
        </div>

        <div v-if="varsLoading" class="sr-hint">{{ $t("pickEditor.srLoading") }}</div>
        <div v-else-if="variables.length > 0" class="sr-vars">
          <el-form-item
            v-for="v in variables"
            :key="v.id"
            :label="v.name"
            label-width="120px"
            class="sr-var"
          >
            <el-select
              :model-value="varValueOf(v.id)"
              clearable
              :placeholder="$t('pickEditor.srVarPlaceholder')"
              @change="(val: string | number | boolean | object) => onVarChange(v.id, val)"
            >
              <el-option
                v-for="o in v.values"
                :key="o.id"
                :value="o.id"
                :label="o.label"
              />
            </el-select>
          </el-form-item>
        </div>

        <div v-if="mappedSummary" class="sr-summary">
          {{ $t("pickEditor.srMappedSummary", { summary: mappedSummary }) }}
        </div>
        <div v-else class="sr-hint">{{ $t("pickEditor.srNone") }}</div>
      </template>
    </template>
  </div>
</template>

<style scoped>
.sr-editor {
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px dashed var(--tc-border);
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.sr-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.sr-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--tc-text-dim);
}
.grid {
  display: flex;
  gap: 12px;
}
.col {
  flex: 1;
}
.sr-vars {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.sr-var {
  margin-bottom: 4px;
}
.sr-summary {
  font-size: 12px;
  color: var(--el-color-success);
}
.sr-hint {
  color: var(--tc-text-dim);
  font-size: 12px;
  line-height: 1.5;
}
</style>
