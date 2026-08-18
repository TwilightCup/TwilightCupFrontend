<script setup lang="ts">
/**
 * 关卡创建/编辑弹窗（「关卡管理」页）。关卡名唯一且创建后不可改（后端 PATCH 不接受 name）。
 * 展示图 logo 走统一上传（api.uploadLogo → MinIO，key 存 Level.logo）。
 */
import { computed, reactive, ref, watch } from "vue";
import type { FormInstance, FormRules, UploadRequestOptions } from "element-plus";
import { ElMessage, ElMessageBox } from "element-plus";
import { useI18n } from "vue-i18n";
import { api, ApiError } from "@/api/client";
import { useAdminStore } from "@/stores/admin";
import { useAuthStore } from "@/stores/auth";
import type { Level } from "@/api/types";

const props = defineProps<{
  modelValue: boolean;
  /** 传入则为编辑该关卡，null 为新建 */
  level: Level | null;
}>();
const emit = defineEmits<{
  (e: "update:modelValue", v: boolean): void;
  (e: "done"): void;
}>();

const { t } = useI18n();
const admin = useAdminStore();
const auth = useAuthStore();
const formRef = ref<FormInstance>();
const submitting = ref(false);

const isEdit = computed(() => !!props.level);
const title = computed(() =>
  isEdit.value ? t("levelForm.titleEdit") : t("levelForm.titleCreate"),
);

const form = reactive({
  name: "",
  displayName: "",
  /** MinIO object key（提交给后端） */
  logo: null as string | null,
  /** 本地预览 URL（后端返回的公开 URL，不提交） */
  logoUrl: "",
});

const rules = computed<FormRules>(() => ({
  name: isEdit.value
    ? []
    : [{ required: true, message: t("levelForm.nameRequired"), trigger: "blur" }],
}));

watch(
  () => props.modelValue,
  (open) => {
    if (!open) return;
    if (props.level) {
      form.name = props.level.name;
      form.displayName = props.level.display_name;
      form.logo = props.level.logo ?? null;
      form.logoUrl = props.level.logo_url ?? "";
    } else {
      form.name = "";
      form.displayName = "";
      form.logo = null;
      form.logoUrl = "";
    }
    formRef.value?.clearValidate();
  },
);

// ---- logo 上传（与 MappoolPickEditor 同模式）----
const logoUploading = ref(false);
const ACCEPT = ".png,.jpg,.jpeg,.webp,.gif";
const MAX_BYTES = 5 * 1024 * 1024;

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
    form.logo = res.key;
    if (res.url) form.logoUrl = res.url;
    ElMessage.success(t("pickEditor.logoUploaded"));
  } catch (e) {
    ElMessage.error(e instanceof ApiError ? e.message : t("pickEditor.logoUploadFail"));
  } finally {
    logoUploading.value = false;
  }
}

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
  form.logo = null;
  form.logoUrl = "";
}

function close(): void {
  emit("update:modelValue", false);
}

async function onSubmit(): Promise<void> {
  if (!formRef.value) return;
  try {
    await formRef.value.validate();
  } catch {
    return;
  }
  const name = form.name.trim();
  // 创建模式本地重名预检（库列表为准；store 的 409 特判兜底）
  if (!isEdit.value && admin.levels.some((l) => l.name === name)) {
    ElMessage.warning(t("levelForm.nameExists", { name }));
    return;
  }
  submitting.value = true;
  let ok: Level | null = null;
  if (props.level) {
    ok = await admin.updateLevel(props.level.id, {
      display_name: form.displayName.trim(),
      logo: form.logo,
    });
  } else {
    ok = await admin.createLevel({
      name,
      display_name: form.displayName.trim(),
      logo: form.logo,
    });
  }
  submitting.value = false;
  if (ok) {
    emit("done");
    close();
  }
}
</script>

<template>
  <el-dialog
    :model-value="modelValue"
    :title="title"
    width="440px"
    :close-on-click-modal="false"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <el-form
      ref="formRef"
      :model="form"
      :rules="rules"
      label-width="84px"
      label-position="right"
    >
      <el-form-item :label="$t('levelForm.labelName')" prop="name">
        <el-input
          v-model="form.name"
          :disabled="isEdit"
          :placeholder="$t('levelForm.namePlaceholder')"
        />
        <div v-if="isEdit" class="hint">{{ $t('levelForm.nameImmutableHint') }}</div>
      </el-form-item>
      <el-form-item :label="$t('levelForm.labelDisplayName')">
        <el-input
          v-model="form.displayName"
          :placeholder="$t('levelForm.displayNamePlaceholder')"
        />
      </el-form-item>
      <el-form-item :label="$t('levelForm.labelLogo')">
        <div class="logo-row">
          <div v-if="form.logoUrl" class="logo-preview">
            <img :src="form.logoUrl" :alt="form.displayName || form.name" />
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
          <span class="hint">{{ $t("levelForm.logoHint") }}</span>
        </div>
      </el-form-item>
    </el-form>

    <template #footer>
      <el-button @click="close">{{ $t('common.cancel') }}</el-button>
      <el-button type="primary" :loading="submitting" @click="onSubmit">
        {{ isEdit ? $t('common.save') : $t('levelForm.createBtn') }}
      </el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.hint {
  font-size: 12px;
  color: var(--tc-text-dim);
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
</style>
