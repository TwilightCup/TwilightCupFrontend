<script setup lang="ts">
/**
 * 鉴权失败遮罩（各端复用）。
 *
 * 区分两种情况：
 * - 无活动比赛（多角色账号切到没有进行中比赛的端）：不登出，提供「返回主页」/切换端。
 * - 令牌失效/账号问题：建议重新登录。
 */
import { computed } from "vue";
import { useRouter } from "vue-router";
import { useAuthStore } from "@/stores/auth";
import RoleSwitcher from "@/components/RoleSwitcher.vue";

const props = defineProps<{ message: string }>();
const auth = useAuthStore();
const router = useRouter();

const isNoActivity = computed(() => {
  const m = props.message;
  return (
    m.includes("未找到") ||
    m.includes("未被指派") ||
    m.includes("进行中") ||
    m.includes("座位")
  );
});

function goHome(): void {
  router.replace(auth.roleHome());
}
function relogin(): void {
  auth.logout();
  router.replace("/login");
}
</script>

<template>
  <div class="auth-mask">
    <div class="auth-card">
      <div class="ac-title">
        {{ isNoActivity ? $t('authFail.noActivityTitle') : $t('authFail.failTitle') }}
      </div>
      <p class="ac-msg">{{ message }}</p>
      <p v-if="isNoActivity" class="ac-hint">
        {{ $t('authFail.noActivityHint') }}
      </p>
      <p v-else class="ac-hint">{{ $t('authFail.tokenExpiredHint') }}</p>
      <div class="ac-actions">
        <RoleSwitcher v-if="isNoActivity && auth.accountRoles.length > 1" />
        <el-button v-if="isNoActivity" type="primary" @click="goHome">
          {{ $t('authFail.goHome') }}
        </el-button>
        <el-button
          :type="isNoActivity ? 'default' : 'primary'"
          @click="relogin"
        >
          {{ $t('authFail.relogin') }}
        </el-button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.auth-mask {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.65);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}
.auth-card {
  width: 400px;
  max-width: calc(100vw - 32px);
  background: var(--tc-bg-soft);
  border: 1px solid var(--tc-border);
  border-radius: 12px;
  padding: 24px;
  text-align: center;
}
.ac-title {
  font-size: 18px;
  font-weight: 700;
  margin-bottom: 8px;
}
.ac-msg {
  color: #ff9a9a;
  margin: 0 0 6px;
  font-size: 13px;
}
.ac-hint {
  color: var(--tc-text-dim);
  font-size: 12px;
  margin: 0 0 16px;
  line-height: 1.6;
}
.ac-actions {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  flex-wrap: wrap;
}
</style>
