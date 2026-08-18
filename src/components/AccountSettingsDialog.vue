<script setup lang="ts">
import { reactive, ref, watch } from "vue";
import type { FormInstance, FormRules } from "element-plus";
import { ElMessage } from "element-plus";
import { useI18n } from "vue-i18n";
import { api, ApiError } from "@/api/client";
import { useAuthStore } from "@/stores/auth";

/**
 * 账号自助设置弹窗（任意已登录账号）：
 * - 改展示名：PATCH /me（非敏感，无需旧口令）
 * - 改口令：POST /me/password（须校验旧口令，新口令至少 4 位）
 * 直接调 api 并以 ElMessage 提示；改名成功后同步 auth.displayName。
 */
const { t } = useI18n();
const props = defineProps<{ modelValue: boolean }>();
const emit = defineEmits<{
  (e: "update:modelValue", v: boolean): void;
}>();

const auth = useAuthStore();
const activeTab = ref("name");

const nameFormRef = ref<FormInstance>();
const nameSubmitting = ref(false);
const nameForm = reactive({ display_name: "" });
const nameRules: FormRules = {
  display_name: [
    { required: true, message: t("settings.displayNameRequired"), trigger: "blur" },
  ],
};

const pwdFormRef = ref<FormInstance>();
const pwdSubmitting = ref(false);
const pwdForm = reactive({
  old_password: "",
  new_password: "",
  confirm: "",
});
const pwdRules: FormRules = {
  old_password: [
    { required: true, message: t("settings.oldPasswordRequired"), trigger: "blur" },
  ],
  new_password: [
    { required: true, message: t("settings.newPasswordRequired"), trigger: "blur" },
    { min: 4, message: t("settings.newPasswordMin"), trigger: "blur" },
  ],
  confirm: [
    { required: true, message: t("settings.confirmRequired"), trigger: "blur" },
    {
      validator: (_r, v, cb) => {
        if (v !== pwdForm.new_password)
          cb(new Error(t("settings.confirmMismatch")));
        else cb();
      },
      trigger: "blur",
    },
  ],
};

watch(
  () => props.modelValue,
  (open) => {
    if (!open) return;
    activeTab.value = "name";
    nameForm.display_name = auth.displayName;
    pwdForm.old_password = "";
    pwdForm.new_password = "";
    pwdForm.confirm = "";
    nameFormRef.value?.clearValidate();
    pwdFormRef.value?.clearValidate();
  },
);

function close(): void {
  emit("update:modelValue", false);
}

function errMsg(e: unknown, fallback: string): string {
  return e instanceof ApiError ? e.message : fallback;
}

async function onSubmitName(): Promise<void> {
  if (!nameFormRef.value) return;
  try {
    await nameFormRef.value.validate();
  } catch {
    return;
  }
  const name = nameForm.display_name.trim();
  if (!auth.token) return;
  nameSubmitting.value = true;
  try {
    const acc = await api.updateDisplayName({ display_name: name }, auth.token);
    auth.applyDisplayName(acc.display_name);
    ElMessage.success(t("settings.displayNameUpdated"));
    close();
  } catch (e) {
    ElMessage.error(errMsg(e, t("settings.displayNameFail")));
  } finally {
    nameSubmitting.value = false;
  }
}

async function onSubmitPassword(): Promise<void> {
  if (!pwdFormRef.value) return;
  try {
    await pwdFormRef.value.validate();
  } catch {
    return;
  }
  if (!auth.token) return;
  pwdSubmitting.value = true;
  try {
    await api.changePassword(
      {
        old_password: pwdForm.old_password,
        new_password: pwdForm.new_password,
      },
      auth.token,
    );
    ElMessage.success(t("settings.passwordUpdated"));
    pwdForm.old_password = "";
    pwdForm.new_password = "";
    pwdForm.confirm = "";
    close();
  } catch (e) {
    ElMessage.error(errMsg(e, t("settings.passwordFail")));
  } finally {
    pwdSubmitting.value = false;
  }
}
</script>

<template>
  <el-dialog
    :model-value="modelValue"
    :title="$t('settings.title')"
    width="440px"
    :close-on-click-modal="false"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <el-tabs v-model="activeTab">
      <el-tab-pane :label="$t('settings.tab.name')" name="name">
        <el-form
          ref="nameFormRef"
          :model="nameForm"
          :rules="nameRules"
          label-width="80px"
          label-position="right"
          @submit.prevent
        >
          <el-form-item :label="$t('settings.label.account')" v-if="auth.username || auth.accountId">
            <span class="dim">
              <template v-if="auth.username && auth.displayName && auth.username !== auth.displayName">
                {{ auth.username }}（{{ auth.displayName }}）
              </template>
              <template v-else>{{ auth.username || auth.displayName || auth.accountId }}</template>
            </span>
          </el-form-item>
          <el-form-item :label="$t('settings.label.displayName')" prop="display_name">
            <el-input
              v-model="nameForm.display_name"
              :placeholder="$t('settings.displayNamePlaceholder')"
              maxlength="32"
            />
          </el-form-item>
        </el-form>
        <div class="dialog-foot">
          <el-button @click="close">{{ $t("common.cancel") }}</el-button>
          <el-button type="primary" :loading="nameSubmitting" @click="onSubmitName">
            {{ $t("common.save") }}
          </el-button>
        </div>
      </el-tab-pane>

      <el-tab-pane :label="$t('settings.tab.password')" name="password">
        <el-form
          ref="pwdFormRef"
          :model="pwdForm"
          :rules="pwdRules"
          label-width="80px"
          label-position="right"
          @submit.prevent
        >
          <el-form-item :label="$t('settings.label.oldPassword')" prop="old_password">
            <el-input
              v-model="pwdForm.old_password"
              type="password"
              show-password
              autocomplete="current-password"
            />
          </el-form-item>
          <el-form-item :label="$t('settings.label.newPassword')" prop="new_password">
            <el-input
              v-model="pwdForm.new_password"
              type="password"
              show-password
              autocomplete="new-password"
            />
          </el-form-item>
          <el-form-item :label="$t('settings.label.confirm')" prop="confirm">
            <el-input
              v-model="pwdForm.confirm"
              type="password"
              show-password
              autocomplete="new-password"
            />
          </el-form-item>
        </el-form>
        <div class="dialog-foot">
          <el-button @click="close">{{ $t("common.cancel") }}</el-button>
          <el-button type="primary" :loading="pwdSubmitting" @click="onSubmitPassword">
            {{ $t("settings.passwordChangeBtn") }}
          </el-button>
        </div>
      </el-tab-pane>
    </el-tabs>
  </el-dialog>
</template>

<style scoped>
.dim {
  color: var(--tc-text-dim);
  font-size: 12px;
  font-family: monospace;
}
.dialog-foot {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 8px;
}
</style>
