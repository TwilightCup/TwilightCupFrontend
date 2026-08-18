<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import { useI18n } from "vue-i18n";

/**
 * 主题切换按钮：toggle html.dark 类 + 写 localStorage.twc_theme。
 * 与 index.html 的早设脚本配套（后者读 twc_theme / 系统偏好初始设类）。
 * 叠加层路由不显示，避免干扰 OBS 直播画面。
 */
const route = useRoute();
const { t } = useI18n();
const isDark = ref(true);

onMounted(() => {
  isDark.value = document.documentElement.classList.contains("dark");
});

function toggle(): void {
  isDark.value = !isDark.value;
  document.documentElement.classList.toggle("dark", isDark.value);
  localStorage.setItem("twc_theme", isDark.value ? "dark" : "light");
}
</script>

<template>
  <button
    v-if="route.path !== '/overlay'"
    class="theme-toggle"
    :title="isDark ? t('theme.toLight') : t('theme.toDark')"
    @click="toggle"
  >
    <el-icon>
      <!-- 当前深色 → 显示太阳（点击切浅）；当前浅色 → 显示月亮（点击切深） -->
      <Sunny v-if="isDark" />
      <Moon v-else />
    </el-icon>
  </button>
</template>

<style scoped>
.theme-toggle {
  position: fixed;
  right: 16px;
  bottom: 16px;
  z-index: 9999;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  border: 1px solid var(--tc-border);
  background: var(--tc-bg-soft);
  color: var(--tc-text);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
  transition: transform 0.15s, color 0.15s, border-color 0.15s;
}
.theme-toggle:hover {
  color: var(--tc-primary);
  border-color: var(--tc-primary);
  transform: scale(1.08);
}
</style>
