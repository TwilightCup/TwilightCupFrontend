/**
 * HLS 增量拉取：轮询 m3u8，解析 init + parts/segments，对新增内容逐个 fetch。
 * 兼容 LL-HLS（#EXT-X-PART / #EXT-X-PRELOAD-HINT 由播放器决定是否追）与经典 segments，
 * 含 #EXT-X-MAP init 段。fetch 可用在主线程也可在 Web Worker 内。
 */
import type { HlsPlaylist, HlsSegmentItem } from "./types";
import type { HarvesterStats } from "./types";
import { logSeg } from "./debugLog";

/** 解析 m3u8 文本 → init + items + master 变体选择（镜像冒烟工具 parseM3u8，扩展 master） */
export function parseM3u8(text: string, base: string): HlsPlaylist {
  const init: { uri: string | null } = { uri: null };
  const items: HlsSegmentItem[] = [];
  const lines = text.split(/\r?\n/);
  let pendingDur: number | null = null;
  let sequence = 0, discontinuity = 0;
  let gap = false;
  let bestVariant: { uri: string; score: number } | null = null;
  const resolve = (u: string) => new URL(u, base).href;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (!line || line.startsWith("#EXT-X-VERSION")) continue;
    if (line.startsWith("#EXT-X-MEDIA-SEQUENCE:")) { sequence = Number(line.split(":")[1]); continue; }
    if (line.startsWith("#EXT-X-DISCONTINUITY-SEQUENCE:")) { discontinuity = Number(line.split(":")[1]); continue; }
    if (line === "#EXT-X-DISCONTINUITY") { discontinuity++; continue; }
    if (line === "#EXT-X-GAP") { gap = true; continue; }
    if (line.startsWith("#EXT-X-MAP:")) {
      const m = line.match(/URI="([^"]+)"/);
      if (m) init.uri = resolve(m[1]!);
      continue;
    }
    if (line.startsWith("#EXTINF:")) {
      const m = line.match(/^#EXTINF:([0-9.]+)/);
      pendingDur = m ? parseFloat(m[1]!) : null;
      continue;
    }
    if (line.startsWith("#EXT-X-PART:")) {
      const m = line.match(/URI="([^"]+)"/);
      const d = line.match(/DURATION=([0-9.]+)/);
      if (m) items.push({ uri: resolve(m[1]!), kind: "part", duration: d ? parseFloat(d[1]!) : 0, sequence, discontinuity, gap: /GAP=YES/.test(line), initUri: init.uri });
      continue;
    }
    if (line.startsWith("#EXT-X-STREAM-INF:")) {
      // master 变体：下一条非 # 行是 media 播放列表 URI；BANDWIDTH/RESOLUTION 打分选最优
      const bw = /BANDWIDTH=(\d+)/.exec(line);
      const res = /RESOLUTION=(\d+)x(\d+)/.exec(line);
      const height = res ? parseInt(res[2]!, 10) : 0;
      const bandwidth = bw ? parseInt(bw[1]!, 10) : 0;
      for (let j = i + 1; j < lines.length; j++) {
        const u = lines[j]!.trim();
        if (!u || u.startsWith("#")) break;
        // 打分：优先分辨率，其次码率；取最高
        const score = height * 1_000_000 + bandwidth;
        if (!bestVariant || score > bestVariant.score) bestVariant = { uri: resolve(u), score };
        i = j;
        break;
      }
      continue;
    }
    if (!line.startsWith("#") && /^[^#]/.test(line) && pendingDur !== null) {
      items.push({ uri: resolve(line), kind: "segment", duration: pendingDur, sequence: sequence++, discontinuity, gap, initUri: init.uri });
      gap = false;
      pendingDur = null;
    }
  }
  return { init, items, variantUri: bestVariant?.uri ?? null };
}

// ---- HLS 鉴权：媒体端用 Bearer secret 替代防盗链 session（前端直连无后端，secret 只能前端直写，
//   安全弱、与匿名可读相当——当前架构折中）。所有 HLS 请求带此头。----
const HLS_AUTH = { Authorization: "Bearer b4rxLkECNUIcV6eiiHPnA9NeoubyvojY" };

/** 统一 HLS fetch：带鉴权头 + 不缓存（m3u8 / 分片共用）。 */
export async function hlsFetch(url: string, signal?: AbortSignal): Promise<Response> {
  return fetch(url, { cache: "no-store", headers: HLS_AUTH, signal });
}

export async function fetchBytes(url: string, signal?: AbortSignal): Promise<Uint8Array> {
  const r = await hlsFetch(url, signal);
  if (!r.ok) {
    const e = new Error(`HLS HTTP ${r.status}`) as Error & { status?: number };
    e.status = r.status;
    throw e;
  }
  return new Uint8Array(await r.arrayBuffer());
}

/**
 * 把"拿到了 m3u8 却没解析出分片"的原因分类，用于 UI 精准提示（不再笼统"等待内容"）。
 * 有分片 → null（正常）。
 */
