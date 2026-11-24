<script setup lang="ts">
/**
 * 顶栏账号下拉：展示当前账号名，下拉提供「账号设置」（改展示名/口令）与「登出」。
 * 登出通过 emit('logout') 交由父级处理（各端登出后跳转不同）；设置弹窗内置。
 *
 * 顶栏 / 下拉均显示「用户名（展示名）」，不再回显 UUID；老会话（localStorage 无
 * username，刷新前未重登）回退到展示名 / 占位。
 */
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useAuthStore } from "@/stores/auth";
import AccountSettingsDialog from "./AccountSettingsDialog.vue";

const emit = defineEmits<{ (e: "logout"): void }>();

const auth = useAuthStore();
const { t } = useI18n();
const settingsOpen = ref(false);

/** 主显示：username（display_name）；缺 username 时回退展示名 / 占位 */
const label = computed(() => {
  const u = auth.username;
  const d = auth.displayName;
  if (u && d && u !== d) return `${u}（${d}）`;
  return u || d || t("account.menu.accountFallback");
});

function onCommand(cmd: string): void {
  if (cmd === "settings") settingsOpen.value = true;
  else if (cmd === "logout") emit("logout");
}
</script>

<template>
  <el-dropdown trigger="click" size="small" @command="onCommand">
    <span class="acct">
      <el-icon><User /></el-icon>
      <span class="name">{{ label }}</span>
      <el-icon class="caret"><ArrowDown /></el-icon>
    </span>
    <template #dropdown>
      <el-dropdown-menu>
        <el-dropdown-item disabled command="">
          <span class="uid">{{ label }}</span>
        </el-dropdown-item>
        <el-dropdown-item command="settings" divided>
          <el-icon><Setting /></el-icon> {{ t("account.menu.settings") }}
        </el-dropdown-item>
        <el-dropdown-item command="logout">
          <el-icon><SwitchButton /></el-icon> {{ t("account.menu.logout") }}
        </el-dropdown-item>
      </el-dropdown-menu>
    </template>
  </el-dropdown>

  <AccountSettingsDialog v-model="settingsOpen" />
</template>

<style scoped>
.acct {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  cursor: pointer;
  height: 24px;
  padding: 0 10px;
  box-sizing: border-box;
  border-radius: 6px;
  border: 1px solid var(--tc-border);
  background: var(--tc-hover);
  color: var(--tc-text);
  font-size: 12px;
  user-select: none;
}
.acct:hover {
  border-color: var(--tc-primary);
  color: var(--tc-primary);
}
.name {
  font-weight: 600;
  max-width: 140px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.caret {
  font-size: 10px;
  color: var(--tc-text-dim);
}
.uid {
  color: var(--tc-text-dim);
  font-size: 12px;
}
</style>
