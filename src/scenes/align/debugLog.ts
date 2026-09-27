/**
 * 对齐管线 debug 日志——功能联调期定位"喂了但没画面"类问题。
 *
 * 开关（任一命中即开）：
 *   - URL 参数 ?debug=align（含逗号列表）
 *   - localStorage["debug:align"] = "1"
 *
 * 未开启时所有 log* 为零开销空函数（生产不刷屏）。开启后带 [align] 前缀、
 * 限频（同 key 1s 内不重复刷）输出到 console.debug——浏览器开 Verbose 才可见，
 * 平时不干扰普通 console。
 */

const enabled =
  (typeof location !== "undefined" && /[?&]debug=([^&#]*)/.exec(location.search)?.[1]?.split(",").includes("align")) ||
  (typeof localStorage !== "undefined" && localStorage.getItem("debug:align") === "1");

/** 同 key 限频记录：key → 上次输出时刻（ms） */
const lastAt = new Map<string, number>();
/** 同 key 计数：限频窗口内被抑制的次数（下一条带出"×N"） */
const suppressed = new Map<string, number>();

function emit(key: string, ...parts: unknown[]): void {
  const now = Date.now();
  const last = lastAt.get(key) ?? 0;
  if (now - last < 1000) {
    suppressed.set(key, (suppressed.get(key) ?? 0) + 1);
    return;
  }
  const n = suppressed.get(key) ?? 0;
  if (n > 0) parts.push(`(×${n} 同况)`);
  suppressed.delete(key);
  lastAt.set(key, now);
  console.debug("[align]", ...parts);
}

function mk(): (key: string, ...parts: unknown[]) => void {
  return enabled ? emit : () => undefined;
}

/** 段到达/解析（hlsPoller→frameLock 边界）：段数、样本数、SEI 命中数 */
export const logSeg: (key: string, ...parts: unknown[]) => void = mk();
/** 解码喂入/产出/背压（frameLock pump） */
export const logDec: (key: string, ...parts: unknown[]) => void = mk();
/** 解码错误 / 重同步事件 */
export const logResync: (key: string, ...parts: unknown[]) => void = mk();
/** T 速率控制决策（追回触发/完成/重锚/冻结回退） */
export const logT: (key: string, ...parts: unknown[]) => void = mk();
/** 外部权威 T / 超时回退（useFrameAlign） */
export const logAuth: (key: string, ...parts: unknown[]) => void = mk();

/** 是否开启（诊断提示用） */
export const alignDebugEnabled = enabled;