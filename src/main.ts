import { createApp } from "vue";
import type { Component } from "vue";
import { createPinia } from "pinia";
import ElementPlus from "element-plus";
import "element-plus/dist/index.css";
import "element-plus/theme-chalk/dark/css-vars.css";
import * as ElementPlusIconsVue from "@element-plus/icons-vue";

import App from "./App.vue";
import router from "./router";
import { i18n } from "@/locales";
import { syncElementLocale } from "@/composables/useElementLocale";
import { setSessionExpiredHandler } from "@/api/client";
import { useAuthStore } from "@/stores/auth";
import "@/styles/global.css";

const app = createApp(App);

// 全局注册 Element Plus 图标
for (const [key, component] of Object.entries(ElementPlusIconsVue)) {
  app.component(key, component as Component);
}

const pinia = createPinia();
app.use(pinia);
app.use(router);
app.use(i18n);
app.use(ElementPlus); // 组件内置文案由 App.vue 的 <el-config-provider> 按 locale 切换

// 令牌过期（REST 401 / WS 鉴权失败）统一登出并跳回登录页（带过期提示）。
// 场景独立入口（OBS 画面）不注册此处理器，保持兜底展示不跳转。
setSessionExpiredHandler(() => {
  useAuthStore(pinia).logout();
  if (router.currentRoute.value.name !== "login") {
    void router.replace({ name: "login", query: { expired: "1" } });
  }
});

// 启动 Element Plus locale 响应式桥接（随 i18n locale 动态加载语言包）
syncElementLocale();

app.mount("#app");
