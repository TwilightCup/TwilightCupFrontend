/**
 * SEI 逐帧解析——镜像 SEIInjector/src/sei-payload.c 与 tools/verify_sei.py、
 * 及冒烟工具 public/tools/hls-sei-smoke.html（字段布局/0xFF 变长/RBSP 反转义完全一致）。
 *
 * 载荷布局（UUID 16B 之后，全大端，共 22B）：
 *   version(1)=1 | flags(1) | seq(4) | media_pts(8) | realtime_us(8)
 * flags bit0=关键帧、bit1=NTP 校准。UUID 无 0x00 字节可直接在段字节里搜；
 * 字段区可能含 0x00 被插入 0x03(EPB)，读字段必须先反转义。
 */
export { UUID, UUID_HEX, FIELD_SIZE, FLAG_KEYFRAME, FLAG_CLOCK_NTP };

const UUID_HEX = "7e57c2ee0dd24b539b3593edf97a12c1";
const UUID = new Uint8Array(16);
{
  const h = UUID_HEX.match(/../g)!;
  for (let i = 0; i < 16; i++) UUID[i] = parseInt(h[i]!, 16);
}
const FIELD_SIZE = 22; // version(1)+flags(1)+seq(4)+pts(8)+realtime(8)
const FLAG_KEYFRAME = 0x01;
const FLAG_CLOCK_NTP = 0x02;
const SEI_PAYLOAD_TYPE = 5; // user_data_unregistered
const NAL_SEI_H264 = 6; // sei_rbsp
const NAL_SEI_H265 = [39, 40]; // PREFIX/SUFFIX_SEI_NUT

import type { Codec, SeiFrameInfo } from "./types";
import { u64be } from "./fmp4";

function u32be(b: Uint8Array, o: number): number {
  return ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
}
function toBigInt64(b: Uint8Array, o: number): bigint {
  return BigInt.asIntN(64, BigInt(u64be(b, o)));
}

/** 移除 RBSP 反转义字节（EPB 0x03），产出 want 个未转义字节 */
function unescapeEpb(src: Uint8Array, start: number, want: number): number[] {
  const out: number[] = [];
  let zeros = 0;
  for (let i = start; i < src.length && out.length < want; i++) {
    const b = src[i];
    if (zeros >= 2 && b === 0x03) { zeros = 0; continue; }
    out.push(b);
    zeros = b === 0 ? zeros + 1 : 0;
  }
  return out;
}

/** 读取 SEI 的 0xFF 链式变长整数；返回 [value|null, nextPos] */
function readSeiVar(b: Uint8Array, pos: number, end: number): [number | null, number] {
  let v = 0;
  while (pos < end && b[pos] === 0xff) {
    v += 0xff;
    pos++;
    if (v > 0x1000000) return [null, pos];
  }
  if (pos >= end) return [null, pos];
  v += b[pos];
  return [v, pos + 1];
}

/** 解析「一个 SEI NAL 的 payload」：以 UUID 开头、version=1，读字段 */
function parseRawPayload(p: number[]): SeiFrameInfo | null {
  if (p.length < 16 + FIELD_SIZE) return null;
  for (let i = 0; i < 16; i++) if (p[i] !== UUID[i]) return null;
  if (p[16] !== 1) return null; // version
  const flags = p[17];
  return {
    keyframe: !!(flags & FLAG_KEYFRAME),
    clock_ntp: !!(flags & FLAG_CLOCK_NTP),
    seq: u32be(new Uint8Array(p), 18),
    media_pts: toBigInt64(new Uint8Array(p), 22),
    realtime_us: toBigInt64(new Uint8Array(p), 30),
  };
}

