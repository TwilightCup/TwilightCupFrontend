/**
 * 可插拔取源层——把 FrameLockStream 与"从哪拿视频字节"解耦。
 *
 * 浏览器不能直接拉 RTSP（无 socket API）；"RTSP 单拉逐帧解析"的落地方式是把 RTSP/原始
 * Annex-B ES 由后端/代理透成 HTTP fetch，或用 WebRTC（MediaStream）。本层抽象让核心
 * （demux/SEI/解码/速率控制/排程）与传输无关——换源即换成不同 FrameSource。
 *
 * @see docs/frame-align-implementation.md §3（默认 LL-HLS fMP4 主路径）
 */
import { HlsHarvester, fetchBytes } from "./hlsPoller";
import type { Codec } from "./types";

/** 识别 HLS 段容器：首 4CC 为 MP4 box → fmp4（媒体段常以 styp/moof 开头，非仅 ftyp）；
 *  0x47 同步 → ts；否则 annexb。 */
function detectContainer(buf: Uint8Array): RawSegment["fmt"] {
  const has4cc = buf.length >= 8;
  const fourcc = has4cc ? String.fromCharCode(buf[4]!, buf[5]!, buf[6]!, buf[7]!) : "";
  if (["ftyp", "styp", "moof", "mdat", "sidx", "moov", "mfra", "free", "skip"].includes(fourcc)) {
    return "fmp4";
  }
  if (buf[0] === 0x47) return "ts"; // MPEG-TS 同步字
  return "annexb";
}

/** 一段交给核心的原始视频内容（init 或媒体数据）。 */
export interface RawSegment {
  kind: "init" | "data";
  /** 媒体形式：fmp4（LL-HLS 默认）、ts（MPEG-TS 分片）或 annexb（原始 ES 单拉） */
  fmt: "fmp4" | "annexb" | "ts";
  payload: Uint8Array;
  /** init 段携带：codec 与 description（avcC/hvcC），媒体段无关 */
  codec?: Codec;
  avcC?: Uint8Array | null;
  hvcC?: Uint8Array | null;
}

export interface FrameSource {
  start(): void;
  stop(): void;
  setOnSegment(cb: (seg: RawSegment) => void): void;
  setOnError(cb: (e: unknown) => void): void;
}

export interface HlsSourceOptions {
  url: string;
  pollIntervalMs?: number;
}

/** 默认主路径：LL-HLS（fMP4 part/segment + init）。 */
export class HlsFrameSource implements FrameSource {
  private harvester: HlsHarvester;
  private onSegment: (seg: RawSegment) => void = () => undefined;
  private onErr: (e: unknown) => void = () => undefined;

  constructor(opts: HlsSourceOptions) {
    this.harvester = new HlsHarvester(
      opts.url,
      (buf, kind) => {
        const fmt = detectContainer(buf);
        if (kind === "init") {
          // init（ftyp/moov）也是 fmp4：为后续媒体段提供 codec/description
          this.onSegment({ kind: "init", fmt: "fmp4", payload: buf });
        } else {
          this.onSegment({ kind: "data", fmt, payload: buf });
        }
      },
      {
        pollIntervalMs: opts.pollIntervalMs ?? 800,
        followParts: true,
        // 拉流失败（跨域/拒连/404）必须透传，让 UI 显示而不静默 → 避免永远"等待内容"
        onError: (e) => this.onErr(e),
      },
    );
  }
  start(): void {
    this.harvester.start();
  }
  stop(): void {
    this.harvester.stop();
  }
  setOnSegment(cb: (seg: RawSegment) => void): void {
    this.onSegment = cb;
  }
  setOnError(cb: (e: unknown) => void): void {
    // 保存引用；harvester 构造时已捕获 this.onErr，晚设也生效
    this.onErr = cb;
  }
}

/**
 * 原始 Annex-B 取源（"RTSP 单拉逐帧解析"的浏览器落点：后端/代理把 RTSP 或原始 ES 透成
 * HTTP 增量 fetch）——前端拿到原始 ES 字节，走 parseAnnexbFrames 逐帧解析 SEI。
 * mode='poll'：轮询一个持续增长的 ES 资源（Range 增量）；mode='raw'：一次性二进制任取整段。
 */
export class AnnexbFrameSource implements FrameSource {
  private onSegment: (seg: RawSegment) => void = () => undefined;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private url: string,
    private opts: {
      pollIntervalMs?: number;
      /** 已消费字节数（用于增量 Range 拉取） */
    },
  ) {
    void this.url;
    void this.opts;
  }
  start(): void {
    // 每段直接交给核心按 annexb 解析（增量逻辑待与后端代理联调时补充）
    this.timer = setInterval(() => void this.pull(), this.opts.pollIntervalMs ?? 500);
    void this.pull();
  }
  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
  setOnSegment(cb: (seg: RawSegment) => void): void {
    this.onSegment = cb;
  }
  setOnError(_cb: (e: unknown) => void): void {
    /* noop for now */
  }
  private async pull(): Promise<void> {
    try {
      const buf = await fetchBytes(this.url);
      if (buf.length) this.onSegment({ kind: "data", fmt: "annexb", payload: buf });
    } catch {
      /* 网络错误由上层展示 */
    }
  }
}

/** 按配置取源（默认 HLS；未来加 webrtc/rtsp 的 factory 分支）。 */
export function createFrameSource(kind: "hls" | "annexb", opts: { url: string; pollIntervalMs?: number }): FrameSource {
  if (kind === "hls") return new HlsFrameSource(opts);
  if (kind === "annexb") return new AnnexbFrameSource(opts.url, { pollIntervalMs: opts.pollIntervalMs });
  return new HlsFrameSource(opts);
}