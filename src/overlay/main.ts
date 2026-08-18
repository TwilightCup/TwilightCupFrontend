/**
 * 导播叠加层独立入口（Vite 多入口之一，对应 overlay.html）。
 *
 * 只挂 Pinia（复用 director store），**不**挂 Element Plus / Router / global.css——
 * 叠加层轻量，OBS 浏览器源加载只需 Vue + Pinia + socket + gsap。
 * token 从 URL ?token= 取，WS 自鉴权连后端（seat=DIRECTOR）。
 */
import { createApp } from "vue";
import { createPinia } from "pinia";
import { i18n } from "@/locales";
import Overlay from "./Overlay.vue";

createApp(Overlay).use(createPinia()).use(i18n).mount("#overlay-app");
