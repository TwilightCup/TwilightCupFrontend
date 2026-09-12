/**
 * HLS 增量拉取：轮询 m3u8，解析 init + parts/segments，对新增内容逐个 fetch。
 * 兼容 LL-HLS（#EXT-X-PART / #EXT-X-PRELOAD-HINT 由播放器决定是否追）与经典 segments，
 * 含 #EXT-X-MAP init 段。fetch 可用在主线程也可在 Web Worker 内。
 */
import type { HlsPlaylist, HlsSegmentItem } from "./types";

/** 解析 m3u8 文本 → init + items（镜像冒烟工具 parseM3u8）。 */
export function parseM3u8(text: string, base: string): HlsPlaylist {
  const init: { uri: string | null } = { uri: null };
  const items: HlsSegmentItem[] = [];
  const lines = text.split(/\r?\n/);
  let pendingDur: number | null = null;
  const resolve = (u: string) => new URL(u, base).href;
  for (const raw of lines) {
    const line = raw.trim();
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
    if (!line.startsWith("#") && /^[^#]/.test(line) && pendingDur !== null) {
      items.push({ uri: resolve(line), kind: "segment", duration: pendingDur });
      pendingDur = null;
    }
  }
  return { init, items };
}

export async function fetchBytes(url: string): Promise<Uint8Array> {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(`fetch ${url} -> ${r.status}`);
  return new Uint8Array(await r.arrayBuffer());
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
      const url = this.url;
      const text = await (await fetch(url, { cache: "no-store" })).text();
      const pl = parseM3u8(text, url);
      // init：只取一次，用于 codec/description
      if (pl.init.uri && !this.initFetched) {
        this.initFetched = true;
        this.onContent(await fetchBytes(pl.init.uri!), "init");
      }
      for (const it of pl.items) {
        if (this.seen.has(it.uri)) continue;
        if (it.kind === "part" && !this.opts.followParts) continue;
        this.seen.add(it.uri);
        this.onContent(await fetchBytes(it.uri), it.kind);
      }
    } catch (e) {
      this.opts.onError?.(e);
    }
  }
}