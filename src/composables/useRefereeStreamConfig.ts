/**
 * 裁判端选手画面配置（复用导播端的 localStorage 持久化）。
 *
 * 与导播端共用同一份 HLS/嵌入地址，裁判和导播打开同一场时无需重复填写。
 * 这里把 useDirectorConfig 的实例做成模块级单例，保证裁判端监控面板与
 * 顶栏「选手画面」配置下拉共享同一份响应式配置。
 */
import { useDirectorConfig } from "@/scenes/composables/useDirectorConfig";

let singleton: ReturnType<typeof useDirectorConfig> | null = null;

export function useRefereeStreamConfig(): ReturnType<typeof useDirectorConfig> {
  if (!singleton) singleton = useDirectorConfig();
  return singleton;
}