/** 解析一个 SEI NAL（从 NAL header 之后开始），返回 frameInfo | null */
export function parseSeiNal(nal: Uint8Array, codec: Codec): SeiFrameInfo | null {
  const hdr = codec === "h264" ? 1 : 2;
  if (nal.length <= hdr) return null;
  const ntype = codec === "h264" ? nal[0] & 0x1f : (nal[0] >> 1) & 0x3f;
  if (codec === "h264" ? ntype !== NAL_SEI_H264 : !NAL_SEI_H265.includes(ntype)) return null;
  let p = hdr;
  const [type, q] = readSeiVar(nal, p, nal.length);
  if (type === null) return null;
  p = q;
  const [msize, q2] = readSeiVar(nal, p, nal.length);
  if (msize === null) return null;
  p = q2;
  if (type !== SEI_PAYLOAD_TYPE || msize < 16 + FIELD_SIZE) return null;
  const unesc = unescapeEpb(nal, p, msize!);
  if (unesc.length < 16 + FIELD_SIZE) return null;
  return parseRawPayload(unesc);
}

/** 在 Annex-B 字节流里扫描全部起始码，切出 NAL，逐个查 SEI */
export function parseAnnexbFrames(data: Uint8Array, codec: Codec): SeiFrameInfo[] {
  const frames: SeiFrameInfo[] = [];
  const starts: [number, number][] = [];
  let i = 0;
  const n = data.length;
  while (i + 3 <= n) {
    if (data[i] === 0 && data[i + 1] === 0) {
      if (data[i + 2] === 1) { starts.push([i, 3]); i += 3; continue; }
      if (i + 4 <= n && data[i + 2] === 0 && data[i + 3] === 1) { starts.push([i, 4]); i += 4; continue; }
    }
    i++;
  }
  for (let k = 0; k < starts.length; k++) {
    const nal = data.subarray(starts[k][0] + starts[k][1], k + 1 < starts.length ? starts[k + 1][0] : data.length);
    const info = parseSeiNal(nal, codec);
    if (info) frames.push({ ...info });
  }
  return frames;
}

/** AVCC（长度前缀）切 NAL */
export function splitAvcc(payload: Uint8Array): Uint8Array[] {
  const nals: Uint8Array[] = [];
  let p = 0;
  while (p + 4 <= payload.length) {
    const len = u32be(payload, p);
    p += 4;
    if (len === 0 || p + len > payload.length) break;
    nals.push(payload.subarray(p, p + len));
    p += len;
  }
  return nals;
}

/** Annex-B 字节流切 NAL */
export function splitAnnexb(data: Uint8Array): Uint8Array[] {
  const nals: Uint8Array[] = [];
  const starts: number[] = [];
  let i = 0;
  const n = data.length;
  while (i + 3 <= n) {
    if (data[i] === 0 && data[i + 1] === 0) {
      if (data[i + 2] === 1) { starts.push(i + 3); i += 3; continue; }
      if (i + 4 <= n && data[i + 2] === 0 && data[i + 3] === 1) { starts.push(i + 4); i += 4; continue; }
    }
    i++;
  }
  for (let k = 0; k < starts.length; k++) {
    nals.push(data.subarray(starts[k]!, k + 1 < starts.length ? starts[k + 1]! : data.length));
  }
  return nals;
}

/** 单样本 → 找 SEI；先按 AVCC，若失败再按 Annex-B 扫 */
export function parseSampleSei(payload: Uint8Array, codec: Codec): SeiFrameInfo | null {
  let nals = splitAvcc(payload);
  if (nals.length === 0) nals = splitAnnexb(payload);
  for (const nal of nals) {
    const info = parseSeiNal(nal, codec);
    if (info) return info;
  }
  return null;
}

/**
 * 造 SEI NAL（自检用）——镜像 sei_ts_build_nal 的转义/编码算法，与 C/Python 同。
 */
