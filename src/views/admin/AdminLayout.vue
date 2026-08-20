<script setup lang="ts">
import { computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useAuthStore } from "@/stores/auth";
import RoleSwitcher from "@/components/RoleSwitcher.vue";
import LanguageSwitcher from "@/components/LanguageSwitcher.vue";
import AccountMenu from "@/components/AccountMenu.vue";

const auth = useAuthStore();
const router = useRouter();
const route = useRoute();

const activeMenu = computed(() => route.path);

function logout(): void {
  auth.logout();
  router.replace("/login");
}
</script>

<template>
  <div class="layout">
    <header class="topbar">
      <div class="brand">
        <img src="/logo.png" class="logo" alt="logo" />
        <div>
          <div class="title">{{ $t('brand.admin') }}</div>
          <div class="subtitle">{{ $t('brand.adminSubtitle') }}</div>
        </div>
      </div>
      <div class="right">
        <span class="who">
          <el-tag type="danger" effect="dark" size="small">{{ $t('accountType.admin') }}</el-tag>
        </span>
        <RoleSwitcher />
        <LanguageSwitcher />
        <AccountMenu @logout="logout" />
      </div>
    </header>

    <div class="body">
      <aside class="sidebar">
        <el-menu :default-active="activeMenu" router>
          <el-menu-item index="/admin/matches">
            <el-icon><Trophy /></el-icon>
            <span>{{ $t('admin.menu.matches') }}</span>
          </el-menu-item>
          <el-menu-item index="/admin/tournaments">
            <el-icon><Medal /></el-icon>
            <span>{{ $t('admin.menu.tournaments') }}</span>
          </el-menu-item>
          <el-menu-item index="/admin/mappools">
            <el-icon><Files /></el-icon>
            <span>{{ $t('admin.menu.mappools') }}</span>
          </el-menu-item>
          <el-menu-item index="/admin/levels">
            <el-icon><MapLocation /></el-icon>
            <span>{{ $t('admin.menu.levels') }}</span>
          </el-menu-item>
          <el-menu-item index="/admin/accounts">
            <el-icon><User /></el-icon>
            <span>{{ $t('admin.menu.accounts') }}</span>
          </el-menu-item>
        </el-menu>
      </aside>

      <main class="content">
        <router-view />
      </main>
    </div>
  </div>
</template>

<style scoped>
.layout {
  height: 100%;
  display: flex;
  flex-direction: column;
}
.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 18px;
  background: var(--tc-bg-soft);
  border-bottom: 1px solid var(--tc-border);
}
.brand {
  display: flex;
  align-items: center;
  gap: 12px;
}
.logo {
  width: 26px;
  height: 26px;
  object-fit: contain;
}
.title {
  font-size: 16px;
  font-weight: 600;
}
.subtitle {
  color: var(--tc-text-dim);
  font-size: 12px;
  letter-spacing: 0.5px;
}
.right {
  display: flex;
  align-items: center;
  gap: 12px;
}
.who {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
}
.body {
  flex: 1;
  min-height: 0;
  display: flex;
}
.sidebar {
  width: 180px;
  flex-shrink: 0;
  background: var(--tc-bg-soft);
  border-right: 1px solid var(--tc-border);
}
.sidebar .el-menu {
  border-right: none;
}
.content {
  flex: 1;
  min-width: 0;
  padding: 16px;
  overflow: auto;
}
</style>
