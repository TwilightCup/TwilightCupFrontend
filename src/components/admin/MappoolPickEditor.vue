<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import type { UploadRequestOptions } from "element-plus";
import { useI18n } from "vue-i18n";
import { api, ApiError } from "@/api/client";
import { useAdminStore } from "@/stores/admin";
import { useAuthStore } from "@/stores/auth";
import { CategoryKind, PickType, type Level, type Pick } from "@/api/types";
import { categoryKindOf } from "@/utils/mappool";
import { officialDisplayName } from "@/utils/officialLevels";

/**
 * 单个选图编辑器。直接 mutate 父级传入的 reactive pick 引用。
 *
 * - 编号由父 MappoolEditor 按「类别 + 序号」自动分配（只读展示）。
 * - 类别由父 Category 决定；本面板不再重复展示类别标签（父卡片头已含 kind 选择器）。
 * - **关卡来自关卡管理页维护的关卡表**（admin store /admin/levels）：下拉 value 存关卡 id（UUID）、
 *   label 显示「展示名（名）」；数字工坊 ID 可直通；遗留名字符串/已删 id 以伪选项
 *   展示（黄警告）并原样透传，绝不静默丢值。
 * - 多关（MULTI）：「项目」预设（Aztec%/Dark%/Steam%/Any%）按主线关卡名约定解析为
 *   库 id（逐预设 all-or-nothing，缺关禁用；无完整预设时隐藏该选择器）。
 * - 单关（SINGLE）：「关卡」下拉选库内关卡或输入工坊 ID（数字），自动生成
 *   「单关卡 + 重试次数」合集，无需手动编辑关卡列表。
 * - 合集 name 统一取选图「名称」(pick.name)；关卡合集写入 pick.collection.raw = { name, levels }（选手端按此消费）。
 * - logo：上传到 MinIO（POST /admin/uploads）→ 写 pick.logo（随整场图池一起保存）；
 *   pick.logo_url 仅本地预览用（后端持久化时忽略）。
 */
const props = defineProps<{ pick: Pick; index: number; categoryName: string }>();
const emit = defineEmits<{ (e: "remove"): void }>();

const { t } = useI18n();
const auth = useAuthStore();

const logoUploading = ref(false);
const ACCEPT = ".png,.jpg,.jpeg,.webp,.gif";
const MAX_BYTES = 5 * 1024 * 1024;

/** 选图当前 logo 预览地址（本地预览用 logo_url；可能为空） */
const logoPreview = computed(() => props.pick.logo_url || "");

/** 自定义上传：校验大小 → 调 uploadLogo → 写 pick.logo + logo_url（本地预览） */
async function onUpload(req: UploadRequestOptions): Promise<void> {
  const file = req.file as File;
  if (file.size > MAX_BYTES) {
    ElMessage.error(t("pickEditor.logoTooLarge"));
    return;
  }
  if (!auth.token) {
    ElMessage.error(t("pickEditor.logoNeedLogin"));
    return;
  }
  logoUploading.value = true;
  try {
    const res = await api.uploadLogo(file, auth.token);
    props.pick.logo = res.key;
    if (res.url) props.pick.logo_url = res.url;
    ElMessage.success(t("pickEditor.logoUploaded"));
  } catch (e) {
    ElMessage.error(e instanceof ApiError ? e.message : t("pickEditor.logoUploadFail"));
  } finally {
    logoUploading.value = false;
  }
}

/** 移除 logo：清空 key 与本地预览（图池保存后该 pick 不再带 logo） */
async function onRemoveLogo(): Promise<void> {
  try {
    await ElMessageBox.confirm(
      t("pickEditor.logoRemoveConfirm"),
      t("pickEditor.logoRemoveTitle"),
      { type: "warning", confirmButtonText: t("common.delete"), cancelButtonText: t("common.cancel") },
    );
  } catch {
    return;
  }
  props.pick.logo = null;
  props.pick.logo_url = null;
}

const typeOptions = computed<{ value: PickType; label: string }[]>(() => [
  { value: PickType.MULTI, label: t("pickEditor.typeMulti") },
  { value: PickType.SINGLE, label: t("pickEditor.typeSingle") },
]);

/** 重试次数是否由管理端预设：CT/EX 单关改由裁判选图时指定，编辑器不再展示。 */
const showRetryCount = computed(() => {
  const k = categoryKindOf(props.categoryName);
  return k !== CategoryKind.CT && k !== CategoryKind.EX;
});

