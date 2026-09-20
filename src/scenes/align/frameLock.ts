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
import { parseSampleSei, parseAnnexbFrames, splitAvcc } from "./sei";
import { FrameQueue } from "./frameQueue";
import { logSeg, logDec, logResync } from "./debugLog";
import type { FrameSource, RawSegment } from "./transport";
import { CATCHUP } from "./rateControl";
import type { Codec, SeiFrameInfo, StreamHealth } from "./types";

/** 解码器薄接口（可替换/测试） */
export interface Decoder {
  /** 异步探测 + 配置解码器；返回是否可用（能力支持 & 配置成功） */
  configure(codecStr: string, description: Uint8Array | null): Promise<boolean>;
  /** 顺序喂一个样本；解码回调 onFrame(rtUs, isKey, videoFrame) */
  decodeSample(rtUs: number, isKey: boolean, payload: Uint8Array): boolean;
  flush(): Promise<void>;
  reset(): void;
  close(): void;
}

/** Encoded samples stay in container/decode order, including reordered B frames. */
interface RawSample {
  rtUs: number; isKey: boolean; payload: Uint8Array;
  epoch: number; codec: Codec; description: Uint8Array | null;
}

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

/** 判断样本封装：起始码 00 00 00 01 → Annex-B（喂解码时去掉 description）；否则 AVCC */
function detectEncapsulation(payload: Uint8Array): "avcc" | "annexb" {
  return payload.length >= 4 && payload[0] === 0 && payload[1] === 0 && payload[2] === 0 && payload[3] === 1
    ? "annexb"
    : "avcc";
}

/** 从关键帧样本带内提取 SPS/PPS 构建新的 avcC(description)——应对编码器中途改参数/丢参数。
 *  AVCC 封装：NALS 长度前缀；取 type7(SPS)/type8(PPS)。提取不到返回 null（沿用旧 description）。 */
function extractInbandAvcC(payload: Uint8Array): Uint8Array | null {
  const nals = splitAvcc(payload);
  const sps = nals.find((n) => (n[0]! & 0x1f) === 7);
  const pps = nals.find((n) => (n[0]! & 0x1f) === 8);
  if (!sps || !pps) return null;
  const len = 7 + 2 + sps.length + 2 + pps.length; // avcC 头 7B + 两个 NAL
  const avcC = new Uint8Array(len);
  avcC[0] = 1; // configurationVersion
  avcC[1] = sps[1]!; // AVCProfileIndication
  avcC[2] = sps[2]!; // profile_compatibility
  avcC[3] = sps[3]!; // AVCLevelIndication
  avcC[4] = 0xff; // lengthSizeMinusOne=3（4 字节长度前缀）
  avcC[5] = 0xe1; // numOfSPS=1
  avcC[6] = (sps.length >> 8) & 0xff;
  avcC[7] = sps.length & 0xff;
  avcC.set(sps, 8);
  avcC[8 + sps.length] = 1; // numOfPPS=1
  avcC[9 + sps.length] = (pps.length >> 8) & 0xff;
  avcC[10 + sps.length] = pps.length & 0xff;
  avcC.set(pps, 11 + sps.length);
  return avcC;
}

/**
 * WebCodecs 解码器实现（真实浏览器）。构造后 config 返回是否可用；不可用则后续 decode
 * 不会真正解码，isDecoding 保持 false——外层据此回退 MSE。
 */
