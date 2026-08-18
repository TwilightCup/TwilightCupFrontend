/**
 * 场景双模式契约：让场景组件既能独立 .html 入口跑（自己读 URL、自己连 WS），
 * 又能内嵌进合并舞台 stage（host 代读参数 / 代连 WS / 提供共享背景）。
 *
 * 用 provide/inject 而非纯 props：避免把 token/match/tournament + 8 个流/PB/历史字段
 * 透传到 4 个场景（prop 爆炸）。host（StageScene）provide 一份上下文；独立入口不 provide，
 * useSceneContext() 走默认 standalone 值 → 行为与改造前完全一致（零回归）。
 */
import { inject, type InjectionKey } from "vue";
import { useSceneParams, type SceneParams } from "./useSceneParams";

export interface SceneContext {
  /** URL 参数（host 已解析；standalone 模式场景自己 useSceneParams） */
  params: SceneParams;
  /** true=host 管 WS 连接，场景不得 connect/disconnect */
  hosted: boolean;
  /** true=host 提供共享 SynthwaveBg，场景应省略自己的背景 */
  sharedBg: boolean;
}

export const SCENE_CONTEXT_KEY: InjectionKey<SceneContext> = Symbol("sceneContext");

/**
 * 取场景上下文。无 provider（独立入口）时回退 standalone 默认：
 * 自己读 location.search、自己连 WS、用自己的背景。
 */
export function useSceneContext(): SceneContext {
  const ctx = inject(SCENE_CONTEXT_KEY, null);
  return (
    ctx ?? {
      params: useSceneParams(),
      hosted: false,
      sharedBg: false,
    }
  );
}