export function buildSeiNal(codec: Codec, info: {
  keyframe: boolean;
  clock_ntp: boolean;
  seq: number;
  media_pts: bigint;
  realtime_us: bigint;
}): Uint8Array {
  const payload = new Uint8Array(16 + FIELD_SIZE);
  payload.set(UUID, 0);
  payload[16] = 1;
  payload[17] =
    (info.keyframe ? FLAG_KEYFRAME : 0) | (info.clock_ntp ? FLAG_CLOCK_NTP : 0);
  payload[18] = (info.seq >> 24) & 0xff;
  payload[19] = (info.seq >> 16) & 0xff;
  payload[20] = (info.seq >> 8) & 0xff;
  payload[21] = info.seq & 0xff;
  let v = BigInt.asUintN(64, BigInt(info.media_pts));
  for (let k = 7; k >= 0; k--) payload[22 + (7 - k)] = Number((v >> BigInt(k * 8)) & 0xffn);
  v = BigInt.asUintN(64, BigInt(info.realtime_us));
  for (let k = 7; k >= 0; k--) payload[30 + (7 - k)] = Number((v >> BigInt(k * 8)) & 0xffn);

  const varUint = (x: number): number[] => {
    const a: number[] = [];
    while (x >= 0xff) { a.push(0xff); x -= 0xff; }
    a.push(x);
    return a;
  };
  const typeB = varUint(SEI_PAYLOAD_TYPE);
  const sizeB = varUint(payload.length);

  const head = codec === "h264" ? [0x06] : [NAL_SEI_H265[0] << 1, 0x01];
  const buf: number[] = [0, 0, 0, 1, ...head, ...typeB, ...sizeB];
  let zeros = 0;
  for (const b of buf) zeros = b === 0 ? zeros + 1 : 0; // 跨 NAL 前缀统计零游程
  for (let i = 0; i < payload.length; i++) {
    const b = payload[i];
    if (zeros >= 2 && b <= 0x03) { buf.push(0x03); zeros = 0; }
    buf.push(b);
    zeros = b === 0 ? zeros + 1 : 0;
  }
  buf.push(0x80); // rbsp_stop_one_bit
  return new Uint8Array(buf);
}

/** 造帧↔解析对拍自检。buildSeiNal 产出含起始码的完整 NAL，真实解析路径
 *  （splitAvcc / splitAnnexb）剥起始码后喂 parseSeiNal——自检同样剥掉前 4 字节。 */
export function seiSelfTest(): string[] {
  const infos: {
    codec: Codec;
    info: { keyframe: boolean; clock_ntp: boolean; seq: number; media_pts: bigint; realtime_us: bigint };
  }[] = [
    { codec: "h264", info: { keyframe: true, clock_ntp: true, seq: 42, media_pts: 8400000000n, realtime_us: 1767153600123456n } },
    { codec: "hevc", info: { keyframe: false, clock_ntp: false, seq: 7, media_pts: 1400000000n, realtime_us: 1767153600222222n } },
  ];
  const lines: string[] = [];
  for (const { codec, info } of infos) {
    const nal = buildSeiNal(codec, info);
    const got = parseSeiNal(nal.subarray(4), codec); // 剥起始码
    const pass =
      !!got && got.seq === info.seq && got.keyframe === info.keyframe &&
      got.clock_ntp === info.clock_ntp && got.media_pts === info.media_pts &&
      got.realtime_us === info.realtime_us;
    lines.push(
      `[${codec.toUpperCase()}] 造帧 ${nal.length}B → 解析 ${pass ? "OK" : "FAIL"} seq=${got?.seq} key=${got?.keyframe} ntp=${got?.clock_ntp} rt=${got?.realtime_us}`,
    );
  }
  const nal = buildSeiNal("h264", infos[0]!.info);
  // UUID 无 0x00（≤0x03 才被 EPB 转义），在原始字节里应整段连续可搜到（字节级，非字符串比 HEX 字形）
  let hit = -1;
  outer: for (let i = 0; i + 16 <= nal.length; i++) {
    for (let j = 0; j < 16; j++) if (nal[i + j] !== UUID[j]) continue outer;
    hit = i; break;
  }
  lines.push(`[H264] 原始 NAL 内 UUID（16B 字节序列）${hit >= 0 ? `命中 @${hit}` : "未命中"}`);
  return lines;
}