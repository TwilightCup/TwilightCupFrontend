/**
 * 直播画面双语标签。
 *
 * 导播场景（OBS 输出）面向中英双语观众，画面标签需同时展示中文与英文——
 * 与控制台 UI 的「按 locale 单语切换」不同，这里直接并排读两份语言表，
 * 不随当前 locale 变化。
 *
 * - `bi()`：单行「中文 · English」，两语言相同则只显示一份（如 PB）。
 * - `biPair()`：取 { zh, en } 一对，供大字上下两行堆叠展示。
 * 枚举标签（阶段/状态等）先经 format.ts 的 `*LabelKey` 取 i18n 键，再进这里。
 */
import zhCN from "@/locales/zh-CN";
import enUS from "@/locales/en-US";

const ZH = zhCN as unknown as Record<string, string>;
const EN = enUS as unknown as Record<string, string>;

/** {name} 命名插值（与 locale 文件约定一致，未知占位符原样保留）。 */
function interpolate(tpl: string, named?: Record<string, unknown>): string {
  if (!named) return tpl;
  return tpl.replace(/\{(\w+)\}/g, (raw, key: string) =>
    key in named ? String(named[key]) : raw,
  );
}

/** 取键的双语一对（缺键回退另一语言，再缺回退键名本身）。 */
export function biPair(
  key: string,
  named?: Record<string, unknown>,
): { zh: string; en: string } {
  const zh = ZH[key];
  const en = EN[key];
  return {
    zh: interpolate(zh ?? en ?? key, named),
    en: interpolate(en ?? zh ?? key, named),
  };
}

/** 单行双语标签：「中文 · English」（两语言同文只显示一份）。 */
export function bi(key: string, named?: Record<string, unknown>): string {
  const { zh, en } = biPair(key, named);
  return zh === en ? zh : `${zh} · ${en}`;
}