// 类别镜像父级（pick.category 用于后端分组）；CT/EX 单关重试清空（改由裁判选图时指定）
watch(
  () => props.categoryName,
  (n) => {
    if (!n) return;
    props.pick.category = n;
    const k = categoryKindOf(n);
    if (k === CategoryKind.CT || k === CategoryKind.EX) {
      if (props.pick.type === PickType.SINGLE) props.pick.retry_count = null;
    }
  },
  { immediate: true },
);

// ── 关卡数据（管理员在「关卡管理」页维护）：选项/校验/预设全部经 admin store ──────────
const admin = useAdminStore();
void admin.loadLevels(); // 有 loaded 守卫，多个选图编辑器只发一次请求

/** 主线关卡顺序约定（BuiltIn 8 + Extra 中的 Aztec/Halloween/Steam/Ice/Intro_Reprise）。
 *  预设按关卡「名」在此约定上解析为关卡 id；未按约定建关卡时相应预设不可用。 */
const MAINLINE_LEVEL_NAMES: readonly string[] = [
  "Intro", "Train", "Carry", "Climb", "Break",
  "Siege", "Water", "Power", "Aztec", "Halloween",
  "Steam", "Ice", "Intro_Reprise",
];

// ── 多关「项目」预设：每个项目 = 主线序列从 Intro 到指定终点的前缀 ──
const PROJECT_PRESETS: { name: string; end: string }[] = [
  { name: "Aztec%", end: "Aztec" },
  { name: "Dark%", end: "Halloween" },
  { name: "Steam%", end: "Steam" },
  { name: "Any%", end: "Intro_Reprise" },
];

/** 预设解析结果：按约定名逐关解析为关卡 id；缺关则该预设整体不可用（all-or-nothing）。 */
interface ResolvedPreset {
  name: string;
  ids: string[];
  missing: string[];
}

const resolvedPresets = computed<ResolvedPreset[]>(() =>
  PROJECT_PRESETS.map((p) => {
    const idx = MAINLINE_LEVEL_NAMES.indexOf(p.end);
    const seq = idx >= 0 ? MAINLINE_LEVEL_NAMES.slice(0, idx + 1) : [];
    const ids: string[] = [];
    const missing: string[] = [];
    for (const n of seq) {
      const lv = admin.levelByName.get(n);
      if (lv) ids.push(lv.id);
      else missing.push(n);
    }
    return { name: p.name, ids, missing };
  }),
);

const hasCompletePreset = computed(() =>
  resolvedPresets.value.some((p) => p.missing.length === 0),
);

/** 由关卡列表反推项目名：先按 id 序列精确匹配完整预设；再按旧名字序列匹配（遗留数据展示用）。 */
function inferProject(levels: string[]): string {
  for (const p of resolvedPresets.value) {
    if (
      p.missing.length === 0 &&
      p.ids.length === levels.length &&
      p.ids.every((v, i) => v === levels[i])
    ) {
      return p.name;
    }
  }
  for (const p of PROJECT_PRESETS) {
    const idx = MAINLINE_LEVEL_NAMES.indexOf(p.end);
    const seq = idx >= 0 ? MAINLINE_LEVEL_NAMES.slice(0, idx + 1) : [];
    if (seq.length === levels.length && seq.every((v, i) => v === levels[i])) return p.name;
  }
  return "";
}

/** 关卡值状态：ok=库内 id；legacy=旧数据按名引用且库中同名；workshop=数字工坊 ID 直通；unknown=已删/无法识别 */
type LvStatus = "ok" | "legacy" | "workshop" | "unknown";

function levelStatus(v: string): LvStatus {
  if (admin.levelById.has(v)) return "ok";
  if (admin.levelByName.has(v)) return "legacy";
  if (/^\d+$/.test(v)) return "workshop";
  return "unknown";
}

/** 关卡显示名：有效展示名（自定义 > 官方默认）（name）；相同则仅 name。 */
function levelLabelOf(l: Level): string {
  const dn = l.display_name || officialDisplayName(l.name);
  return dn && dn !== l.name ? `${dn}（${l.name}）` : l.name;
}

interface LvOption {
  value: string;
  label: string;
  status: LvStatus;
}

/** 下拉选项：关卡表全量 + 当前值不在库时注入伪选项（遗留/未知），保证已有值可显示且不丢。 */
function optionsFor(current: string): LvOption[] {
  const opts: LvOption[] = admin.levels.map((l) => ({
    value: l.id,
    label: levelLabelOf(l),
    status: "ok" as const,
  }));
  const cur = current.trim();
  if (cur && levelStatus(cur) !== "ok") {
    const s = levelStatus(cur);
    const byName = s === "legacy" ? admin.levelByName.get(cur) : undefined;
    const label =
      s === "legacy" && byName
        ? `${levelLabelOf(byName)}（遗留）`
        : s === "workshop"
          ? `${cur}（工坊）`
          : `${cur}（未知）`;
    opts.unshift({ value: cur, label, status: s });
  }
  return opts;
}

