/**
 * i18n 入口：注册 vue-i18n 实例、导出工具与类型。
 *
 * locale 文件格式见 ./README.md。新增语言：复制一个现有 locale 文件，
 * 翻译后在下方 `messages` 与 `LOCALES` 注册即可（缺失键自动 fallback 到 zh-CN）。
 *
 * - 默认 locale / fallback：zh-CN（仓库源语言）。
 * - 当前 locale 持久化在 localStorage `twc_locale`；index.html 的早设脚本会在
 *   首屏前据此设 <html lang>，避免语言闪屏。
 * - `t()` 是命令式便捷封装（供 Pinia store、format.ts 等非组件上下文调用）；
 *   组件内请用 `useI18n()` 拿到的 `t` / 模板里的 `$t`。
 */
import { createI18n } from "vue-i18n";
import zhCN, { type MessageSchema } from "./zh-CN";
import enUS from "./en-US";

export const SUPPORTED_LOCALES = ["zh-CN", "en-US"] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

export interface LocaleMeta {
  tag: SupportedLocale;
  /** Element Plus locale 文件名（element-plus/es/locale/lang/<x>） */
  ep: string;
  /** 下拉展示名 */
  label: string;
}

/** 注册的可选语言（含 Element Plus locale 映射 + 展示名）。 */
export const LOCALES: LocaleMeta[] = [
  { tag: "zh-CN", ep: "zh-cn", label: "简体中文" },
  { tag: "en-US", ep: "en", label: "English" },
];

export const DEFAULT_LOCALE: SupportedLocale = "zh-CN";
export const LOCALE_STORAGE_KEY = "twc_locale";

/** 从 localStorage 读取并校验为受支持的 locale，非法时回退默认。 */
export function getStoredLocale(): SupportedLocale {
  try {
    const v = localStorage.getItem(LOCALE_STORAGE_KEY);
    if (v && (SUPPORTED_LOCALES as readonly string[]).includes(v)) {
      return v as SupportedLocale;
    }
  } catch {
    // localStorage 不可用 / 损坏，忽略
  }
  return DEFAULT_LOCALE;
}

export const i18n = createI18n({
  legacy: false,
  locale: getStoredLocale(),
  fallbackLocale: DEFAULT_LOCALE,
  messages: {
    "zh-CN": zhCN,
    "en-US": enUS as unknown as typeof zhCN,
  },
  missingWarn: import.meta.env.DEV,
  fallbackWarn: import.meta.env.DEV,
});

/** BCP47 tag，供 toLocaleTimeString/DateString 等原生 API 使用。 */
export function currentLocaleTag(): SupportedLocale {
  const loc = i18n.global.locale;
  const tag = typeof loc === "string" ? loc : loc.value;
  return ((SUPPORTED_LOCALES as readonly string[]).includes(tag)
    ? tag
    : DEFAULT_LOCALE) as SupportedLocale;
}

/** 命令式翻译（非组件上下文，如 store / format.ts）。 */
export function t(key: string, named?: Record<string, unknown>): string {
  return named ? i18n.global.t(key, named) : i18n.global.t(key);
}

/** 切换 locale：更新 i18n、持久化、同步 <html lang>。Element Plus 由调用方监听 locale 变化自行更新。 */
export function setLocale(tag: SupportedLocale): void {
  const loc = i18n.global.locale;
  if (typeof loc === "string") {
    (i18n.global as unknown as { locale: string }).locale = tag;
  } else {
    loc.value = tag;
  }
  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, tag);
  } catch {
    // 忽略写入失败
  }
  document.documentElement.lang = tag;
}

// 启动即同步一次 <html lang>，避免与 index.html 早设脚本不一致
document.documentElement.lang = currentLocaleTag();

export type { MessageSchema };
