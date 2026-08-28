/**
 * YouTube 直播同源 HLS 代理客户端。
 *
 * 导播选手画面不再 iframe 嵌入 YouTube（embed 页仍会被 Chrome Local Network
 * Access 拦截），改由后端代理拉取 HLS 播放列表与分片（见后端
 * rest/youtube_proxy.py），前端通过 hls.js 播放同源流。
 *
 * hls.js 发起的是普通 GET，无法附带 Authorization 头，因此代理流的
 * JWT 通过 URL query 传递。
 */
import { restBase } from "@/api/config";

/** 构造 YouTube 直播 HLS 代理流地址（同源 `/api/youtube/live/stream`）。 */
export function youtubeStreamUrl(videoId: string, token?: string): string {
  const q = new URLSearchParams({ video_id: videoId });
  if (token) q.set("token", token);
  return `${restBase}/youtube/live/stream?${q.toString()}`;
}
