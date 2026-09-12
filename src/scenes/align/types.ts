/**
 * 帧级对齐共享类型（src/scenes/align/）——与 SEIInjector（UUID 7e57c2ee-… 注入的
 * 每帧 NTP 校准 `realtime_us`）及冒烟工具 public/tools/hls-sei-smoke.html 同源。
 */

export type Codec = "h264" | "hevc";

/** 一个已解析的插件 SEI 帧（字段布局见 sei.ts；realtime_us 为 epoch 微秒） */
export interface SeiFrameInfo {
  keyframe: boolean;
  clock_ntp: boolean;
  /** u32，编码器重启归零 → 丢帧/重连检测 */
  seq: number;
  media_pts: bigint;
  /** 共享 NTP 时钟的 epoch 微秒（对齐唯一依据） */
  realtime_us: bigint;
}

/** fMP4 单个视频样本（AVCC 长度前缀 NAL 序列） */
export interface Fmp4Sample {
  payload: Uint8Array;
  isKey: boolean;
}

export interface Fmp4Result {
  codec: Codec | null;
  samples: Fmp4Sample[];
  /** description 来源（WebCodecs 需要）；缺则依赖带内参数集 */
  avcC: Uint8Array | null;
  hvcC: Uint8Array | null;
}

export type HlsItemKind = "part" | "segment";

export interface HlsSegmentItem {
  uri: string;
  kind: HlsItemKind;
  duration: number;
}

export interface HlsPlaylist {
  /** EXT-X-MAP init 段（fMP4 codec/description 来源） */
  init: { uri: string | null };
  items: HlsSegmentItem[];
}

/** 一条已解码、按 realtime_us 升序待排程的帧 */
export interface AlignedFrame {
  rtUs: number; // signed 秒内绝对（epoch 微秒，Number 可表 <2^53）
  isKey: boolean;
}