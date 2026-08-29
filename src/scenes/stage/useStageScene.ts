/**
 * 合并舞台的场景切换状态。
 *
 * 主通道是 WS 广播（director_command switch_scene → 后端只发给同比赛同账号的
 * 其他 DIRECTOR 连接），舞台初始场景由连接时的 state_sync 回放对齐。
 *
 * 另保留一个按「账号 + 比赛」隔离的同源 localStorage 兜底：控制台与舞台在
 * 同一浏览器/同一 OBS CEF storage 分区时，即使 WS 广播暂时未达也能即时切换；
 * 键含 accountId，避免旧全局键导致同机不同导播互相切台。
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

const SCENE_STORAGE_PREFIX = "twc-director-scene";

/** 校验未知字符串是否为合法场景键（state_sync 回放值防脏） */
export function isSceneKey(v: unknown): v is SceneKey {
  return typeof v === "string" && (SCENE_KEYS as string[]).includes(v);
}

/** 按「账号 + 比赛」隔离的场景键；缺账号/比赛时仍用可读的兜底段。 */
export function sceneStorageKey(accountId: string, matchId: string): string {
  return `${SCENE_STORAGE_PREFIX}:${accountId || "_"}:${matchId || "_"}`;
}

/** 读同源缓存的当前场景（非法/缺失返回 null，由调用方决定回退）。 */
export function readStoredScene(accountId: string, matchId: string): SceneKey | null {
  try {
    const raw = localStorage.getItem(sceneStorageKey(accountId, matchId));
    return isSceneKey(raw) ? raw : null;
  } catch {
    return null;
  }
}

/** 写同源缓存当前场景（导播控制台切场景时调用，舞台 storage 事件同步）。 */
export function writeStoredScene(
  accountId: string,
  matchId: string,
  key: SceneKey,
): void {
  try {
    localStorage.setItem(sceneStorageKey(accountId, matchId), key);
  } catch {
    // 隐私模式 / 配额满：忽略，WS 广播仍为主通道
  }
}
