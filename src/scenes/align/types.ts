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
  trackId?: number;
}

export interface Fmp4Result {
  videoTrackId?: number;
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
  sequence: number;
  discontinuity: number;
  gap: boolean;
  initUri: string | null;
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
  /** 近 1s 实时帧数（真实到达速率，与累计 frames 分开） */
  liveFps: number;
  hasContent: boolean;
  mode: "aligned" | "off";
  /** 最近到货 rt（µs） */
  frontRtUs: number | null;
  /** 最近 WebCodecs 解码错误（明文；无则 null） */
  decodeError: string | null;
  /** 可上屏队列中的已解帧数（0 = 无帧可放 → 画面卡住） */
  queueLen: number;
  /** 断流/解码重同步累计次数（上升 = 断流在反复 → 卡/跳元凶） */
  resyncs: number;
  /** 原始环内样本数（fmp4 SEI 样本） */
  rawLen: number;
  /** 解码游标已喂到的原始样本下标（== rawLen 且队列空 = 喂完但无可呈现帧） */
  decPos: number;
  /** 样本封装（avcc/annexb；空=解码从未启动） */
  enc: string;
  /** 解码器累计输出的帧数（0 = 解码从未产帧） */
  decOutput: number;
  /** 当前解码队列深度（≥12 恒满 = 解码器堵住不消化） */
  qc: number;
  /** 解码配置是否卡在等待（true 恒 = configure 没完成 → pump 一直 return 不分发） */
  pendCfg: boolean;
  /** 正在延迟重试的分片数（404 瞬时未补回） */
  segRetries: number;
  /** 重试 3 次仍失败、永久放弃的分片总数（原始环将缺这些段） */
  segGaveUp: number;
  /** 鉴权被拒（401/403）永久放弃的分片总数（secret 配错时非零） */
  segAuth: number;
  /** 因跳段（分片洞，>0.2s）触发 resync 的次数 */
  resyncGap: number;
  /** 因解码报错触发 resync 的次数（坏流/参数变化） */
  resyncErr: number;
  rawBytes: number;
  continuousFromUs: number | null;
  continuousToUs: number | null;
  decodedFromUs: number | null;
  decodedToUs: number | null;
  memoryBlocked: boolean;
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
    liveFps: 0,
    hasContent: false,
    mode: "off",
    frontRtUs: null,
    decodeError: null,
    queueLen: 0,
    resyncs: 0,
    rawLen: 0,
    decPos: 0,
    enc: "",
    decOutput: 0,
    qc: 0,
    pendCfg: false,
    segRetries: 0,
    segGaveUp: 0,
    segAuth: 0,
    resyncGap: 0,
    resyncErr: 0,
    rawBytes: 0,
    continuousFromUs: null,
    continuousToUs: null,
    decodedFromUs: null,
    decodedToUs: null,
    memoryBlocked: false,
  };
}

/** 取源层（harvester）健康计数——拼进指标行 */
export interface HarvesterStats {
  /** 正在延迟重试的分片数 */
  retries: number;
  /** 永久放弃的分片总数 */
  gaveUp: number;
  /** 鉴权拒绝放弃的分片总数 */
  authFail: number;
}

export function emptyHarvesterStats(): HarvesterStats {
  return { retries: 0, gaveUp: 0, authFail: 0 };
}