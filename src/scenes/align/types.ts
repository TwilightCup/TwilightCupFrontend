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
  /** master 播放列表选出的最优变体 media 播放列表 URI（若本条是 media 列表则为 null） */
  variantUri?: string | null;
}

/** 一条已解码、按 realtime_us 升序待排程的帧 */
export interface AlignedFrame {
  rtUs: number; // signed 秒内绝对（epoch 微秒，Number 可表 <2^53）
  isKey: boolean;
}

/** 单路连通性/健康指标（导播控制台观察连接问题用，维度对齐 SEIInjector 冒烟工具） */
export interface StreamHealth {
  codec: Codec;
  /** 含 SEI 的样本数（已解析帧） */
  frames: number;
  /** 已成功取到的 HLS 段数（无论是否含 SEI——用于区分"拿到段但无 SEI"与"没拿到段"） */
  segs: number;
  /** 无 SEI 的样本数 */
  missing: number;
  /** NTP 校准帧数 */
  ntp: number;
  /** 关键帧数 */
  key: number;
  /** seq 跳变次数（>1 即丢帧） */
  droppedSeq: number;
  /** 近端帧率（fps），无足够样本 null */
  fps: number | null;
  hasContent: boolean;
  mode: "aligned" | "off";
  /** 最近到货 rt（µs） */
  frontRtUs: number | null;
  /** 最近 WebCodecs 解码错误（明文；无则 null） */
  decodeError: string | null;
}

export function emptyHealth(): StreamHealth {
  return {
    codec: "h264",
    frames: 0,
    segs: 0,
    missing: 0,
    ntp: 0,
    key: 0,
    droppedSeq: 0,
    fps: null,
    hasContent: false,
    mode: "off",
    frontRtUs: null,
    decodeError: null,
  };
}