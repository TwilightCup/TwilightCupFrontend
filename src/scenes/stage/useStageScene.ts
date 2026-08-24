/**
 * 合并舞台的场景切换状态。
 *
 * 场景切换一律走 WS 广播（director_command switch_scene → 后端只发给同比赛
 * 同账号的其他 DIRECTOR 连接），舞台初始场景由连接时的 state_sync 回放对齐。
 * 早期同进程 localStorage（twc-director-scene）兜底已删：该键同源全局共享、
 * 不分账号——同机同浏览器开两个导播会互相切台，属隔离漏洞；且 WS 链路
 * （广播 + 指令排队补发 + 断线回放）已完整覆盖其全部场景。
 */

export type SceneKey = "categoryinfo" | "match" | "mappool" | "bracket" | "soon";

export const SCENE_KEYS: SceneKey[] = [
  "categoryinfo",
  "match",
  "mappool",
  "bracket",
  "soon",
];

/** 默认场景（state_sync 到达前的初始值） */
export const DEFAULT_SCENE: SceneKey = "match";

/** 校验未知字符串是否为合法场景键（state_sync 回放值防脏） */
export function isSceneKey(v: unknown): v is SceneKey {
  return typeof v === "string" && (SCENE_KEYS as string[]).includes(v);
}
