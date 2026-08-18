<script setup lang="ts">
import { useRouter } from "vue-router";
import { useAuthStore } from "@/stores/auth";
import { accountTypeInfo } from "@/utils/format";

const auth = useAuthStore();
const router = useRouter();

const roleLabel = accountTypeInfo(auth.accountType).label;

function logout(): void {
  auth.logout();
  router.replace("/login");
}
</script>

<template>
  <div class="pending-page">
    <div class="card">
      <div class="emoji">🚧</div>
      <h1>{{ $t("pending.title", { role: roleLabel }) }}</h1>
      <p class="msg">{{ $t("pending.desc", { role: roleLabel }) }}</p>
      <el-button type="primary" @click="logout">{{ $t("pending.switchAccount") }}</el-button>
    </div>
  </div>
</template>

<style scoped>
.pending-page {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: radial-gradient(circle at 30% 20%, var(--tc-bg-soft), var(--tc-bg) 60%);
}
.card {
  width: 400px;
  max-width: calc(100vw - 32px);
  padding: 32px;
  background: var(--tc-bg-soft);
  border: 1px solid var(--tc-border);
  border-radius: 14px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.45);
  text-align: center;
}
.emoji {
  font-size: 48px;
  line-height: 1;
}
.card h1 {
  margin: 14px 0 10px;
  font-size: 20px;
}
.msg {
  margin: 0 0 20px;
  color: var(--tc-text-dim);
  font-size: 13px;
  line-height: 1.7;
  white-space: pre-line;
}
</style>
