/**
 * 合并舞台的场景切换状态（localStorage 持久化 + 跨标签页同步）。
 *
 * 导播控制台点按钮 → setCurrentScene 写 localStorage；舞台页（另一标签/OBS 源）监听
 * 'storage' 事件即时切换。控制台与舞台同源同浏览器时生效（OBS CEF 需与控制台同进程
 * 分区，详见 StageScene 注释）。
 *
 * 非响应式状态本身：舞台页自己维护 currentScene ref，此处只提供读写 + 校验。
 */
import type { Ref } from "vue";

export type SceneKey = "overlay" | "match" | "mappool" | "bracket";

export const SCENE_KEYS: SceneKey[] = ["overlay", "match", "mappool", "bracket"];

export const SCENE_STORAGE_KEY = "twc-director-scene";

/** 最常用场景作默认 */
export const DEFAULT_SCENE: SceneKey = "match";

function isValid(v: unknown): v is SceneKey {
  return typeof v === "string" && (SCENE_KEYS as string[]).includes(v);
}

/** 读当前场景（localStorage + 校验，非法/缺失回退默认） */
export function getCurrentScene(): SceneKey {
  try {
    const v = localStorage.getItem(SCENE_STORAGE_KEY);
    return isValid(v) ? v : DEFAULT_SCENE;
  } catch {
    return DEFAULT_SCENE;
  }
}

/** 写当前场景（导播控制台点按钮时调） */
export function setCurrentScene(key: SceneKey): void {
  try {
    localStorage.setItem(SCENE_STORAGE_KEY, key);
  } catch {
    // 隐私模式 / 配额，忽略——本标签内仍即时生效（调用方自己更新本地 ref）
  }
}

/**
 * 舞台页用：维护响应式 currentScene，并监听跨标签 storage 事件。
 * 返回 ref + 清理函数（onUnmounted 调）。
 */
export function bindStageScene(current: Ref<SceneKey>): () => void {
  current.value = getCurrentScene();
  const onStorage = (e: StorageEvent): void => {
    if (e.key === SCENE_STORAGE_KEY && isValid(e.newValue)) {
      current.value = e.newValue;
    }
  };
  window.addEventListener("storage", onStorage);
  return () => window.removeEventListener("storage", onStorage);
}
