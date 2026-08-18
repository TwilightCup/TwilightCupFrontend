/**
 * 合并舞台独立入口（Vite 多入口之一，对应 stage.html）。
 *
 * 与 overlay 入口同构：只挂 Pinia + i18n（不挂 Router / Element Plus / global.css），
 * 改挂合成器浪潮场景主题。token 从 URL ?token= 取，?match= / ?tournament= 指定数据源。
 * 舞台内 4 场景由导播控制台经 localStorage 跨标签切换（见 useStageScene）。
 */
import { createApp } from "vue";
import { createPinia } from "pinia";
import { i18n } from "@/locales";
import "@/scenes/scene-theme.css";
import StageScene from "./StageScene.vue";

createApp(StageScene).use(createPinia()).use(i18n).mount("#stage-app");
