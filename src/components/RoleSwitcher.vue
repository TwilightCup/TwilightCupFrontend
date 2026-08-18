<script setup lang="ts">
/**
 * 顶栏「切换端」入口：按当前账号的多角色列出可用端，点击切换路由。
 * 仅当账号拥有 >1 个角色时才显示（单角色账号无切换需求）。
 */
import { computed } from "vue";
import { useRoute } from "vue-router";
import { useI18n } from "vue-i18n";
import { useAuthStore } from "@/stores/auth";
import { AccountType } from "@/api/types";

const auth = useAuthStore();
const route = useRoute();
const { t } = useI18n();

interface Endpoint {
  role: AccountType;
  labelKey: string;
  prefix: string;
  path: string;
}

const ENDPOINTS: Endpoint[] = [
  { role: AccountType.ADMIN, labelKey: "role.admin", prefix: "/admin", path: "/admin/matches" },
  { role: AccountType.REFEREE, labelKey: "role.referee", prefix: "/referee", path: "/referee" },
  { role: AccountType.DIRECTOR, labelKey: "role.director", prefix: "/director", path: "/director" },
  { role: AccountType.PLAYER, labelKey: "role.player", prefix: "/player", path: "/player" },
];

const available = computed(() => ENDPOINTS.filter((e) => auth.hasRole(e.role)));
const currentLabel = computed(() => {
  const m = ENDPOINTS.find((e) => route.path.startsWith(e.prefix));
  return m ? t(m.labelKey) : t("role.switch");
});

function go(path: string): void {
  // 多角色切端默认在新窗口打开，原窗口保留——可同时开多个端
  window.open(path, "_blank", "noopener");
}
</script>

<template>
  <el-dropdown
    v-if="available.length > 1"
    trigger="click"
    size="small"
    @command="go"
  >
    <span class="switcher">
      <el-icon><Switch /></el-icon>
      <span class="label">{{ currentLabel }}</span>
      <el-icon class="caret"><ArrowDown /></el-icon>
    </span>
    <template #dropdown>
      <el-dropdown-menu>
        <el-dropdown-item
          v-for="e in available"
          :key="e.role"
          :command="e.path"
        >
          {{ t(e.labelKey) }}
          <el-tag
            v-if="route.path.startsWith(e.prefix)"
            size="small"
            type="success"
            effect="dark"
            class="cur"
          >{{ t("role.current") }}</el-tag>
        </el-dropdown-item>
      </el-dropdown-menu>
    </template>
  </el-dropdown>
</template>

<style scoped>
.switcher {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  cursor: pointer;
  padding: 4px 10px;
  border-radius: 6px;
  border: 1px solid var(--tc-border);
  background: var(--tc-hover);
  color: var(--tc-text);
  font-size: 12px;
  user-select: none;
}
.switcher:hover {
  border-color: var(--tc-primary);
  color: var(--tc-primary);
}
.label {
  font-weight: 600;
}
.caret {
  font-size: 10px;
  color: var(--tc-text-dim);
}
.cur {
  margin-left: 8px;
}
</style>
