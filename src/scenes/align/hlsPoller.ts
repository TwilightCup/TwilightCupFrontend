/**
 * HLS 增量拉取：轮询 m3u8，解析 init + parts/segments，对新增内容逐个 fetch。
 * 兼容 LL-HLS（#EXT-X-PART / #EXT-X-PRELOAD-HINT 由播放器决定是否追）与经典 segments，
 * 含 #EXT-X-MAP init 段。fetch 可用在主线程也可在 Web Worker 内。
 */
import type { HlsPlaylist, HlsSegmentItem } from "./types";

/** 解析 m3u8 文本 → init + items + master 变体选择（镜像冒烟工具 parseM3u8，扩展 master） */
export function parseM3u8(text: string, base: string): HlsPlaylist {
  const init: { uri: string | null } = { uri: null };
  const items: HlsSegmentItem[] = [];
  const lines = text.split(/\r?\n/);
  let pendingDur: number | null = null;
  let bestVariant: { uri: string; score: number } | null = null;
  const resolve = (u: string) => new URL(u, base).href;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (!line || line.startsWith("#EXT-X-VERSION")) continue;
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
      if (m) items.push({ uri: resolve(m[1]!), kind: "part", duration: d ? parseFloat(d[1]!) : 0 });
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
      items.push({ uri: resolve(line), kind: "segment", duration: pendingDur });
      pendingDur = null;
    }
  }
  return { init, items, variantUri: bestVariant?.uri ?? null };
}

export async function fetchBytes(url: string): Promise<Uint8Array> {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(`fetch ${url} -> ${r.status}`);
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
  /** m3u8 轮询周期（ms） */
  pollIntervalMs: number;
  /** 预取未完成 part（LL-HLS EXT-X-PRELOAD-HINT 语义：part 已列即取，不追 hint） */
  followParts: boolean;
  onError?: (err: unknown) => void;
}

/** 增量收段：维护已见 URI，把新 init/part/segment 字节交给回调。 */
export class HlsHarvester {
  private opts: HarvesterOptions;
  private seen = new Set<string>();
  private initFetched = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private stopped = false;
  /** 最近一次空列表诊断（去重：同一原因只报一次，恢复有分片即重置） */
  private lastEmptyDiag: string | null = null;
  /** master 解析后锁定的 media 播放列表 URI（null = 尚未解析） */
  private mediaUrl: string | null = null;

  constructor(
    private url: string,
    private onContent: (buf: Uint8Array, kind: "init" | "part" | "segment") => void,
    opts: HarvesterOptions,
  ) {
    this.opts = opts;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.poll(), this.opts.pollIntervalMs);
    void this.poll();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async poll(): Promise<void> {
    if (this.stopped) return;
    try {
      // 首次：拉 master，若有变体锁最优 media（之后直接轮询 media，避免重复探测 master）
      if (!this.mediaUrl) {
        const masterText = await (await fetch(this.url, { cache: "no-store" })).text();
        const master = parseM3u8(masterText, this.url);
        this.mediaUrl = master.variantUri ?? this.url;
      }
      const url = this.mediaUrl;
      const text = await (await fetch(url, { cache: "no-store" })).text();
      const pl = parseM3u8(text, url);
      // 空列表诊断：把"拿到但没分片"的真实原因上报一次（master / 非HLS / 空闲）
      if (pl.items.length === 0) {
        const diag = categorizeEmptyPlaylist(text, pl.items);
        if (diag && diag !== this.lastEmptyDiag) {
          this.lastEmptyDiag = diag;
          this.opts.onError?.(new Error(diag));
        }
      } else {
        this.lastEmptyDiag = null;
      }
      // init：只取一次，用于 codec/description
      if (pl.init.uri && !this.initFetched) {
        this.initFetched = true;
        this.onContent(await fetchBytes(pl.init.uri!), "init");
      }
      for (const it of pl.items) {
        // 去重按"去掉 query"的基地址：盗链 HLS 每次轮询 session 参数会变，
        // 同一段若按完整 URL 判重会被当新段重抓、媒体被处理两遍 → 帧率/帧数翻倍
        const key = it.uri.split("?")[0];
        if (this.seen.has(key)) continue;
        if (it.kind === "part" && !this.opts.followParts) continue;
        this.seen.add(key);
        try {
          this.onContent(await fetchBytes(it.uri), it.kind);
        } catch {
          // 单个分片 404/过期（live 轮动，靠前的旧段服务端已删）属正常，不记为流错误
        }
      }
    } catch (e) {
      this.opts.onError?.(e);
    }
  }
}