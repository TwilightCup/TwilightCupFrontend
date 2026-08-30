/**
 * 场景背景样式注册表。
 *
 * 所有场景最底层的太阳/网格背景（SynthwaveBg）从这里读取可选样式。
 * 新增背景样式的步骤：
 *  1. 在 SCENE_BACKGROUND_KEYS 追加一个唯一 key；
 *  2. 在 SCENE_BACKGROUND_OPTIONS 补充选项，labelKey 指向 i18n 文案；
 *  3. 在 SynthwaveBg.vue 中按该 key 增加对应的视觉样式分支。
 */
export const SCENE_BACKGROUND_KEYS = ["default", "synthwave"] as const;

export type SceneBackgroundKey = (typeof SCENE_BACKGROUND_KEYS)[number];

/** 默认背景 = 目前正在使用的合成器浪潮风（太阳 + 网格） */
export const DEFAULT_SCENE_BACKGROUND: SceneBackgroundKey = "default";

export interface SceneBackgroundOption {
  key: SceneBackgroundKey;
  /** i18n key，例如 scenes.backgrounds.default */
  labelKey: string;
}

export const SCENE_BACKGROUND_OPTIONS: SceneBackgroundOption[] = [
  { key: "default", labelKey: "scenes.backgrounds.default" },
  { key: "synthwave", labelKey: "scenes.backgrounds.synthwave" },
];

/** 校验未知字符串是否为合法的背景 key（state_sync / localStorage 防脏） */
export function isSceneBackgroundKey(v: unknown): v is SceneBackgroundKey {
  return (
    typeof v === "string" &&
    (SCENE_BACKGROUND_KEYS as readonly string[]).includes(v)
  );
}

/** 规范化背景 key：非法输入回退默认，保证配置面板/场景渲染永远有可用值。 */
export function normalizeSceneBackground(v: unknown): SceneBackgroundKey {
  return isSceneBackgroundKey(v) ? v : DEFAULT_SCENE_BACKGROUND;
}
