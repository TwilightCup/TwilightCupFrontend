/**
 * MPEG-TS 最小解析：找视频 PES，拼出 Annex-B 字节流。
 * 镜像冒烟工具 public/tools/hls-sei-smoke.html 的 extractTsVideo——通用 HLS（非 LL-HLS
 * fMP4）大多用 MPEG-TS 分片，前端必须先重装 PES 才能拿到 Annex-B 去逐帧扫 SEI。
 */
export function extractTsVideo(buf: Uint8Array): Uint8Array | null {
  // 找 188 字节对齐的 0x47 同步（连验 3 个包）
  let sync = -1;
  for (let p = 0; p + 188 * 3 <= buf.length; p++) {
    if (buf[p] === 0x47 && buf[p + 188] === 0x47 && buf[p + 376] === 0x47) { sync = p; break; }
  }
  if (sync < 0) return null;
  const out: number[] = [];
  let curPid = -1;
  let inPes = false;
  let pesRemain = -1;
  const pushPes = (): void => { inPes = false; curPid = -1; pesRemain = -1; };
  for (let i = sync; i + 188 <= buf.length; i += 188) {
    const pid = ((buf[i + 1] & 0x1f) << 8) | buf[i + 2];
    const pusi = (buf[i + 1] & 0x40) !== 0;
    const afc = (buf[i + 3] >> 4) & 0x3;
    let q = i + 4;
    if (afc & 0x2) q += 1 + buf[q]!; // adaptation field
    if (!(afc & 0x1)) continue; // 无 payload
    if (pusi) {
      if (inPes && pid !== curPid) pushPes();
      if (q + 6 <= i + 188) {
        const sc = (buf[q]! << 16) | (buf[q + 1]! << 8) | buf[q + 2]!;
        if (sc === 0x000001) {
          const sid = buf[q + 3]!;
          if ((sid & 0xf0) === 0xe0) { // video stream_id
            if (inPes && pid === curPid) pushPes();
            const pesLen = (buf[q + 4]! << 8) | buf[q + 5]!;
            const hdrLen = buf[q + 8]!;
            curPid = pid;
            inPes = true;
            const bodyStart = q + 9 + hdrLen;
            const avail = i + 188 - bodyStart;
            let take = avail;
            if (pesLen > 0) take = Math.min(pesLen - 3 - hdrLen, avail);
            for (let k = 0; k < take; k++) out.push(buf[bodyStart + k]!);
            pesRemain = pesLen > 0 ? pesLen - 3 - hdrLen - take : -1;
            continue;
          }
        }
      }
    }
    if (inPes && pid === curPid) {
      const avail = i + 188 - q;
      let take = avail;
      if (pesRemain >= 0) { take = Math.min(pesRemain, avail); pesRemain -= take; }
      for (let k = 0; k < take; k++) out.push(buf[q + k]!);
    }
  }
  return out.length ? new Uint8Array(out) : null;
}