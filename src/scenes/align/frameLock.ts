/**
 * 单路帧锁管线：HLS 增量拉取 → fMP4 demux → SEI 解析 → WebCodecs 解码 → 已解帧队列。
 *
 * 内存模型（重要）：**10 分钟"缓冲"在 HLS 原始下载层**（raw 采样环，字节级、磁盘/网络侧，
 * 可容忍 10 分钟）；WebCodecs 解码帧只在 T 周围的小窗口保留（GPU 显存装不下 10 分钟 1080p）。
 * 因此解码持续推进（把已到货样本解码），FrameQueue.advance(T) 把落后/超前 T 的帧淘汰，
 * 显存占用 = O(T 窗口)，与 10 分钟缓冲解耦。
 *
 * 解码走 WebCodecs（H264/HEVC，经 isConfigSupported 探测）；能力不可用/解不了 → 报告
 * mode='off'，由外层 SeiStream 回退 MSE StreamFrame（对齐兜底）。
 */
import { extractFmp4Samples } from "./fmp4";
import { extractTsVideo } from "./ts";
import { parseSampleSei, parseAnnexbFrames } from "./sei";
import { FrameQueue } from "./frameQueue";
import type { FrameSource, RawSegment } from "./transport";
import type { Codec, SeiFrameInfo, StreamHealth } from "./types";

/** 解码器薄接口（可替换/测试） */
export interface Decoder {
  /** 异步探测 + 配置解码器；返回是否可用（能力支持 & 配置成功） */
  configure(codecStr: string, description: Uint8Array | null): Promise<boolean>;
  /** 顺序喂一个样本；解码回调 onFrame(rtUs, isKey, videoFrame) */
  decodeSample(rtUs: number, isKey: boolean, payload: Uint8Array): void;
  flush(): Promise<void>;
  reset(): void;
  close(): void;
}

/** 原始(待解码)样本——按 rtUs 升序的 raw 环 */
interface RawSample { rtUs: number; isKey: boolean; payload: Uint8Array }

/** avcC → `avc1.PPCCLL`（profile/compat/level 取 avcC[1..3]） */
function avc1Codec(avcC: Uint8Array): string {
  const h = (b: number) => b.toString(16).padStart(2, "0");
  return `avc1.${h(avcC[1]!)}${h(avcC[2]!)}${h(avcC[3]!)}`;
}
/** hvcC → `hvc1.<profile>.<compat>.L<level>.B<constraints>`（尽力，失败回退空串） */
function hvc1Codec(hvcC: Uint8Array): string | null {
  try {
    const profile = hvcC[1]!; // general_profile_idc
    const compat = (hvcC[2]! << 16) | (hvcC[3]! << 8) | hvcC[4]!;
    const level = hvcC[12]!; // general_level_idc(high 8 bit)
    const compatStr = compat ? `0x${compat.toString(16).padStart(6, "0").replace(/^0+/, "")}` : "";
    return `hvc1.1.${profile}${compatStr ? `.${compatStr}` : ""}.L${level}`;
  } catch {
    return null;
  }
}

/**
 * WebCodecs 解码器实现（真实浏览器）。构造后 config 返回是否可用；不可用则后续 decode
 * 不会真正解码，isDecoding 保持 false——外层据此回退 MSE。
 */
class WebCodecsDecoder implements Decoder {
  private dec: globalThis.VideoDecoder | null = null;
  private onFrame: (rtUs: number, isKey: boolean, frame: globalThis.VideoFrame) => void;
  private pendingRt: number[] = [];
  private pendingKey: boolean[] = [];
  isDecoding = false;

  constructor(onFrame: (rtUs: number, isKey: boolean, frame: globalThis.VideoFrame) => void) {
    this.onFrame = onFrame;
  }

  async configure(codecStr: string, description: Uint8Array | null): Promise<boolean> {
    this.close();
    if (typeof VideoDecoder === "undefined" || typeof VideoEncoder === "undefined") return false;
    let support: globalThis.VideoDecoderSupport;
    try {
      const probe: globalThis.VideoDecoderConfig = { codec: codecStr };
      if (description && description.length > 0) probe.description = description;
      support = await VideoDecoder.isConfigSupported(probe);
      if (!support.supported) return false;
    } catch {
      return false;
    }
    try {
      this.dec = new VideoDecoder({
        output: (frame) => {
          const rt = this.pendingRt[0];
          const key = this.pendingKey[0];
          this.pendingRt.shift();
          this.pendingKey.shift();
          if (rt !== undefined) this.onFrame(rt, key, frame);
          else frame.close();
        },
        error: () => {
          this.dec?.close();
          this.dec = null;
          this.isDecoding = false;
        },
      });
      const cfg: globalThis.VideoDecoderConfig = { codec: codecStr };
      if (description && description.length > 0) cfg.description = description;
      void support;
      this.dec.configure(cfg);
      this.isDecoding = true;
      return true;
    } catch {
      this.isDecoding = false;
      this.dec = null;
      return false;
    }
  }

