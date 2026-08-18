<script setup lang="ts">
import { watch } from "vue";
import ThemeToggle from "@/components/ThemeToggle.vue";
import { useI18n } from "vue-i18n";
import { epLocale, currentLocaleTag } from "@/composables/useElementLocale";

const { t } = useI18n();

// <title> 随语言切换更新
watch(
  currentLocaleTag,
  () => {
    document.title = t("brand.appTitle");
  },
  { immediate: true },
);
</script>

<template>
  <el-config-provider :locale="epLocale">
    <router-view />
    <ThemeToggle />
  </el-config-provider>
</template>
