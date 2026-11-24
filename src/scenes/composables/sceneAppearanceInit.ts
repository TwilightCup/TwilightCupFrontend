/**
 * 场景页启动时应用已保存的选手主题色。
 *
 * 场景页是独立入口/独立文档，不经过 DirectorView；这个副作用模块在每个场景
 * main.ts import 一次：
 *  - 从 URL ?match= 读取本场配置并落到 :root CSS 变量；
 *  - 监听同源 localStorage 的 storage 事件（导播控制台同浏览器保存后即时生效）；
 *  - WS config_update 的实时生效由 director store → mergeStoredConfig 统一处理。
 */
import { applyStoredAppearance } from "./useDirectorConfig";

const matchId = new URLSearchParams(globalThis.location.search).get("match") ?? "";
applyStoredAppearance(matchId);

window.addEventListener("storage", (e) => {
  if (e.key === `twc-director-cfg:${matchId || "_global_"}`) {
    applyStoredAppearance(matchId);
  }
});
