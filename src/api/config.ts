/**
 * 后端地址解析。
 *
 * - 开发期默认走 Vite 同源代理（/api → REST，/ws → WebSocket），无需后端配置 CORS。
 * - 若设置 VITE_BACKEND_URL（绝对地址），则浏览器直连；REST 需后端放行 CORS，
 *   WebSocket 不受 CORS 限制可直接连通。
 */

const BACKEND_URL = (import.meta.env.VITE_BACKEND_URL ?? "").trim();

/** REST 请求基址 */
export const restBase: string = BACKEND_URL ? BACKEND_URL.replace(/\/$/, "") : "/api";

/**
 * 根据 REST 基址推导 WebSocket 端点。
 * - seat：可选，多角色账号指定本连接身份；
 * - session：可选，裁判/导播多标签页选场（后端 WS 端点读 query 参数 ``match``）。
 */
export function wsUrl(token: string, seat?: string, session?: string): string {
  let base: string;
  if (BACKEND_URL) {
    const u = new URL(BACKEND_URL);
    const scheme = u.protocol === "https:" ? "wss" : "ws";
    base = `${scheme}://${u.host}/ws/${encodeURIComponent(token)}`;
  } else {
    const scheme = globalThis.location.protocol === "https:" ? "wss" : "ws";
    base = `${scheme}://${globalThis.location.host}/ws/${encodeURIComponent(token)}`;
  }
  const params = new URLSearchParams();
  if (seat) params.set("seat", seat);
  if (session) params.set("match", session);
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}