class WebCodecsDecoder implements Decoder {
  private dec: globalThis.VideoDecoder | null = null;
  private generation = 0;
  private pending = new Map<number, boolean>();
  isDecoding = false;
  constructor(
    private onFrame: (rtUs: number, isKey: boolean, frame: globalThis.VideoFrame) => void,
    private onErr?: (e: unknown) => void,
  ) {}
  get queueSize(): number { return this.dec?.decodeQueueSize ?? 0; }
  get pendingSize(): number { return this.pending.size; }
  async configure(codec: string, description: Uint8Array | null): Promise<boolean> {
    this.close();
    const generation = this.generation;
    if (typeof VideoDecoder === "undefined") {
      this.onErr?.(new Error("浏览器未提供 VideoDecoder；请检查 HTTPS 安全上下文及浏览器/OBS 版本"));
      return false;
    }
    const config: globalThis.VideoDecoderConfig = { codec };
    if (description?.length) config.description = description;
    try {
      const support = await VideoDecoder.isConfigSupported(config);
      if (generation !== this.generation) return false;
      if (!support.supported) {
        this.onErr?.(new Error(`浏览器不支持视频解码配置 ${codec}`));
        return false;
      }
      this.dec = new VideoDecoder({
        output: (frame) => {
          if (generation !== this.generation) { frame.close(); return; }
          const key = this.pending.get(frame.timestamp);
          this.pending.delete(frame.timestamp);
          if (key === undefined) { frame.close(); return; }
          this.onFrame(frame.timestamp, key, frame);
        },
        error: (error) => {
          if (generation !== this.generation) return;
          this.close();
          this.onErr?.(error);
        },
      });
      this.dec.configure(config);
      this.isDecoding = true;
      return true;
    } catch (error) {
      if (generation === this.generation) { this.close(); this.onErr?.(error); }
      return false;
    }
  }
  decodeSample(rtUs: number, isKey: boolean, payload: Uint8Array): boolean {
    if (!this.dec || !this.isDecoding) return false;
    this.pending.set(rtUs, isKey);
    try {
      this.dec.decode(new EncodedVideoChunk({ type: isKey ? "key" : "delta", timestamp: rtUs, data: payload }));
      return true;
    } catch (error) {
      this.close(); // preserve neither stale metadata nor a damaged reference chain
      this.onErr?.(error);
      return false;
    }
  }
  async flush(): Promise<void> { await this.dec?.flush(); }
  reset(): void { this.close(); }
  close(): void {
    this.generation++;
    try { this.dec?.close(); } catch { /* already closed */ }
    this.dec = null;
    this.isDecoding = false;
    this.pending.clear();
  }
}

export interface FrameLockStreamOptions {
  onError?: (e: unknown) => void;
  /** 模式翻转回传（能力异步探测后 aligned/off 会晚定） */
  onModeChange?: (mode: "aligned" | "off") => void;
  /** 原始采样环的最大 rt 跨度（µs）；默认 10 分钟 */
  rawSpanUs?: number;
  maxRawBytes?: number;
  maxRawSamples?: number;
}

/** 单路帧锁流。模式：aligned | off（能力不可用/无有效解码 → off，外层回退 MSE） */
export class FrameLockStream {
  private source: FrameSource;
  private decoder: WebCodecsDecoder;
  queue: FrameQueue;
  private raw: RawSample[] = []; // decode order
  private rawBytes = 0;
  private frameBytes = 1920 * 1080 * 4;
  private videoTrackId: number | undefined;
  private targetUs: number | null = null;
  private stopped = false;
  private generation = 0;
  private ingestEpoch = 0;
  private decodedEpoch = -1;
  private ingestBroken = false;
  private continuousFromUs: number | null = null;
  private continuousToUs: number | null = null;
  private lastInputSeq: number | null = null;
  private lastInputRt: number | null = null;
  private memoryBlocked = false;
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
  /** sample 封装形态：AVCC(长度前缀) 或 Annex-B(起始码)——决定 WebCodecs description */
  private encapsulation: "avcc" | "annexb" | null = null;
  /** 最近解码错误（明文） */
  decodeError: string | null = null;

  // ---- 连通性指标（维度对齐 SEIInjector 冒烟工具；供导播控制台观察） ----
  private st = { frames: 0, segs: 0, missing: 0, ntp: 0, key: 0, droppedSeq: 0, lastSeq: null as number | null, lastRtUs: null as number | null };
  private dtRing: number[] = [];
  /** 近 1s 内的到达时刻（算实时每秒帧率；累计 frames 总数与此分开） */
  private liveArr: number[] = [];

