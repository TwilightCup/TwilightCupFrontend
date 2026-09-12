/**
 * fMP4 最小解析：box 遍历 → stsd 取 codec → moof/traf/trun → mdat 样本。
 * 镜像冒烟工具 public/tools/hls-sei-smoke.html 的 extractFmp4Samples（MediaMTX
 * LL-HLS part / fMP4 segment 都是分片 mp4；样本 payload 是 AVCC 长度前缀）。
 */
import type { Codec, Fmp4Result, Fmp4Sample } from "./types";

export function u32be(b: Uint8Array, o: number): number {
  return ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
}
export function u64be(b: Uint8Array, o: number): number {
  const hi = b[o] * 2 ** 24 + b[o + 1] * 2 ** 16 + b[o + 2] * 2 ** 8 + b[o + 3];
  const lo = b[o + 4] * 2 ** 24 + b[o + 5] * 2 ** 16 + b[o + 6] * 2 ** 8 + b[o + 7];
  return hi * 2 ** 32 + lo;
}

interface Box { type: string; start: number; size: number; data: Uint8Array }
function parseBoxes(buf: Uint8Array, base = 0): Box[] {
  const boxes: Box[] = [];
  let p = 0;
  while (p + 8 <= buf.length) {
    const size = u32be(buf, p);
    const type = String.fromCharCode(buf[p + 4], buf[p + 5], buf[p + 6], buf[p + 7]);
    if (size < 8) break;
    boxes.push({ type, start: base + p, size, data: buf.subarray(p + 8, p + size) });
    p += size;
  }
  return boxes;
}
const findBox = (boxes: Box[], type: string) => boxes.find((b) => b.type === type);
const childBoxes = (box: Box): Box[] => parseBoxes(box.data, box.start + 8);

function parseStsdVideoEntry(stsd: Box): { codec: string; entryStart: number; entrySize: number } | null {
  const d = stsd.data;
  const cnt = u32be(d, 4);
  if (cnt < 1) return null;
  let p = 8;
  const size = u32be(d, p);
  const fourcc = String.fromCharCode(d[p + 4], d[p + 5], d[p + 6], d[p + 7]);
  return { codec: fourcc, entryStart: p, entrySize: size };
}

/** 在 sample entry 字节里定位 avcC/hvcC 配置盒：type 前 4 字节是盒子 size */
function locateConfigBox(data: Uint8Array, type: string): Uint8Array | null {
  const t = (type.charCodeAt(0) << 24) | (type.charCodeAt(1) << 16) | (type.charCodeAt(2) << 8) | type.charCodeAt(3);
  for (let i = 4; i + 4 <= data.length; i++) {
    if (u32be(data, i) === t) {
      const size = u32be(data, i - 4);
      if (size >= 8 && i - 4 + size <= data.length) return data.subarray(i + 4, i - 4 + size);
    }
  }
  return null;
}

/**
 * 从一段 fMP4（init 或含 moof+mdat 的 part/segment）解析 codec/description/样本。
 */
export function extractFmp4Samples(buf: Uint8Array): Fmp4Result {
  let codec: Codec | null = null;
  let avcC: Uint8Array | null = null;
  let hvcC: Uint8Array | null = null;
  const boxes = parseBoxes(buf);
  const moov = findBox(boxes, "moov");
  if (moov) {
    const traks = childBoxes(moov).filter((b) => b.type === "trak");
    for (const trak of traks) {
      const mdia = findBox(childBoxes(trak), "mdia");
      if (!mdia) continue;
      const minf = findBox(childBoxes(mdia), "minf");
      if (!minf) continue;
      const stbl = findBox(childBoxes(minf), "stbl");
      if (!stbl) continue;
      const stsd = findBox(childBoxes(stbl), "stsd");
      if (!stsd) continue;
      const e = parseStsdVideoEntry(stsd);
      if (!e) continue;
      if (["avc1", "avc3", "hvc1", "hev1"].includes(e.codec)) {
        codec = e.codec.startsWith("avc") ? "h264" : "hevc";
        const entry = buf.subarray(stsd.start + 8 + e.entryStart, stsd.start + 8 + e.entryStart + e.entrySize);
        const avcc = locateConfigBox(entry, "avcC");
        const hvcc = locateConfigBox(entry, "hvcC");
        if (avcc) avcC = new Uint8Array(avcc);
        if (hvcc) hvcC = new Uint8Array(hvcc);
        break;
      }
    }
  }

  const samples: Fmp4Sample[] = [];
  for (const moof of boxes.filter((b) => b.type === "moof")) {
    const moofStart = moof.start;
    const moofEnd = moof.start + moof.size;
    const trafs = childBoxes(moof).filter((b) => b.type === "traf");
    for (const traf of trafs) {
      const inner = childBoxes(traf);
      const tfhd = findBox(inner, "tfhd");
      const trun = findBox(inner, "trun");
      if (!tfhd || !trun) continue;
      const tf = tfhd.data;
      const tfFlags = u32be(tf, 0) & 0x00ffffff;
      let o = 8;
      let baseDataOffset = 0;
      let defSize = 0, defFlags = 0;
      if (tfFlags & 0x000001) { baseDataOffset = u64be(tf, o); o += 8; }
      if (tfFlags & 0x000002) o += 4; // sample-description-index
      if (tfFlags & 0x000008) o += 4; // default-sample-duration
      if (tfFlags & 0x000010) { defSize = u32be(tf, o); o += 4; }
      if (tfFlags & 0x000020) { defFlags = u32be(tf, o); o += 4; }
      const base = tfFlags & 0x000001 ? baseDataOffset : moofStart;
      const tr = trun.data;
      const sampleCount = u32be(tr, 4);
      const trFlags = u32be(tr, 0) & 0x00ffffff;
      let q = 8;
      let dataOff = 0;
      if (trFlags & 0x000001) { dataOff = (tr[q] << 24 | tr[q + 1] << 16 | tr[q + 2] << 8 | tr[q + 3]) | 0; q += 4; }
      let firstSampleFlags = 0;
      if (trFlags & 0x000004) { firstSampleFlags = u32be(tr, q); q += 4; }
      let samplePos = base + dataOff;
      void moofEnd;
      for (let s = 0; s < sampleCount; s++) {
        if (trFlags & 0x000100) q += 4;
        let sz = defSize;
        if (trFlags & 0x000200) { sz = u32be(tr, q); q += 4; }
        let fl = defFlags;
        if (trFlags & 0x000400) { fl = u32be(tr, q); q += 4; }
        if (trFlags & 0x000800) q += 4;
        const effFlags = s === 0 && (trFlags & 0x000004) ? firstSampleFlags : fl;
        const isKey = !(effFlags & 0x00010000); // bit16 = sample_is_non_sync_sample
        if (sz > 0 && samplePos + sz <= buf.length) {
          samples.push({ payload: new Uint8Array(buf.subarray(samplePos, samplePos + sz)), isKey });
        }
        samplePos += sz;
      }
    }
  }
  return { codec, samples, avcC, hvcC };
}