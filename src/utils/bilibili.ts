/**
 * B站直播间链接解析。
 *
 * 导播选手画面不再 iframe 嵌入 B站直播（主站房间页禁止 iframe，blanc 嵌入页
 * 会被 Chrome Local Network Access 拦截），改为通过后端同源代理拉取
 * HTTP-FLV，前端用 mpegts.js 播放。此模块只负责从配置输入中识别房间号。
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
