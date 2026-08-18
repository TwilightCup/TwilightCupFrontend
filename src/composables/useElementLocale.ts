/**
 * Element Plus locale 响应式桥接：随 i18n 当前 locale 切换，按需动态 import 对应的
 * Element Plus 语言包，供 <el-config-provider :locale> 使用。
 *
 * Element Plus 组件内置文案（分页 / 日期选择器 / 表格空提示 / …）据此本地化。
 */
import { ref, watch } from "vue";
import type { Ref } from "vue";
import { currentLocaleTag, type SupportedLocale } from "@/locales";

/** 已加载的 EP locale 包缓存（ep 名 → 包）。 */
const cache = new Map<string, unknown>();

/** 当前 EP locale 包（供 el-config-provider :locale）。 */
export const epLocale: Ref<unknown> = ref(null);

async function loadEp(ep: string): Promise<void> {
  if (cache.has(ep)) {
    epLocale.value = cache.get(ep);
    return;
  }
  try {
    const mod = await import(/* @vite-ignore */ `element-plus/es/locale/lang/${ep}.mjs`);
    cache.set(ep, mod.default);
    epLocale.value = mod.default;
  } catch {
    // 该语言 Element Plus 未提供，保持 null → EP 用默认（英文）
    epLocale.value = null;
  }
}

/** SupportedLocale tag → EP locale 文件名。 */
const EP_MAP: Record<SupportedLocale, string> = {
  "zh-CN": "zh-cn",
  "en-US": "en",
};

/** 监听 i18n 全局 locale 变化（轮询当前 tag）并加载对应 EP 包。 */
export function syncElementLocale(): void {
  watch(currentLocaleTag, (tag) => loadEp(EP_MAP[tag]), { immediate: true });
}

export { currentLocaleTag };