export function categorizeEmptyPlaylist(text: string, items: HlsSegmentItem[]): string | null {
  const t = text.trimStart();
  if (!t.startsWith("#EXTM3U")) return "m3u8 无 #EXTM3U——不是 HLS 播放列表（200 但内容异常）";
  if (/#EXT-X-STREAM-INF/i.test(text)) return "m3u8 是 master 播放列表（含变体），需先选一条 media 列表";
  if (items.length === 0) return "m3u8 无分片——该路径当前没有推流/列表空闲";
  return null;
}

export interface HarvesterOptions {
  pollIntervalMs: number;
  /** Reserved for compatibility. Complete segments are the only delivery path. */
  followParts: boolean;
  onError?: (err: unknown) => void;
}

export interface SegmentDelivery { discontinuity: boolean; sequence: number }

/** One serial download lane. A retry blocks later media until success or explicit gap.
 * High-water sequence replaces an unbounded URI set; discarded old segments never re-enter.
 */
export class HlsHarvester {
  private timer: ReturnType<typeof setInterval> | null = null;
  private controller = new AbortController();
  private polling = false;
  private stopped = false;
  private mediaUrl: string | null = null;
  private initUri: string | null = null;
  private lastSequence: number | null = null;
  private lastDiscontinuity: number | null = null;
  private broken = false;
  private retry: { sequence: number; tries: number; at: number } | null = null;
  private gaveUp = 0;
  private authFail = 0;

  constructor(
    private url: string,
    private onContent: (buf: Uint8Array, kind: "init" | "part" | "segment", meta?: SegmentDelivery) => void,
    private opts: HarvesterOptions,
  ) {}

  stats(): HarvesterStats {
    return { retries: this.retry ? 1 : 0, gaveUp: this.gaveUp, authFail: this.authFail };
  }
  start(): void {
    if (this.timer || this.stopped) return;
    this.timer = setInterval(() => void this.poll(), this.opts.pollIntervalMs);
    void this.poll();
  }
  stop(): void {
    this.stopped = true;
    this.controller.abort();
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
  private async playlist(url: string): Promise<string> {
    const r = await hlsFetch(url, this.controller.signal);
    if (!r.ok) throw new Error(`HLS playlist HTTP ${r.status}`);
    const text = await r.text();
    if (!text.trimStart().startsWith("#EXTM3U")) throw new Error("Invalid HLS playlist");
    return text;
  }
  private async poll(): Promise<void> {
    if (this.stopped || this.polling) return;
    this.polling = true;
    try {
      const root = this.mediaUrl ?? this.url;
      let pl = parseM3u8(await this.playlist(root), root);
      if (this.stopped) return;
      if (pl.variantUri) {
        this.mediaUrl = pl.variantUri;
        pl = parseM3u8(await this.playlist(this.mediaUrl), this.mediaUrl);
      }
      let segments = pl.items.filter((it) => it.kind === "segment");
      // A new init URL identifies a restarted muxer even when its media sequence resets.
      const first = segments[0];
      if (first && this.initUri && first.initUri && this.key(first.initUri) !== this.initUri &&
          segments.every((it) => it.sequence <= (this.lastSequence ?? -1))) {
        this.lastSequence = null;
        this.retry = null;
        this.broken = true;
      }
      // Cold join needs the target GOP plus safety, not the entire server retention window.
      if (this.lastSequence == null) {
        let seconds = 0, start = segments.length;
        while (start > 0 && seconds < 60) seconds += segments[--start]!.duration;
        segments = segments.slice(start);
      }
      for (const it of segments) {
        if (this.stopped) return;
        if (this.lastSequence != null && it.sequence <= this.lastSequence) continue;
        if (this.lastSequence != null && it.sequence !== this.lastSequence + 1) this.broken = true;
        if (this.retry && this.retry.sequence !== it.sequence) {
          this.gaveUp++;
          this.retry = null; // retry slid out of the live window
          this.broken = true;
        }
        if (it.gap) { this.lastSequence = it.sequence; this.broken = true; continue; }
        if (this.retry && Date.now() - this.retry.at < 1500) return;
        try {
          const map = it.initUri ? this.key(it.initUri) : null;
          if (it.initUri && map !== this.initUri) {
            const bytes = await fetchBytes(it.initUri, this.controller.signal);
            if (this.stopped) return;
            this.onContent(bytes, "init");
            if (this.initUri) this.broken = true;
            this.initUri = map; // only after successful delivery
          }
          const bytes = await fetchBytes(it.uri, this.controller.signal);
          if (this.stopped) return;
          const discontinuity = this.broken || (this.lastDiscontinuity != null && this.lastDiscontinuity !== it.discontinuity);
          this.onContent(bytes, "segment", { sequence: it.sequence, discontinuity });
          this.lastSequence = it.sequence;
          this.lastDiscontinuity = it.discontinuity;
          this.broken = false;
          this.retry = null;
        } catch (e) {
          if (this.stopped) return;
          const status = (e as { status?: number }).status;
          const tries = (this.retry?.tries ?? 0) + 1;
          if (status === 401 || status === 403 || tries >= 3) {
            this.authFail += status === 401 || status === 403 ? 1 : 0;
            this.gaveUp++;
            this.lastSequence = it.sequence;
            this.broken = true;
            this.retry = null;
            logSeg("seg-giveup", `segment ${it.sequence}: abandoned (${status ?? "network/parse"})`);
          } else {
            this.retry = { sequence: it.sequence, tries, at: Date.now() };
            logSeg("seg-retry", `segment ${it.sequence}: retry ${tries}/3`);
            return; // never append a recovered older segment behind newer media
          }
        }
      }
    } catch (e) {
      if (!this.stopped) this.opts.onError?.(e);
    } finally {
      this.polling = false;
    }
  }
  private key(uri: string): string { return uri.split("?")[0]!; }
}
