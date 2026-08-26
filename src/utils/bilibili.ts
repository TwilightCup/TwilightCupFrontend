/**
 * B站直播间链接解析与 OBS 可嵌入地址转换。
 *
 * 主站直播间（live.bilibili.com/{roomId}）带 `X-Frame-Options: SAMEORIGIN`，
 * 不能被 OBS 浏览器源/第三方页面 iframe 嵌入；B站为移动/空白播放页保留的
 * `blanc` 路径（同样兼容 `h5`，见 BililiveRecorder RoomIdFromUrl）不带该限制，
 * 可用于导播端嵌入直播画面。
 */

/** 匹配 B站直播链接（纯房间号也接受），参考录播姬 RoomIdFromUrl 的表达式。 */
const BILI_LIVE_RE =
  /^(?:https?:\/\/)?live\.bilibili\.com\/(?:blanc\/|h5\/)?(\d+)\/?(?:[#?].*)?$/i;
const BILI_PURE_RE = /^(\d{1,10})(?:[\/?#].*)?$/;

/** 从输入提取 B站直播间号；不是 B站直播返回 null。 */
export function parseBilibiliLiveRoomId(input: string): string | null {
  const s = input.trim();
  if (!s) return null;
  const pure = BILI_PURE_RE.exec(s);
  if (pure) return pure[1];
  const m = BILI_LIVE_RE.exec(s);
  return m ? m[1]! : null;
}

/** 判断是否为 B站直播间链接 / 房间号。 */
export function isBilibiliLiveInput(input: string): boolean {
  return parseBilibiliLiveRoomId(input) !== null;
}

/**
 * 将 B站直播间地址统一转换为 OBS 可嵌入的 blanc 轻量播放页。
 * 非 B站输入原样返回（保持 YouTube embed 等既有 iframe 行为）。
 *
 * `liteVersion=true` 是 B站 blanc 页为 iframe 场景准备的轻量模式，会关闭
 * 完整房间页中的本地网络/客户端探测等逻辑，避免 OBS CEF 触发“公共页面连接
 * 本地网络被阻止”的拦截；同时隐藏页头与右侧排行榜，保证画面干净。
 */
export function toBilibiliLiveEmbedUrl(input: string): string {
  const roomId = parseBilibiliLiveRoomId(input);
  if (!roomId) return input;
  return `https://live.bilibili.com/blanc/${roomId}?liteVersion=true&hideHeadInfo=true&hideRankList=true`;
}
