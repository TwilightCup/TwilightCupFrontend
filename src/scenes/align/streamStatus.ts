/** Waiting is not evidence that the browser rejected a codec. Only the actual
 * VideoDecoder probe/error callback may make that diagnosis. */
export function streamWaitingText(s: {
  frames: number;
  authorityUs: number | null;
  state: "waiting" | "playing" | "frozen" | "stale";
  aligned: boolean;
  publisher?: boolean;
  candidate?: "off" | "warming" | "ready";
}): string {
  if (s.state === "stale") return "权威时间已失联，等待有效锚点";
  if (s.authorityUs == null && s.candidate === "ready") return `已解析 ${s.frames} 帧，候选解码已就绪，等待后端选主`;
  if (s.authorityUs == null && s.candidate === "warming") return `已解析 ${s.frames} 帧，候选预解码中，等待后端选主`;
  if (s.publisher && s.authorityUs == null) return `已解析 ${s.frames} 帧，主时钟等待双路公共安全缓冲`;
  if (s.authorityUs == null) return `已解析 ${s.frames} 帧，等待后端权威时间；尚未启动解码`;
  if (!s.aligned) return `已解析 ${s.frames} 帧，等待共同安全时间与解码就绪`;
  return "等待双方共同帧";
}