  constructor(source: FrameSource, opts: FrameLockStreamOptions = {}) {
    this.opts = opts;
    this.rawSpanUs = opts.rawSpanUs ?? 600_000_000; // 10 min in µs
    this.source = source;
    this.decoder = new WebCodecsDecoder(
      (rtUs, isKey, frame) => {
        if (this.stopped) { frame.close(); return; }
        this.frameBytes = Math.max(1, frame.displayWidth * frame.displayHeight * 4);
        this.decodeError = null;
        this.decOutput++; // 解码器确实产出了帧
        // 去重：该 rt 已有帧 → 新的 VideoFrame 必须 close，否则 GC 未 close 泄漏
        if (this.queue.has(rtUs)) {
          try { frame.close(); } catch { /* noop */ }
          return;
        }
        if (this.targetUs != null && rtUs < this.targetUs - 150_000) { frame.close(); return; }
        this.queue.add({ rtUs, isKey, handle: frame });
      },
      (e) => {
        const m = e instanceof Error ? e.message : String(e);
        console.error("[align decode]", m);
        logResync("dec-err", `解码报错：${m}｜上帧rt=${this.lastFedRtUs != null ? `${(this.lastFedRtUs / 1e6) % 10000}s` : "无"} → 下个关键帧重同步`);
        this.decodeError = m;
        this.resyncErr++; // 细分计数：解码错误引起的 resync（指标行显示）
        this.needKey = true; // 报错 → 下个关键帧重同步，而非永久卡死
        this.opts.onError?.(e);
      },
    );
    this.queue = new FrameQueue((e) => {
      const f = e.handle as globalThis.VideoFrame | null;
      try { f?.close(); } catch { /* noop */ }
    }, CATCHUP.maxFrameErrorUs, CATCHUP.maxFrameErrorUs);
    this.source.setOnSegment((seg) => { if (!this.stopped) this.onSegment(seg); });
    this.source.setOnError((e) => { if (this.stopped) return; this.lastErr = e; this.opts.onError?.(e); });
  }

  start(): void {
    this.source.start();
  }
  stop(): void {
    this.stopped = true;
    this.generation++;
    this.source.stop();
    this.decoder.close();
    this.queue.clear();
    this.raw = [];
    this.rawBytes = 0;
  }

  private onSegment(seg: RawSegment): void {
    try {
      // 携带 codec/description（init 或上层已知）
      if (this.memoryBlocked) return;
      if (seg.codec) this.codec = seg.codec;
      if (seg.avcC) this.description = seg.avcC;
      if (seg.hvcC) this.description = seg.hvcC;

      if (seg.fmt === "fmp4") {
        const r = extractFmp4Samples(seg.payload);
        if (r.videoTrackId != null) this.videoTrackId = r.videoTrackId;
        if (r.codec) this.codec = r.codec;
        if (r.avcC) this.description = r.avcC;
        if (r.hvcC) this.description = r.hvcC;
        if (seg.discontinuity) this.breakInput();
        let seiHits = 0;
        for (const sample of r.samples) {
          if (this.videoTrackId != null && sample.trackId !== this.videoTrackId) continue;
          const info = this.onSample(sample);
          if (!info) { this.breakInput(); continue; }
          const rtUs = Number(info.realtime_us);
          // Sequence is encoder output order, not presentation order. Never sort raw by rt.
          if (this.lastInputSeq === info.seq && this.lastInputRt === rtUs) continue;
          if (this.lastInputSeq != null && ((info.seq - this.lastInputSeq) >>> 0) !== 1) this.breakInput();
          this.lastInputSeq = info.seq;
          this.lastInputRt = rtUs;
          const isKey = sample.isKey || info.keyframe;
          if (this.ingestBroken && !isKey) continue;
          if (isKey && (this.ingestBroken || this.continuousFromUs == null)) {
            this.continuousFromUs = rtUs;
            this.continuousToUs = rtUs;
            this.ingestBroken = false;
          }
          if (this.continuousFromUs == null) continue;
          this.continuousToUs = Math.max(this.continuousToUs ?? rtUs, rtUs);
          seiHits++;
          this.raw.push({ rtUs, isKey, payload: sample.payload, epoch: this.ingestEpoch,
            codec: this.codec, description: this.description });
          this.rawBytes += sample.payload.byteLength;
        }
        this.trimRaw(this.lastArrivedRtUs ?? 0);
        logSeg("seg", `${seg.kind} samples=${r.samples.length} SEI=${seiHits} raw=${this.raw.length}`);
        if (r.samples.length > 0) { this.hasContent = true; this.st.segs++; }
        return;
      }
      // TS（通用 HLS，MPEG-TS 分片）：先重装 PES → Annex-B ES，再解析 SEI 锚
      // （渲染解码仍待 WebCodecs-AnnexB 分支；TS 时至少锚/指标可见，脱离"等待内容"）。
      if (seg.fmt === "ts") {
        this.st.segs++;
        const es = extractTsVideo(seg.payload);
        if (es) this.ingestAnnexb(es);
        else this.opts.onError?.(new Error("TS 段重装失败（无视频 PES）"));
        return;
      }
      // annexb（原始 ES / RTSP 代理单拉落点）：只解析 SEI 更新前沿锚（供速率控制 T 与
      // 延迟测量），不渲染解码——真解需转 AVCC 或 PES 重装（另一解码分支，后续按需）。
      this.st.segs++;
      this.ingestAnnexb(seg.payload);
    } catch (e) {
      this.lastErr = e;
      this.opts.onError?.(e);
    }
  }

