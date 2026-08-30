<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import { ElMessage } from "element-plus";
import { useI18n } from "vue-i18n";
import { useAdminStore } from "@/stores/admin";
import type { Mappool, MappoolLibItem } from "@/api/types";
import { validateMappool } from "@/utils/mappool";
import MappoolEditor from "./MappoolEditor.vue";

/**
 * 图池库 创建/编辑 弹窗。编辑模式传入 :mappool（含 id）；创建模式传 null。
 * 复用 MappoolEditor 就地编辑结构化图池；提交前做合法性 + TB 类别校验。
 */
const props = defineProps<{ modelValue: boolean; mappool?: MappoolLibItem | null }>();
const emit = defineEmits<{
  (e: "update:modelValue", v: boolean): void;
  (e: "done"): void;
}>();

const { t } = useI18n();
const admin = useAdminStore();
const submitting = ref(false);
const editingId = ref<string | null>(null);

function emptyMappool(): Mappool {
  return { categories: [] };
}

const form = reactive<{ name: string; mappool: Mappool }>({
  name: "",
  mappool: emptyMappool(),
});

watch(
  () => props.modelValue,
  (open) => {
    if (!open) return;
    // 对话框内容常驻挂载（选图编辑器 onMounted 只触发一次），每次打开刷新关卡数据
    void admin.loadLevels();
    if (props.mappool) {
      editingId.value = props.mappool.id;
      form.name = props.mappool.name;
      form.mappool = JSON.parse(JSON.stringify(props.mappool.mappool));
    } else {
      editingId.value = null;
      form.name = "";
      form.mappool = emptyMappool();
    }
  },
);

const totalPicks = computed(() =>
  form.mappool.categories.reduce((n, c) => n + c.picks.length, 0),
);

function close(): void {
  emit("update:modelValue", false);
}

function hasTB(): boolean {
  return form.mappool.categories.some((c) => c.name.trim().toUpperCase() === "TB");
}

async function onSubmit(): Promise<void> {
  if (!form.name.trim()) {
    ElMessage.warning(t("mappoolForm.nameRequired"));
    return;
  }
  const errors = validateMappool(form.mappool).filter((i) => i.level === "error");
  if (errors.length > 0) {
    ElMessage.warning(errors[0].msg);
    return;
  }
  if (!hasTB()) {
    ElMessage.warning(t("mappoolForm.needTb"));
    return;
  }
  submitting.value = true;
  const body = { name: form.name.trim(), mappool: form.mappool };
  const res = editingId.value
    ? await admin.updateMappool(editingId.value, body)
    : await admin.createMappool(body);
  submitting.value = false;
  if (res) {
    emit("done");
    close();
  }
}
</script>

<template>
  <el-dialog
    :model-value="modelValue"
    :title="editingId ? $t('mappoolForm.titleEdit') : $t('mappoolForm.titleCreate')"
    width="900px"
    class="mappool-dialog"
    :close-on-click-modal="false"
    top="0"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <el-form :model="form" label-position="top">
      <el-form-item :label="$t('mappoolForm.labelName')" required>
        <el-input v-model="form.name" :placeholder="$t('mappoolForm.namePlaceholder')" />
      </el-form-item>
      <el-form-item :label="$t('mappoolForm.labelContent')">
        <div class="mappool-wrap">
          <MappoolEditor :mappool="form.mappool" />
          <div class="field-hint">{{ $t('mappoolForm.totalPicksHint', { count: totalPicks }) }}</div>
        </div>
      </el-form-item>
    </el-form>

    <template #footer>
      <el-button @click="close">{{ $t('common.cancel') }}</el-button>
      <el-button type="primary" :loading="submitting" @click="onSubmit">
        {{ editingId ? $t('mappoolForm.saveEditBtn') : $t('mappoolForm.createBtn') }}
      </el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.mappool-wrap {
  width: 100%;
}
.field-hint {
  font-size: 12px;
  color: var(--tc-text-dim);
  margin-top: 6px;
}
</style>

<style>
.mappool-dialog {
  height: 100vh;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.mappool-dialog .el-dialog__header,
.mappool-dialog .el-dialog__footer {
  flex-shrink: 0;
}
.mappool-dialog .el-dialog__body {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.mappool-dialog .el-form {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.mappool-dialog .el-form-item:last-child {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  margin-bottom: 0;
}

.mappool-dialog .el-form-item:last-child .el-form-item__content {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  align-items: stretch;
}

.mappool-dialog .mappool-wrap {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.mappool-dialog .mappool-wrap .field-hint {
  flex-shrink: 0;
}

.mappool-dialog .mappool-editor {
  flex: 1;
  min-height: 0;
}
</style>
