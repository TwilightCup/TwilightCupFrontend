/**
 * JWT 客户端只读解析（不验签；仅用于本地判断令牌是否已过期，
 * 区分「令牌过期」与「未被指派 / 座位冲突」等业务性鉴权失败）。
 */
const SKEW_MS = 30_000;

export function isTokenExpired(token: string, now = Date.now()): boolean {
  const part = token.split(".")[1];
  if (!part) return false;
  try {
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
    const json = JSON.parse(
      new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))),
    ) as { exp?: unknown };
    // 客户端时钟略快于服务器时不提前判死，留 30s 偏差容差
    return typeof json.exp === "number" && json.exp * 1000 <= now + SKEW_MS;
  } catch {
    // 无法解析的令牌不武断判过期，交由服务端 401 / auth_error 兜底
    return false;
  }
}