  decodeSample(rtUs: number, isKey: boolean, payload: Uint8Array): void {
    if (!this.dec || !this.isDecoding) return;
    this.pendingRt.push(rtUs);
    this.pendingKey.push(isKey);
    try {
      this.dec.decode(new EncodedVideoChunk({
        type: isKey ? "key" : "delta",
        timestamp: rtUs,
        data: payload,
      }));
    } catch {
      // 队列满/异常包：丢样本
      this.pendingRt.pop();
      this.pendingKey.pop();
    }
  }

  async flush(): Promise<void> {
    await this.dec?.flush();
  }
  reset(): void {
    try { this.dec?.reset(); } catch { /* noop */ }
  }
  close(): void {
    try { this.dec?.close(); } catch { /* noop */ }
    this.dec = null;
    this.isDecoding = false;
    this.pendingRt = [];
    this.pendingKey = [];
  }
}

export interface FrameLockStreamOptions {
  onError?: (e: unknown) => void;
  /** 模式翻转回传（能力异步探测后 aligned/off 会晚定） */
  onModeChange?: (mode: "aligned" | "off") => void;
  /** 原始采样环的最大 rt 跨度（µs）；默认 10 分钟 */
  rawSpanUs?: number;
}

/** 单路帧锁流。模式：aligned | off（能力不可用/无有效解码 → off，外层回退 MSE） */
export class FrameLockStream {
  private source: FrameSource;
  private decoder: WebCodecsDecoder;
  queue: FrameQueue;
  private raw: RawSample[] = []; // rtUs 升序
  private codec: Codec = "h264";
  private description: Uint8Array | null = null;
  private ready = false;
  private lastErr: unknown = null;
  private opts: FrameLockStreamOptions;
  private rawSpanUs: number;
  mode: "aligned" | "off" = "off";
  /** 是否已成功拿到内容（有样本/有 SEI 锚）——拉流失败是否该提示"拉不到流"的依据 */
  hasContent = false;
  /** 本路最近解码/到达的 rt（供自锚时钟） */
  lastArrivedRtUs: number | null = null;

  // ---- 连通性指标（维度对齐 SEIInjector 冒烟工具；供导播控制台观察） ----
  private st = { frames: 0, missing: 0, ntp: 0, key: 0, droppedSeq: 0, lastSeq: null as number | null, lastRtUs: null as number | null };
  private dtRing: number[] = [];

  constructor(source: FrameSource, opts: FrameLockStreamOptions = {}) {
    this.opts = opts;
    this.rawSpanUs = opts.rawSpanUs ?? 600_000_000; // 10 min in µs
    this.source = source;
    this.decoder = new WebCodecsDecoder((rtUs, isKey, frame) => {
      this.queue.add({ rtUs, isKey, handle: frame });
    });
    this.queue = new FrameQueue((e) => {
      const f = e.handle as globalThis.VideoFrame | null;
      try { f?.close(); } catch { /* noop */ }
    });
    this.source.setOnSegment((seg) => void this.onSegment(seg));
    this.source.setOnError((e) => { this.lastErr = e; this.opts.onError?.(e); });
  }

  start(): void {
    this.source.start();
  }
  stop(): void {
    this.source.stop();
    this.decoder.close();
    this.queue.clear();
  }

  private async onSegment(seg: RawSegment): Promise<void> {
    try {
      // 携带 codec/description（init 或上层已知）
      if (seg.codec) this.codec = seg.codec;
      if (seg.avcC) this.description = seg.avcC;
      if (seg.hvcC) this.description = seg.hvcC;

      if (seg.fmt === "fmp4") {
        const r = extractFmp4Samples(seg.payload);
        if (r.codec) this.codec = r.codec;
        if (r.avcC) this.description = r.avcC;
        if (r.hvcC) this.description = r.hvcC;
        if (seg.kind === "init" || r.avcC || r.hvcC) await this.configureDecoder();
        for (const s of r.samples) {
          const info = this.onSample(s);
          if (info && this.ready && this.mode === "aligned") {
            const rtUs = Number(info.realtime_us);
            this.raw.push({ rtUs, isKey: info.keyframe || s.isKey, payload: new Uint8Array(s.payload) });
            this.decoder.decodeSample(rtUs, info.keyframe || s.isKey, s.payload);
            this.trimRaw(rtUs);
          }
        }
        if (r.samples.length > 0) this.hasContent = true;
        return;
      }
      // TS（通用 HLS，MPEG-TS 分片）：先重装 PES → Annex-B ES，再解析 SEI 锚
      // （渲染解码仍待 WebCodecs-AnnexB 分支；TS 时至少锚/指标可见，脱离"等待内容"）。
      if (seg.fmt === "ts") {
        const es = extractTsVideo(seg.payload);
        if (es) this.ingestAnnexb(es);
        else this.opts.onError?.(new Error("TS 段重装失败（无视频 PES）"));
        return;
      }
      // annexb（原始 ES / RTSP 代理单拉落点）：只解析 SEI 更新前沿锚（供速率控制 T 与
      // 延迟测量），不渲染解码——真解需转 AVCC 或 PES 重装（另一解码分支，后续按需）。
      this.ingestAnnexb(seg.payload);
    } catch (e) {
      this.lastErr = e;
      this.opts.onError?.(e);
    }
  }

