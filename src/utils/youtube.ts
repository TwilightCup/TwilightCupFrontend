/**
 * YouTube 直播/视频链接解析与嵌入地址转换。
 *
 * 导播选手画面直接 iframe 完整 watch/live 页时，YouTube 页面内部的
 * Chromecast / 本地设备探测会被 Chrome Local Network Access 拦截，显示
 * “此连接已被阻止，因为它是公共页面发起的，旨在连接到您本地网络上的设备
 * 或服务器”。这里统一把常见的 YouTube 分享链接转换成官方 iframe 嵌入页
 * `youtube-nocookie.com/embed/{id}`，避免完整页面触发本地网络探测。
 */

const YOUTUBE_VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;
const YOUTUBE_CHANNEL_ID_RE = /^UC[A-Za-z0-9_-]{22}$/;

/** 从输入提取 YouTube 视频 / 直播 ID；不是可识别的 YouTube 链接返回 null。 */
export function parseYouTubeVideoId(input: string): string | null {
  const s = input.trim();
  if (!s) return null;

  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
  } catch {
    return null;
  }

  const host = url.hostname.toLowerCase().replace(/^www\./, "").replace(/^m\./, "");
  if (host !== "youtu.be" && host !== "youtube.com" && host !== "youtube-nocookie.com") {
    return null;
  }

  // youtu.be/ID
  if (host === "youtu.be") {
    const id = url.pathname.split("/").filter(Boolean)[0] ?? "";
    return YOUTUBE_VIDEO_ID_RE.test(id) ? id : null;
  }

  // youtube.com/watch?v=ID
  const v = url.searchParams.get("v");
  if (v && YOUTUBE_VIDEO_ID_RE.test(v)) return v;

  // youtube.com/{live|embed|shorts|v}/ID
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length >= 2 && ["live", "embed", "shorts", "v"].includes(parts[0])) {
    const id = parts[1];
    if (YOUTUBE_VIDEO_ID_RE.test(id)) return id;
  }

  return null;
}

/**
 * 频道实时直播页（/live_stream?channel=...）没有视频 ID，只能用
 * /embed/live_stream?channel=... 这种频道直播嵌入页。
 */
function parseYouTubeLiveStreamChannel(input: string): string | null {
  const s = input.trim();
  if (!s) return null;
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, "").replace(/^m\./, "");
  if (host !== "youtube.com" && host !== "youtube-nocookie.com") return null;
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length === 1 && parts[0] === "live_stream") {
    const channel = url.searchParams.get("channel") ?? "";
    return YOUTUBE_CHANNEL_ID_RE.test(channel) ? channel : null;
  }
  return null;
}

/** 将 YouTube 分享链接统一转换为可 iframe 的官方嵌入页；非 YouTube 输入原样返回。 */
export function toYouTubeEmbedUrl(input: string): string {
  // 频道直播页：/live_stream?channel=... → /embed/live_stream?channel=...
  const channel = parseYouTubeLiveStreamChannel(input);
  if (channel) {
    const suffix = input.trim().includes("?")
      ? input.trim().slice(input.trim().indexOf("?"))
      : "";
    if (/\/embed\/live_stream\?/i.test(input.trim())) {
      // 已嵌入页也统一换到 nocookie 域，尽量避开完整播放器的本地设备探测
      return `https://www.youtube-nocookie.com/embed/live_stream${suffix}`;
    }
    return `https://www.youtube-nocookie.com/embed/live_stream?channel=${encodeURIComponent(channel)}`;
  }

  const id = parseYouTubeVideoId(input);
  if (!id) return input;

  // 已是 /embed/ 页时保留用户自带参数，只把域统一换成 privacy-enhanced 域
  if (/^(?:https?:\/\/)?(?:www\.|m\.)?(?:youtube\.com|youtube-nocookie\.com)\/embed\//i.test(
    input.trim(),
  )) {
    const q = input.trim().includes("?") ? input.trim().slice(input.trim().indexOf("?")) : "";
    return `https://www.youtube-nocookie.com/embed/${id}${q}`;
  }

  return `https://www.youtube-nocookie.com/embed/${id}`;
}