// ── 关卡合集：colLevels 为关卡序列（关卡 id / 遗留名 / 数字工坊 ID）──
type RawObj = Record<string, unknown>;
function readRaw(): RawObj {
  const raw = props.pick.collection?.raw;
  return raw && typeof raw === "object" ? (raw as RawObj) : {};
}
function readLevels(): string[] {
  const arr = readRaw().levels;
  return Array.isArray(arr) ? arr.map((x) => (x == null ? "" : String(x))) : [];
}

const colLevels = ref<string[]>(readLevels());
const singleLevel = ref<string>(colLevels.value[0] ?? "");
const projectSel = ref<string>(inferProject(colLevels.value));
const levelsError = ref<string>("");
const levelsWarn = ref<string>("");

/** 关卡数据异步到达后（初始为空），若项目仍未识别则补一次推断（不覆盖手选）。 */
watch(
  () => admin.levels.length,
  (n, prev) => {
    if (prev === 0 && n > 0 && projectSel.value === "") {
      projectSel.value = inferProject(colLevels.value);
    }
  },
);

/** 单关「关卡」下拉选项：关卡表 + 当前值伪选项（遗留/未知/工坊）。 */
const singleOptions = computed<LvOption[]>(() => optionsFor(singleLevel.value));

/**
 * 校验当前 levels：红错仅结构性（空列表）；遗留/未知值为黄警告（将按原样下发，
 * 建议改选库内关卡）。数字工坊 ID 为合法直通，不告警。
 */
function recomputeMessages(): void {
  const levels = colLevels.value.map((l) => l.trim()).filter((l) => l.length > 0);
  if (props.pick.type === PickType.SINGLE) {
    levelsError.value = levels.length === 0 ? t("pickEditor.selectLevelError") : "";
  } else {
    levelsError.value = levels.length === 0 ? t("pickEditor.minOneLevelError") : "";
  }
  const bad = levels.filter((l) => {
    const s = levelStatus(l);
    return s === "legacy" || s === "unknown";
  });
  levelsWarn.value =
    bad.length > 0 ? t("pickEditor.unknownLevelWarn", { first: bad[0], n: bad.length }) : "";
}

/** 把当前编辑状态写回 pick.collection.raw = { name, levels }；合集 name 取选图「名称」(pick.name)。
 *  levels 原样透传（遗留名字符串/已删 id 不改写）。 */
function syncCollection(): void {
  const levels = colLevels.value.map((l) => l.trim()).filter((l) => l.length > 0);
  props.pick.collection = { raw: { name: props.pick.name.trim(), levels } };
  recomputeMessages();
}

// 多关：选「项目」时，命中完整预设则按其关卡 id 序列填充（合集名即项目名）
function onProjectChange(v: string | number | boolean | object): void {
  const name = String(v ?? "");
  const preset = resolvedPresets.value.find((p) => p.name === name);
  if (preset && preset.missing.length === 0) colLevels.value = [...preset.ids];
  syncCollection();
}

// 单关：选 / 输「关卡」时，自动生成单关合集（levels=[关卡]，合集名跟随选图名称）
function onSingleLevelChange(v: string | number | boolean | object): void {
  const id = String(v ?? "").trim();
  colLevels.value = id ? [id] : [];
  syncCollection();
}

// 多关：手动编辑关卡列表后同步
watch(colLevels, syncCollection, { deep: true });

// 选图「名称」变化时，同步刷新合集 name（raw.name 跟随 pick.name）
watch(() => props.pick.name, syncCollection);

// 类型切换：切到单关时收敛到「第一关」，切到多关时刷新校验
watch(
  () => props.pick.type,
  (t, prev) => {
    if (t === prev) return;
    if (t === PickType.SINGLE) {
      singleLevel.value = colLevels.value[0] ?? "";
      onSingleLevelChange(singleLevel.value);
      if (!showRetryCount.value) props.pick.retry_count = null;
    } else {
      syncCollection();
    }
  },
);

// 初始化：把合集 name 对齐为选图名称，并校验
syncCollection();

