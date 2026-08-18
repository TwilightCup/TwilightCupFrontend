<script setup lang="ts">
/**
 * 顶栏语言切换：列出仓库内已注册的 locale，点击切换并持久化（localStorage.twc_locale）。
 * Element Plus 组件内置文案随语言切换（由 App.vue 的 <el-config-provider> 桥接）。
 * 叠加层路由不显示，避免干扰 OBS 直播画面。
 */
import { computed } from "vue";
import { useRoute } from "vue-router";
import { useI18n } from "vue-i18n";
import { LOCALES, setLocale, currentLocaleTag } from "@/locales";

const route = useRoute();
const { t } = useI18n();

const current = computed(() => currentLocaleTag());

function onCommand(tag: string): void {
  setLocale(tag as (typeof LOCALES)[number]["tag"]);
}
</script>

<template>
  <el-dropdown
    v-if="route.path !== '/overlay'"
    trigger="click"
    size="small"
    @command="onCommand"
  >
    <span class="lang" :title="t('language.switch')">
      <el-icon><Promotion /></el-icon>
      <span class="label">{{ current }}</span>
      <el-icon class="caret"><ArrowDown /></el-icon>
    </span>
    <template #dropdown>
      <el-dropdown-menu>
        <el-dropdown-item
          v-for="loc in LOCALES"
          :key="loc.tag"
          :command="loc.tag"
        >
          {{ loc.label }}
          <el-tag
            v-if="loc.tag === current"
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
.lang {
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
.lang:hover {
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
