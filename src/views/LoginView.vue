<script setup lang="ts">
import { ref } from "vue";
import { useRouter } from "vue-router";
import { ElMessage } from "element-plus";
import { useI18n } from "vue-i18n";
import { useAuthStore } from "@/stores/auth";

const { t } = useI18n();
const auth = useAuthStore();
const router = useRouter();

const username = ref("");
const password = ref("");
const loading = ref(false);

async function onSubmit(): Promise<void> {
  if (!username.value || !password.value) {
    ElMessage.warning(t("login.requireBoth"));
    return;
  }
  loading.value = true;
  const ok = await auth.login({
    username: username.value.trim(),
    password: password.value,
  });
  loading.value = false;
  if (ok) {
    router.replace(auth.roleHome());
  }
}
</script>

<template>
  <div class="login-page">
    <div class="login-card">
      <div class="brand">
        <div class="logo">🌇</div>
        <h1>{{ $t("brand.appTitle") }}</h1>
        <p class="subtitle">{{ $t("brand.subtitle") }}</p>
      </div>

      <el-alert
        v-if="auth.loginError"
        :title="auth.loginError"
        type="error"
        show-icon
        :closable="false"
        class="alert"
      />

      <el-form @submit.prevent="onSubmit" label-position="top">
        <el-form-item :label="$t('login.username')">
          <el-input
            v-model="username"
            :placeholder="$t('login.usernamePlaceholder')"
            autocomplete="username"
            clearable
            @keyup.enter="onSubmit"
          />
        </el-form-item>
        <el-form-item :label="$t('login.password')">
          <el-input
            v-model="password"
            type="password"
            :placeholder="$t('login.passwordPlaceholder')"
            autocomplete="current-password"
            show-password
            @keyup.enter="onSubmit"
          />
        </el-form-item>
        <el-button
          type="primary"
          class="submit"
          :loading="loading"
          @click="onSubmit"
        >
          {{ $t("login.submit") }}
        </el-button>
      </el-form>

      <p class="hint">
        {{
          $t("login.hint", { env: ".env", urlKey: "VITE_BACKEND_URL" })
        }}
      </p>
    </div>
  </div>
</template>

<style scoped>
.login-page {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: radial-gradient(circle at 30% 20%, var(--tc-bg-soft), var(--tc-bg) 60%);
}
.login-card {
  width: 380px;
  max-width: calc(100vw - 32px);
  padding: 32px;
  background: var(--tc-bg-soft);
  border: 1px solid var(--tc-border);
  border-radius: 14px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.45);
}
.brand {
  text-align: center;
  margin-bottom: 20px;
}
.logo {
  font-size: 44px;
  line-height: 1;
}
.brand h1 {
  margin: 10px 0 2px;
  font-size: 22px;
}
.subtitle {
  margin: 0;
  color: var(--tc-text-dim);
  font-size: 12px;
  letter-spacing: 0.5px;
}
.alert {
  margin-bottom: 16px;
}
.submit {
  width: 100%;
}
.hint {
  margin: 16px 0 0;
  color: var(--tc-text-dim);
  font-size: 12px;
  line-height: 1.6;
}
.hint code {
  background: var(--tc-bg);
  padding: 1px 5px;
  border-radius: 4px;
}
</style>