  private async configureDecoder(): Promise<void> {
    const avcC = this.codec === "h264" ? this.description : null;
    const hvcC = this.codec === "hevc" ? this.description : null;
    const codecStr = this.codec === "h264"
      ? (avcC ? avc1Codec(avcC) : "avc1.42E01F")
      : (hvcC ? (hvc1Codec(hvcC) ?? "hvc1.1.6.L93.B0") : "hvc1.1.6.L93.B0");
    const ok = await this.decoder.configure(codecStr, this.description);
    if (ok) {
      this.mode = "aligned";
      this.ready = true;
    } else {
      this.mode = "off";
      this.ready = false;
    }
    this.opts.onModeChange?.(this.mode);
  }

  /** 逐样本统计（无论是否可解码都记，供连通性观察）；返回 SEI 信息（无则 null） */
  private onSample(s: { payload: Uint8Array; isKey: boolean }): SeiFrameInfo | null {
    const info = parseSampleSei(s.payload, this.codec);
    if (!info) {
      this.st.missing++;
      return null;
    }
    const rtUs = Number(info.realtime_us);
    this.st.frames++;
    this.st.ntp += info.clock_ntp ? 1 : 0;
    this.st.key += info.keyframe || s.isKey ? 1 : 0;
    if (this.st.lastSeq != null) {
      const d = (info.seq - this.st.lastSeq + 0x100000000) % 0x100000000;
      if (d !== 1 && d > 1) this.st.droppedSeq++;
    }
    this.st.lastSeq = info.seq;
    if (this.st.lastRtUs != null) {
      const dt = rtUs - this.st.lastRtUs;
      if (dt > 0 && dt < 100_000) {
        this.dtRing.push(dt);
        if (this.dtRing.length > 30) this.dtRing.shift();
      }
    }
    this.st.lastRtUs = rtUs;
    this.lastArrivedRtUs = rtUs;
    return info;
  }

  /** Annex-B ES → 逐 SEI 锚：更新前沿/指标/内容标记（TS 与原始 ES 共用） */
  private ingestAnnexb(es: Uint8Array): void {
    const infos = parseAnnexbFrames(es, this.codec);
    if (infos.length > 0) this.hasContent = true;
    for (const info of infos) {
      this.st.frames++;
      this.st.ntp += info.clock_ntp ? 1 : 0;
      this.st.key += info.keyframe ? 1 : 0;
      this.lastArrivedRtUs = Number(info.realtime_us);
    }
  }

  /** 连通性/健康快照 */
  stats(): StreamHealth {
    const n = this.dtRing.length;
    const mean = n ? this.dtRing.reduce((a, b) => a + b, 0) / n : null;
    return {
      codec: this.codec,
      frames: this.st.frames,
      missing: this.st.missing,
      ntp: this.st.ntp,
      key: this.st.key,
      droppedSeq: this.st.droppedSeq,
      fps: mean ? 1_000_000 / mean : null,
      hasContent: this.hasContent,
      mode: this.mode,
      frontRtUs: this.lastArrivedRtUs,
    };
  }

  private trimRaw(frontUs: number): void {
    const minUs = frontUs - this.rawSpanUs;
    while (this.raw.length && this.raw[0]!.rtUs < minUs) this.raw.shift();
  }

  /** 由权威调度每帧调用：推进已解帧队列到 T，淘汰落后/超前帧 */
  advance(targetUs: number): void {
    this.queue.advance(targetUs);
  }

  /** 本路最前已到货 rt（µs）；无内容 null */
  frontier(): number | null {
    return this.lastArrivedRtUs;
  }

  /** 取最接近 T 的已解帧句柄 */
  nearest(targetUs: number): unknown | null {
    return this.queue.nearest(targetUs)?.handle ?? null;
  }

  get readyState(): boolean {
    return this.ready;
  }
  get error(): unknown {
    return this.lastErr;
  }
}

export { WebCodecsDecoder, avc1Codec, hvc1Codec };