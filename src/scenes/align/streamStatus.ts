/** Waiting is not evidence that the browser rejected a codec. Only the actual
 * VideoDecoder probe/error callback may make that diagnosis. */
export function streamWaitingText(s: {
  frames: number;
  authorityUs: number | null;
  state: "waiting" | "playing" | "frozen" | "stale";
  aligned: boolean;
}): string {
  if (s.state === "stale") return "权威时间已失联，等待有效锚点";
  if (s.authorityUs == null) return `已解析 ${s.frames} 帧，等待后端权威时间；尚未启动解码`;
  if (!s.aligned) return `已解析 ${s.frames} 帧，等待共同安全时间与解码就绪`;
  return "等待双方共同帧";
}
