/**
 * 比赛详情场景页独立入口（Vite 多入口之一，对应 match-scene.html）。
 *
 * 与 overlay 入口同构：只挂 Pinia + i18n（不挂 Router / Element Plus / global.css），
 * 改挂合成器浪潮场景主题。token 从 URL ?token= 取，?match= 指定比赛会话（连 WS）。
 */
import { createApp } from "vue";
import { createPinia } from "pinia";
import { i18n } from "@/locales";
import "@/scenes/scene-theme.css";
import MatchScene from "./MatchScene.vue";

createApp(MatchScene).use(createPinia()).use(i18n).mount("#match-app");