// ── 多关关卡列表手动编辑 ──
function addLevel(): void {
  colLevels.value.push("");
}
function removeLevel(i: number): void {
  colLevels.value.splice(i, 1);
}
function moveLevel(i: number, delta: -1 | 1): void {
  const j = i + delta;
  if (j < 0 || j >= colLevels.value.length) return;
  const arr = colLevels.value;
  [arr[i], arr[j]] = [arr[j], arr[i]];
}

async function onRemove(): Promise<void> {
  try {
    await ElMessageBox.confirm(
      t("pickEditor.deleteConfirmMsg", { code: props.pick.code || t("banpick.untitledPick") }),
      t("pickEditor.deleteConfirmTitle"),
      { type: "warning", confirmButtonText: t("common.delete"), cancelButtonText: t("common.cancel") },
    );
  } catch {
    return;
  }
  emit("remove");
}
</script>

<template>
  <div class="pick-card">
    <div class="pick-head">
      <span class="pick-no">{{ $t("pickEditor.pickNumber", { index: index + 1 }) }}</span>
      <el-button link type="danger" @click="onRemove">{{ $t("pickEditor.deletePickBtn") }}</el-button>
    </div>

    <div class="grid">
      <el-form-item :label="$t('pickEditor.labelCode')" class="col">
        <span class="code">{{ props.pick.code || $t("pickEditor.codeAuto") }}</span>
      </el-form-item>
      <el-form-item :label="$t('pickEditor.labelPickName')" class="col">
        <el-input v-model="props.pick.name" :placeholder="$t('pickEditor.pickNamePlaceholder')" />
      </el-form-item>
    </div>

    <!-- logo 展示图：上传到 MinIO，key 随选图保存 -->
    <el-form-item :label="$t('pickEditor.labelLogo')">
      <div class="logo-row">
        <div v-if="logoPreview" class="logo-preview">
          <img :src="logoPreview" :alt="props.pick.name" />
          <el-button link type="danger" :disabled="logoUploading" @click="onRemoveLogo">
            {{ $t("pickEditor.logoRemoveBtn") }}
          </el-button>
        </div>
        <el-upload
          :show-file-list="false"
          :accept="ACCEPT"
          :http-request="onUpload"
          :disabled="logoUploading"
        >
          <el-button :loading="logoUploading">{{ $t("pickEditor.logoUploadBtn") }}</el-button>
        </el-upload>
        <span class="logo-hint">{{ $t("pickEditor.logoHint") }}</span>
      </div>
    </el-form-item>

    <div class="grid">
      <el-form-item :label="$t('pickEditor.labelType')" class="col">
        <el-select v-model="props.pick.type">
          <el-option
            v-for="o in typeOptions"
            :key="o.value"
            :value="o.value"
            :label="o.label"
          />
        </el-select>
      </el-form-item>

      <!-- 多关：项目下拉，选完整预设自动按主线顺序填关卡 id 序列；合集名即项目名。
           预设按关卡名约定解析，缺关则禁用；无任何完整预设时整体隐藏。 -->
      <el-form-item
        v-if="props.pick.type === PickType.MULTI && hasCompletePreset"
        :label="$t('pickEditor.labelProject')"
        class="col"
      >
        <el-select
          v-model="projectSel"
          filterable
          default-first-option
          clearable
          :placeholder="$t('pickEditor.projectPlaceholder')"
          @change="onProjectChange"
        >
          <el-option
            v-for="p in resolvedPresets"
            :key="p.name"
            :value="p.name"
            :label="p.missing.length ? `${p.name}（缺 ${p.missing.length} 关）` : p.name"
            :disabled="p.missing.length > 0"
          />
        </el-select>
      </el-form-item>

      <!-- 单关：关卡（可输入）下拉，选关卡或输入工坊 ID（数字） -->
      <el-form-item v-else :label="$t('pickEditor.labelLevel')" class="col">
        <el-select
          v-model="singleLevel"
          filterable
          allow-create
          default-first-option
          clearable
          :placeholder="$t('pickEditor.levelPlaceholder')"
          @change="onSingleLevelChange"
        >
          <el-option
            v-for="l in singleOptions"
            :key="l.value"
            :value="l.value"
            :label="l.label"
          >
            <el-tag
              v-if="l.status !== 'ok'"
              size="small"
              :type="l.status === 'workshop' ? 'info' : 'warning'"
              effect="plain"
            >
              {{ $t(l.status === 'legacy' ? 'pickEditor.legacyTag' : l.status === 'unknown' ? 'pickEditor.unknownTag' : 'pickEditor.workshopTag') }}
            </el-tag>
          </el-option>
        </el-select>
      </el-form-item>
    </div>

    <div class="grid">
      <el-form-item v-if="props.pick.type === PickType.SINGLE && showRetryCount" :label="$t('pickEditor.labelRetryCount')" class="col">
        <el-input-number
          v-model="props.pick.retry_count"
          :min="0"
          controls-position="right"
          style="width: 100%"
        />
      </el-form-item>
    </div>

    <!-- 多关：关卡列表（可手动增删 / 排序）；每行选关卡（value=id, label=展示名） -->
    <el-form-item v-if="props.pick.type === PickType.MULTI" :label="$t('pickEditor.labelLevelList')">
      <div class="levels">
        <div v-for="(lvl, i) in colLevels" :key="i" class="lvl-row">
          <span class="lvl-no">{{ i + 1 }}</span>
          <el-select
            :model-value="lvl"
            filterable
            default-first-option
            clearable
            :placeholder="$t('pickEditor.levelIdPlaceholder')"
            class="lvl-input"
            @update:model-value="(v: string) => (colLevels[i] = v)"
          >
            <el-option
              v-for="o in optionsFor(lvl)"
              :key="o.value"
              :value="o.value"
              :label="o.label"
            >
              <el-tag
                v-if="o.status !== 'ok'"
                size="small"
                :type="o.status === 'workshop' ? 'info' : 'warning'"
                effect="plain"
              >
                {{ $t(o.status === 'legacy' ? 'pickEditor.legacyTag' : o.status === 'unknown' ? 'pickEditor.unknownTag' : 'pickEditor.workshopTag') }}
              </el-tag>
            </el-option>
          </el-select>
          <el-button-group class="lvl-ops">
            <el-button link :disabled="i === 0" @click="moveLevel(i, -1)">↑</el-button>
            <el-button link :disabled="i === colLevels.length - 1" @click="moveLevel(i, 1)">↓</el-button>
            <el-button link type="danger" @click="removeLevel(i)">✕</el-button>
          </el-button-group>
        </div>
        <el-button size="small" @click="addLevel">{{ $t("pickEditor.addLevelBtn") }}</el-button>
        <div v-if="admin.levels.length === 0" class="lvl-hint">
          {{ $t("pickEditor.levelsEmptyHint") }}
        </div>
        <div v-if="levelsError" class="lvl-err">{{ levelsError }}</div>
        <div v-if="levelsWarn" class="lvl-warn">{{ levelsWarn }}</div>
        <div class="lvl-hint">
          {{ $t("pickEditor.multiHint") }}
        </div>
      </div>
    </el-form-item>

    <!-- 单关：自动生成合集，无需编辑关卡列表 -->
    <div v-else class="single-hint">
      <div v-if="admin.levels.length === 0" class="lvl-hint">
        {{ $t("pickEditor.levelsEmptyHint") }}
      </div>
      <div class="lvl-hint">
        {{ $t("pickEditor.singleHint") }}
      </div>
      <div v-if="levelsError" class="lvl-err">{{ levelsError }}</div>
      <div v-if="levelsWarn" class="lvl-warn">{{ levelsWarn }}</div>
    </div>
  </div>
