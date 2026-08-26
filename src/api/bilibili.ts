/**
 * B站直播同源代理客户端。
 *
 * 导播选手画面不再 iframe 嵌入 B站（blanc 页面会被 Chrome Local Network
 * Access 拦截），改由后端代理拉取 HTTP-FLV 流（见后端
 * rest/bilibili_proxy.py），前端通过 mpegts.js 播放同源流。
 *
 * mpegts.js 发起的是普通 GET，无法附带 Authorization 头，因此代理流的
 * JWT 通过 URL query 传递。
 */
import { restBase } from "@/api/config";

/** 构造 B站直播 FLV 代理流地址（同源 `/api/bilibili/live/stream`）。 */
export function bilibiliStreamUrl(roomId: string, token?: string): string {
  const q = new URLSearchParams({ room_id: roomId });
  if (token) q.set("token", token);
  return `${restBase}/bilibili/live/stream?${q.toString()}`;
}
