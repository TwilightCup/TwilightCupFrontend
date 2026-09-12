/**
 * 已解码帧队列（按 realtime_us 升序）——每侧一条。只保留环绕 T 的小窗口，防止
 * GPU 显存被 10 分钟解码帧撑爆（10 分钟"缓冲"在 HLS 原始下载层，见 frameLock.ts）。
 * T 单调前向 → nearest 选取天然稳定、不回放。
 */
import type { AlignedFrame } from "./types";

export interface FrameEntry {
  rtUs: number;
  isKey: boolean;
  handle: unknown; // VideoFrame 或其它不透明句柄
}

/**
 * 有序 FR 集。ops：无副作用版本可选；默认非纯（内含 close 回调调用）。
 * 为可单测性，close 由调用方注入：add 时若淘汰旧帧会立即调用 drop(f)。
 */
export class FrameQueue {
  private entries: FrameEntry[] = []; // rtUs 升序
  private dropped = 0;

  constructor(
    private drop: (e: FrameEntry) => void = () => undefined,
    /** 环绕 T 保留的半窗宽（µs）：小于该窗外且已被越过的一律淘汰 */
    private keepBehindUs = 3_000_000,
    private keepAheadUs = 5_000_000,
  ) {}

  get length(): number {
    return this.entries.length;
  }

  add(e: FrameEntry): void {
    // 二分插入（rtUs 升序；同 rt 去重）
    let lo = 0, hi = this.entries.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.entries[mid]!.rtUs < e.rtUs) lo = mid + 1;
      else hi = mid;
    }
    if (this.entries[lo] && this.entries[lo]!.rtUs === e.rtUs) return; // 去重
    this.entries.splice(lo, 0, e);
  }

  /** 最末 rtUs（前沿）；空为 null */
  frontier(): number | null {
    const n = this.entries.length;
    return n ? this.entries[n - 1]!.rtUs : null;
  }

  /** 取 rtUs 最接近 target 的帧（T 单调则结果稳定）；空为 null */
  nearest(targetUs: number): FrameEntry | null {
    let lo = 0, hi = this.entries.length - 1, best: FrameEntry | null = null, bestD = Infinity;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const e = this.entries[mid]!;
      const d = Math.abs(e.rtUs - targetUs);
      if (d < bestD) { bestD = d; best = e; }
      if (e.rtUs < targetUs) lo = mid + 1;
      else hi = mid - 1;
    }
    return best;
  }

  /**
   * 推进 T：淘汰 rtUs 远落后于 T（T − keepBehind）且已越过该位置的旧帧，
   * 并清掉远超前于 T（T + keepAhead，异常到达）的帧。返回被 close 淘汰数。
   */
  advance(targetUs: number): number {
    const minUs = targetUs - this.keepBehindUs;
    const maxUs = targetUs + this.keepAheadUs;
    let removed = 0;
    while (this.entries.length && this.entries[0]!.rtUs < minUs) {
      this.drop(this.entries[0]!);
      this.entries.shift();
      removed++;
      this.dropped++;
    }
    while (this.entries.length && this.entries[this.entries.length - 1]!.rtUs > maxUs) {
      this.drop(this.entries.pop()!);
      removed++;
      this.dropped++;
    }
    return removed;
  }

  clear(): void {
    for (const e of this.entries) this.drop(e);
    this.entries = [];
  }

  /** 调试统计 */
  stats(): { len: number; dropped: number; frontUs: number | null; backUs: number | null } {
    return {
      len: this.entries.length,
      dropped: this.dropped,
      frontUs: this.frontier(),
      backUs: this.entries.length ? this.entries[0]!.rtUs : null,
    };
  }
}

export type { AlignedFrame };