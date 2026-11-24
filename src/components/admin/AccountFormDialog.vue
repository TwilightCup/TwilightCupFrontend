<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import type { FormInstance, FormRules } from "element-plus";
import { useI18n } from "vue-i18n";
import { useAdminStore } from "@/stores/admin";
import {
  AccountType,
  type AccountOut,
  type AccountUpdate,
} from "@/api/types";

const props = defineProps<{
  modelValue: boolean;
  /** 传入则为编辑该账号，null 为新建 */
  account: AccountOut | null;
}>();
const emit = defineEmits<{
  (e: "update:modelValue", v: boolean): void;
  (e: "done"): void;
}>();

const { t } = useI18n();
const admin = useAdminStore();
const formRef = ref<FormInstance>();
const submitting = ref(false);

const isEdit = computed(() => !!props.account);
const title = computed(() =>
  isEdit.value ? t("accountForm.titleEdit") : t("accountForm.titleCreate"),
);

interface FormState {
  username: string;
  password: string;
  displayName: string;
  roles: AccountType[];
  speedrunId: string;
}

const form = reactive<FormState>({
  username: "",
  password: "",
  displayName: "",
  roles: [AccountType.PLAYER],
  speedrunId: "",
});

const roleOptions = computed<{ value: AccountType; label: string }[]>(() => [
  { value: AccountType.PLAYER, label: t("accountType.player") },
  { value: AccountType.REFEREE, label: t("accountType.referee") },
  { value: AccountType.DIRECTOR, label: t("accountType.director") },
  { value: AccountType.ADMIN, label: t("accountType.admin") },
]);

// 编辑模式 username/password 非必填（密码留空 = 保持原密码）
const rules = computed<FormRules>(() => {
  const needCreds = !isEdit.value;
  return {
    username: needCreds
      ? [{ required: true, message: t("accountForm.usernameRequired"), trigger: "blur" }]
      : [],
    password: needCreds
      ? [{ required: true, message: t("accountForm.passwordRequired"), trigger: "blur" }]
      : [],
    displayName: [
      { required: true, message: t("accountForm.displayNameRequired"), trigger: "blur" },
    ],
    roles: [
      {
        type: "array",
        required: true,
        min: 1,
        message: t("accountForm.rolesRequired"),
        trigger: "change",
      },
    ],
  };
});

watch(
  () => props.modelValue,
  (open) => {
    if (!open) return;
    if (props.account) {
      form.username = props.account.username;
      form.password = "";
      form.displayName = props.account.display_name;
      form.roles = [...props.account.roles];
      form.speedrunId = props.account.speedrun_id ?? "";
    } else {
      form.username = "";
      form.password = "";
      form.displayName = "";
      form.roles = [AccountType.PLAYER];
      form.speedrunId = "";
    }
    formRef.value?.clearValidate();
  },
);

// 勾选「管理员」时自动带上裁判 + 导播（与后端 _normalize_roles 一致）
watch(
  () => form.roles,
  (roles) => {
    if (roles.includes(AccountType.ADMIN)) {
      const next = new Set(roles);
      next.add(AccountType.REFEREE);
      next.add(AccountType.DIRECTOR);
      if (next.size > roles.length) {
        form.roles = [...next];
      }
    }
  },
);

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
  submitting.value = true;
  let ok = false;
  if (props.account) {
    const body: AccountUpdate = {
      display_name: form.displayName.trim(),
      roles: form.roles,
      // 空串 = 解绑（后端 strip 后置 None）
      speedrun_id: form.speedrunId.trim(),
    };
    if (form.password) body.password = form.password;
    ok = await admin.updateAccount(props.account.id, body);
  } else {
    ok = await admin.createAccount({
      username: form.username.trim(),
      password: form.password,
      display_name: form.displayName.trim(),
      roles: form.roles,
      speedrun_id: form.speedrunId.trim() || null,
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
      <el-form-item :label="$t('accountForm.labelUsername')" prop="username">
        <el-input
          v-model="form.username"
          :disabled="isEdit"
          :placeholder="$t('accountForm.usernamePlaceholder')"
          autocomplete="off"
        />
      </el-form-item>
      <el-form-item :label="$t('accountForm.labelPassword')" prop="password">
        <el-input
          v-model="form.password"
          type="password"
          show-password
          :placeholder="isEdit ? $t('accountForm.passwordPlaceholderEdit') : $t('accountForm.passwordPlaceholderCreate')"
          autocomplete="new-password"
        />
      </el-form-item>
      <el-form-item :label="$t('accountForm.labelDisplayName')" prop="displayName">
        <el-input v-model="form.displayName" :placeholder="$t('accountForm.displayNamePlaceholder')" />
      </el-form-item>
      <el-form-item :label="$t('accountForm.labelRoles')" prop="roles">
        <el-checkbox-group v-model="form.roles">
          <el-checkbox
            v-for="o in roleOptions"
            :key="o.value"
            :value="o.value"
          >
            {{ o.label }}
          </el-checkbox>
        </el-checkbox-group>
        <div class="role-hint">{{ $t('accountForm.adminRoleHint') }}</div>
      </el-form-item>
      <el-form-item :label="$t('accountForm.labelSpeedrun')">
        <el-input
          v-model="form.speedrunId"
          :placeholder="$t('accountForm.speedrunPlaceholder')"
        />
        <div class="role-hint">{{ $t('accountForm.speedrunHint') }}</div>
      </el-form-item>
    </el-form>

    <template #footer>
      <el-button @click="close">{{ $t('common.cancel') }}</el-button>
      <el-button type="primary" :loading="submitting" @click="onSubmit">
        {{ isEdit ? $t('common.save') : $t('accountForm.createBtn') }}
      </el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.role-hint {
  font-size: 12px;
  color: var(--tc-text-dim);
  margin-top: 2px;
}
</style>