</template>

<style scoped>
.pick-card {
  background: var(--tc-hover);
  border: 1px solid var(--tc-border);
  border-radius: 8px;
  padding: 12px;
}
.pick-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}
.pick-no {
  font-size: 12px;
  color: var(--tc-text-dim);
  font-weight: 600;
}
.code {
  font-weight: 700;
  font-size: 15px;
  letter-spacing: 0.5px;
}
.grid {
  display: flex;
  gap: 12px;
}
.col {
  flex: 1;
}
.levels {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.lvl-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.lvl-no {
  width: 18px;
  text-align: right;
  color: var(--tc-text-dim);
  font-size: 12px;
}
.lvl-input {
  flex: 1;
}
.lvl-ops {
  flex-shrink: 0;
}
.lvl-err {
  color: #ff9a9a;
  font-size: 12px;
}
.lvl-warn {
  color: #e6c07b;
  font-size: 12px;
}
.lvl-hint {
  color: var(--tc-text-dim);
  font-size: 12px;
  line-height: 1.5;
}
.single-hint {
  padding: 2px 0 4px;
}
.logo-row {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.logo-preview {
  display: flex;
  align-items: center;
  gap: 8px;
}
.logo-preview img {
  width: 64px;
  height: 48px;
  object-fit: cover;
  border-radius: 6px;
  border: 1px solid var(--tc-border);
  background: #000;
}
.logo-hint {
  color: var(--tc-text-dim);
  font-size: 12px;
}
</style>
