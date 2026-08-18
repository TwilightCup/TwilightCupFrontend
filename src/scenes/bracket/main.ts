/**
 * 赛程图场景页独立入口（Vite 多入口之一，对应 bracket.html）。
 *
 * 与 overlay 入口同构：只挂 Pinia + i18n（不挂 Router / Element Plus / global.css），
 * 改挂合成器浪潮场景主题。token 从 URL ?token= 取，?tournament= 指定赛事。
 */
import { createApp } from "vue";
import { createPinia } from "pinia";
import { i18n } from "@/locales";
import "@/scenes/scene-theme.css";
import BracketScene from "./BracketScene.vue";

createApp(BracketScene).use(createPinia()).use(i18n).mount("#bracket-app");
