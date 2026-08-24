/**
 * 图池场景页独立入口（Vite 多入口之一，对应 mappool.html）。
 *
 * 与场景页入口同构：只挂 Pinia + i18n（不挂 Router / Element Plus / global.css），
 * 改挂合成器浪潮场景主题。token 从 URL ?token= 取。
 */
import { createApp } from "vue";
import { createPinia } from "pinia";
import { i18n } from "@/locales";
import "@/scenes/scene-theme.css";
import MappoolScene from "./MappoolScene.vue";

createApp(MappoolScene).use(createPinia()).use(i18n).mount("#mappool-app");
