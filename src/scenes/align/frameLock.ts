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
  private onFrame: (rtUs: number, isKey: boolean, frame: globalThis.VideoFrame) => void;
  private onErr?: (e: unknown) => void;
  private pendingRt: number[] = [];
  private pendingKey: boolean[] = [];
  isDecoding = false;

  constructor(
    onFrame: (rtUs: number, isKey: boolean, frame: globalThis.VideoFrame) => void,
    onErr?: (e: unknown) => void,
  ) {
    this.onFrame = onFrame;
    this.onErr = onErr;
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
        error: (e) => {
          const m = e instanceof Error ? e.message : String(e ?? "VideoDecoder error");
          this.onErr?.(new Error(m));
          // 报错后 codec 可能已进入 closed 态，再 close() 会抛 InvalidStateError——try 兜底
          try { this.dec?.close(); } catch { /* already closed */ }
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
  /** sample 封装形态：AVCC(长度前缀) 或 Annex-B(起始码)——决定 WebCodecs description */
  private encapsulation: "avcc" | "annexb" | null = null;
  /** 最近解码错误（明文） */
  decodeError: string | null = null;

  // ---- 连通性指标（维度对齐 SEIInjector 冒烟工具；供导播控制台观察） ----
  private st = { frames: 0, segs: 0, missing: 0, ntp: 0, key: 0, droppedSeq: 0, lastSeq: null as number | null, lastRtUs: null as number | null };
  private dtRing: number[] = [];

  constructor(source: FrameSource, opts: FrameLockStreamOptions = {}) {
    this.opts = opts;
    this.rawSpanUs = opts.rawSpanUs ?? 600_000_000; // 10 min in µs
    this.source = source;
    this.decoder = new WebCodecsDecoder(
      (rtUs, isKey, frame) => {
        // 去重：该 rt 已有帧 → 新的 VideoFrame 必须 close，否则 GC 未 close 泄漏
        if (this.queue.has(rtUs)) {
          try { frame.close(); } catch { /* noop */ }
          return;
        }
        this.queue.add({ rtUs, isKey, handle: frame });
      },
      (e) => {
        const m = e instanceof Error ? e.message : String(e);
        console.error("[align decode]", m);
        this.decodeError = m;
        this.needKey = true; // 报错 → 下个关键帧重同步，而非永久卡死
        this.opts.onError?.(e);
      },
    );
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
        for (const s of r.samples) {
          const info = this.onSample(s);
          if (!info) continue; // 无 SEI 戳的样本不参与（没有 rt 锚也无需呈现）
          // 延迟解码：到货只入原始环（10min 字节级缓存），解码由 pump(T) 按虚拟时间节流
          this.raw.push({ rtUs: Number(info.realtime_us), isKey: s.isKey || info.keyframe, payload: new Uint8Array(s.payload) });
        }
        this.trimRaw(this.lastArrivedRtUs ?? 0);
        if (r.samples.length > 0) {
          this.hasContent = true;
          this.st.segs++;
        }
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

  private async configureDecoder(): Promise<void> {
    const avcC = this.codec === "h264" ? this.description : null;
    const hvcC = this.codec === "hevc" ? this.description : null;
    const codecStr = this.codec === "h264"
      ? (avcC ? avc1Codec(avcC) : "avc1.42E01F")
      : (hvcC ? (hvc1Codec(hvcC) ?? "hvc1.1.6.L93.B0") : "hvc1.1.6.L93.B0");
    // 关键：AVCC 需带 avcC/hvcC description；Annex-B 起止需去掉 description（数据按起始码喂）。
    const useDesc = this.encapsulation === "annexb" ? null : this.description;
    const ok = await this.decoder.configure(codecStr, useDesc);
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
      // 只统计真实帧间隔：≥1ms(≤1000fps) 且 <200ms(≥5fps)，排除近零重复/长卡顿
      if (dt >= 1_000 && dt < 200_000) {
        this.dtRing.push(dt);
        if (this.dtRing.length > 60) this.dtRing.shift();
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
      hasContent: this.hasContent,
      mode: this.mode,
      frontRtUs: this.lastArrivedRtUs,
      decodeError: this.decodeError,
    };
  }

  private trimRaw(frontUs: number): void {
    const minUs = frontUs - this.rawSpanUs;
    while (this.raw.length && this.raw[0]!.rtUs < minUs) this.raw.shift();
  }

  /** 由权威调度每帧调用：先按虚拟时间 T 把该解的解码出来（延迟解码），再推进队列淘汰旧帧 */
  advance(targetUs: number): void {
    this.pump(targetUs);
    this.queue.advance(targetUs);
  }

  // ---- 延迟解码：解码器只喂 T 附近的原始样本（上屏帧 rt≈T，比前沿落后 30s），
  //      解出的帧进小窗口队列；原始环按 10min 缓存。避免"解码即上屏被 advance 全丢"。----
  private decPos = 0; // raw 环里下一个要喂给解码器的样本下标
  private pendingConfigure = false;
  private lastFedRtUs: number | null = null;
  /** 断流/解码报错后需要等下一个关键帧重同步 */
  private needKey = false;
  private resyncCount = 0;
  /** 判定跳段（断流丢分片等）的 rt 间隔阈值（µs）——0.2s 抓更小的孔洞 */
  private static readonly GAP_US = 200_000;
  /** 断流重同步后清零解码错误提示 */
  private resynced = false;
  /** 连续 resync 仍失败的上限（防止反复崩在同一坏区） */
  private static readonly MAX_RESYNC = 3;

  /** T 之前最近的可用关键帧下标（解码需从关键帧起），无则 -1 */
  private findStartKeyframe(targetUs: number): number {
    let idx = -1;
    for (let i = 0; i < this.raw.length; i++) {
      if (this.raw[i]!.rtUs > targetUs) break;
      if (this.raw[i]!.isKey) idx = i;
    }
    if (idx >= 0) return idx;
    for (let i = 0; i < this.raw.length; i++) if (this.raw[i]!.isKey) return i;
    return -1;
  }

  /** 把 raw 里 rtUs ≤ targetUs+lookahead 的样本顺序喂解码器（首次从 T 前关键帧起播） */
  private pump(targetUs: number): void {
    const lookaheadUs = 4_000_000; // T 之后预解 4s（给 nearest 留富余）
    if (!this.encapsulation) {
      const start = this.findStartKeyframe(targetUs);
      if (start < 0) return;
      this.decPos = start;
      this.encapsulation = detectEncapsulation(this.raw[start]!.payload);
      this.pendingConfigure = true;
      void this.configureDecoder(); // mode/ready 异步落定
      return;
    }
    if (this.pendingConfigure) {
      if (this.mode !== "aligned" || !this.ready) return;
      this.pendingConfigure = false;
      if (this.resynced) { this.resynced = false; this.decodeError = null; }
    }
    while (this.decPos < this.raw.length && this.raw[this.decPos]!.rtUs <= targetUs + lookaheadUs) {
      const s = this.raw[this.decPos]!;
      // 断流/跳段（间隔超 GAP_US）→ 标记需要到下一个关键帧重同步
      if (this.lastFedRtUs !== null && s.rtUs - this.lastFedRtUs > FrameLockStream.GAP_US) {
        this.needKey = true;
      }
      if (this.needKey) {
        if (!s.isKey) { this.decPos++; continue; } // 跳过到关键帧
        // 到关键帧 → 重置解码器重配（从干净点起播）；若带内能取到新 SPS/PPS 用新 description，
        // 应对编码器中途改参数/丢参数（否则多次 resync 仍崩在同一坏区）
        this.resyncCount++;
        if (this.resyncCount > FrameLockStream.MAX_RESYNC) { this.needKey = false; this.resyncCount = 0; }
        this.decoder.close();
        if (this.encapsulation === "avcc") {
          const fresh = extractInbandAvcC(s.payload);
          if (fresh && fresh.length > 7) this.description = fresh;
        }
        this.pendingConfigure = true;
        this.resynced = true;
        void this.configureDecoder();
        this.needKey = false;
        this.lastFedRtUs = null;
        break; // 配置异步，下一轮 pump 再喂本关键帧
      }
      this.lastFedRtUs = s.rtUs;
      this.decPos++;
      this.decoder.decodeSample(s.rtUs, s.isKey, s.payload);
    }
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