  private async configureDecoder(codec: Codec, description: Uint8Array | null): Promise<void> {
    const generation = this.generation;
    const avcC = codec === "h264" ? description : null;
    const hvcC = codec === "hevc" ? description : null;
    const codecStr = codec === "h264"
      ? (avcC ? avc1Codec(avcC) : "avc1.42E01F")
      : (hvcC ? (hvc1Codec(hvcC) ?? "hvc1.1.6.L93.B0") : "hvc1.1.6.L93.B0");
    // 关键：AVCC 需带 avcC/hvcC description；Annex-B 起止需去掉 description（数据按起始码喂）。
    const useDesc = this.encapsulation === "annexb" ? null : description;
    const ok = await this.decoder.configure(codecStr, useDesc);
    if (this.stopped || generation !== this.generation) return;
    this.pendingConfigure = false;
    if (ok) {
      this.mode = "aligned";
      this.ready = true;
    } else {
      this.mode = "off";
      this.ready = false;
      this.needKey = false; // rejected configuration is terminal until explicit recovery
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
    const nowArr = performance.now();
    this.liveArr.push(nowArr);
    while (this.liveArr.length && this.liveArr[0]! < nowArr - 1000) this.liveArr.shift();
    this.st.ntp += info.clock_ntp ? 1 : 0;
    this.st.key += info.keyframe || s.isKey ? 1 : 0;
    if (this.st.lastSeq != null) {
      const d = (info.seq - this.st.lastSeq + 0x100000000) % 0x100000000;
      if (d !== 1 && d > 1) this.st.droppedSeq++;
    }
    this.st.lastSeq = info.seq;
    if (this.st.lastRtUs != null) {
      const dt = rtUs - this.st.lastRtUs;
      // 只统计真实帧间隔：≥1ms(≤1000fps) 且 <200ms(≥5fps)，排除近零重复/长卡顿
      if (dt >= 1_000 && dt < 200_000) {
        this.dtRing.push(dt);
        if (this.dtRing.length > 60) this.dtRing.shift();
      }
    }
    this.st.lastRtUs = rtUs;
    this.lastArrivedRtUs = Math.max(this.lastArrivedRtUs ?? rtUs, rtUs);
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
    // 用中位数而非均值：稳健，抗偶发半帧/双 SEI 造成的 dt 偏小
    const srt = [...this.dtRing].sort((a, b) => a - b);
    const median = n ? (n % 2 ? srt[(n - 1) >> 1]! : (srt[n / 2 - 1]! + srt[n / 2]!) / 2) : null;
    return {
      codec: this.codec,
      frames: this.st.frames,
      segs: this.st.segs,
      missing: this.st.missing,
      ntp: this.st.ntp,
      key: this.st.key,
      droppedSeq: this.st.droppedSeq,
      fps: median ? 1_000_000 / median : null,
      liveFps: this.liveArr.length,
      hasContent: this.hasContent,
      mode: this.mode,
      frontRtUs: this.lastArrivedRtUs,
      decodeError: this.decodeError,
      queueLen: this.queue.length,
      resyncs: this.resyncs,
      rawLen: this.raw.length,
      decPos: this.decPos,
      enc: this.encapsulation ?? "",
      decOutput: this.decOutput,
      qc: this.decoder.queueSize,
      pendCfg: this.pendingConfigure,
      segRetries: this.source.harvesterStats().retries,
      segGaveUp: this.source.harvesterStats().gaveUp,
      segAuth: this.source.harvesterStats().authFail,
      resyncGap: this.resyncGap,
      resyncErr: this.resyncErr,
      rawBytes: this.rawBytes,
      continuousFromUs: this.continuousFromUs,
      continuousToUs: this.continuousToUs,
      decodedFromUs: this.queue.stats().backUs,
      decodedToUs: this.queue.frontier(),
      memoryBlocked: this.memoryBlocked,
    };
  }

  private breakInput(): void {
    if (!this.ingestBroken) { this.ingestEpoch++; this.resyncGap++; }
    this.ingestBroken = true;
    this.continuousFromUs = null;
    this.continuousToUs = null;
  }

  private trimRaw(frontUs: number): void {
    // Only evict already-consumed GOPs, never the GOP required to decode the target.
    const protectedKey = this.targetUs == null ? 0 : Math.max(0, this.findStartKeyframe(this.targetUs));
    const limit = Math.min(this.decPos, protectedKey);
    const maxBytes = this.opts.maxRawBytes ?? 512 * 1024 * 1024;
    const maxSamples = this.opts.maxRawSamples ?? 72_000;
    let remove = 0, bytes = this.rawBytes;
    while (remove < limit && (this.raw[remove]!.rtUs < frontUs - this.rawSpanUs ||
      bytes > maxBytes || this.raw.length - remove > maxSamples)) {
      bytes -= this.raw[remove++]!.payload.byteLength;
    }
    if (remove) { this.raw.splice(0, remove); this.decPos -= remove; this.rawBytes = bytes; }
    if (this.rawBytes > maxBytes || this.raw.length > maxSamples) {
      // Explicit resource stop: do not silently discard unplayed target media.
      this.memoryBlocked = true;
      this.source.stop();
      this.decodeError = "缓存达到预算，收片已停止";
      this.opts.onError?.(new Error("对齐缓存达到内存预算；已停止收片，请刷新或降低码率"));
    }
  }

  canSeek(targetUs: number): boolean {
    const coverage = this.coverage();
    const key = this.findStartKeyframe(targetUs);
    return !this.stopped && !!coverage && targetUs >= coverage.from && targetUs <= coverage.to &&
      key >= 0 && this.raw[key]!.epoch === this.ingestEpoch;
  }

  /** Discard old decoder references and callbacks, then rebuild from the target GOP. */
  seek(targetUs: number): boolean {
    if (!this.canSeek(targetUs)) return false;
    this.generation++;
    this.decoder.close();
    this.queue.clear();
    this.pendingConfigure = false;
    this.ready = false;
    this.needKey = true;
    this.decodedEpoch = -1;
    this.decPos = this.findStartKeyframe(targetUs);
    this.encapsulation = detectEncapsulation(this.raw[this.decPos]!.payload);
    this.targetUs = targetUs;
    return true;
  }

  advance(targetUs: number): void {
    this.targetUs = targetUs;
    this.queue.advance(targetUs);
    this.pump(targetUs);
    this.trimRaw(this.lastArrivedRtUs ?? 0);
  }

  private decPos = 0;
  private pendingConfigure = false;
  private lastFedRtUs: number | null = null;
  private needKey = false;
  resyncs = 0;
  private resyncGap = 0;
  private resyncErr = 0;
  decOutput = 0;

  private findStartKeyframe(targetUs: number): number {
    let idx = -1;
    for (let i = 0; i < this.raw.length; i++) {
      const s = this.raw[i]!;
      if (s.isKey && s.rtUs <= targetUs) idx = i;
    }
    return idx;
  }

  private pump(targetUs: number): void {
    if (this.stopped || this.pendingConfigure) return;
    if (!this.encapsulation) {
      const start = this.findStartKeyframe(targetUs);
      if (start < 0) return;
      this.decPos = start;
      this.needKey = true;
      this.encapsulation = detectEncapsulation(this.raw[start]!.payload);
    }
    // Old displayed pixels live in canvas; VideoFrames outside nearest(T)'s
    // tolerance must not hold the budget while the decoder needs more input.
    if (this.queue.length >= 96 || this.queue.bytes + (this.decoder.pendingSize + 1) * this.frameBytes > 128 * 1024 * 1024) {
      this.queue.discardBefore(targetUs - CATCHUP.maxFrameErrorUs);
      // The wider presentation tolerance must not let old candidates block
      // decoding. Keep the closest past candidate and every future frame.
      const past = this.queue.candidates(targetUs, CATCHUP.maxFrameErrorUs).filter(f => f.rtUs <= targetUs);
      if (past.length) this.queue.discardBefore(past[past.length - 1]!.rtUs);
    }
    let fed = 0;
    while (this.decPos < this.raw.length && this.decoder.queueSize < 12 &&
      this.decoder.pendingSize < 32 && this.queue.length < 96 && this.queue.bytes + (this.decoder.pendingSize + 1) * this.frameBytes <= 128 * 1024 * 1024) {
      const sample = this.raw[this.decPos]!;
      if (sample.rtUs > targetUs + 250_000) break;
      if (sample.epoch !== this.decodedEpoch) this.needKey = true;
      if (this.needKey) {
        if (!sample.isKey) { this.decPos++; continue; }
        this.generation++;
        this.decoder.close();
        this.encapsulation = detectEncapsulation(sample.payload);
        const description = sample.codec === "h264" && this.encapsulation === "avcc"
          ? extractInbandAvcC(sample.payload) ?? sample.description : sample.description;
        this.decodedEpoch = sample.epoch;
        this.pendingConfigure = true;
        this.needKey = false;
        this.ready = false;
        this.resyncs++;
        void this.configureDecoder(sample.codec, description);
        break;
      }
      if (!this.ready) break; // unsupported config: explicit waiting, no silent consumption
      if (!this.decoder.decodeSample(sample.rtUs, sample.isKey, sample.payload)) {
        // Failed sample cannot be retried as delta against a new decoder.
        this.decPos++;
        this.needKey = true;
        this.ready = false;
        break;
      }
      this.lastFedRtUs = sample.rtUs;
      this.decPos++;
      fed++;
    }
    if (fed) logDec("pump", `T=${targetUs} fed=${fed} pos=${this.decPos} decoded=${this.decOutput}`);
  }

  /** Continuous encoded coverage since the last loss; excludes undecodable deltas. */
  coverage(): { from: number; to: number } | null {
    return this.continuousFromUs == null || this.continuousToUs == null ? null
      : { from: this.continuousFromUs, to: this.continuousToUs };
  }

  /** 本路最前已到货 rt（µs）；无内容 null */
  frontier(): number | null {
    return this.lastArrivedRtUs;
  }

  /** 取最接近 T 的已解帧句柄 */
  nearest(targetUs: number): unknown | null {
    return this.queue.nearest(targetUs, 40_000)?.handle ?? null;
  }

  get readyState(): boolean {
    return this.ready;
  }
  get error(): unknown {
    return this.lastErr;
  }
}

export { WebCodecsDecoder, avc1Codec, hvc1Codec };