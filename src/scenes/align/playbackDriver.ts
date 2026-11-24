/** rAF is a paint opportunity, not a reliable authority clock. A dedicated worker
 * wakes hidden/occluded documents; suspended processes still need server failover.
 * No remote timestamp enters the playback clock: sample performance.now on receipt. */
interface DriverPorts {
  now(): number;
  hidden(): boolean;
  frame(cb: () => void): number;
  cancelFrame(id: number): void;
  interval(cb: () => void): ReturnType<typeof setInterval>;
  clearInterval(id: ReturnType<typeof setInterval>): void;
  worker(cb: () => void): (() => void) | null;
}
function workerPulse(cb: () => void): (() => void) | null {
  if (typeof Worker === "undefined") return null;
  let url: string | null = null;
  try {
    url = URL.createObjectURL(new Blob(["setInterval(() => postMessage(0), 25);"], { type: "text/javascript" }));
    const worker = new Worker(url);
    worker.onmessage = cb;
    worker.onerror = () => console.warn("[align] 后台 Worker 不可用；定时器兜底可能受浏览器节流");
    return () => { worker.terminate(); URL.revokeObjectURL(url!); };
  } catch {
    if (url) URL.revokeObjectURL(url);
    console.warn("[align] 无法启动后台 Worker；定时器兜底可能受浏览器节流");
    return null;
  }
}
export class PlaybackDriver {
  private generation = 0;
  private running = false;
  private frame = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private stopWorker: (() => void) | null = null;
  constructor(private ports: DriverPorts = {
    now: () => performance.now(), hidden: () => document.hidden,
    frame: cb => requestAnimationFrame(cb), cancelFrame: id => cancelAnimationFrame(id),
    interval: cb => setInterval(cb, 100), clearInterval: id => clearInterval(id), worker: workerPulse,
  }) {}
  start(tick: (now: number) => void): void {
    if (this.running) return;
    this.running = true;
    const generation = ++this.generation;
    let last = -Infinity;
    const current = () => this.running && generation === this.generation;
    const run = (paint: boolean) => {
      if (!current()) return;
      const now = this.ports.now();
      // Avoid double stepping when a worker message and rAF share a task boundary.
      if (now - last < 8 || (!paint && !this.ports.hidden() && now - last < 80)) return;
      last = now; tick(now);
    };
    const paint = () => {
      if (!current()) return;
      run(true);
      this.frame = this.ports.frame(paint);
    };
    this.frame = this.ports.frame(paint);
    this.stopWorker = this.ports.worker(() => run(false));
    this.timer = this.ports.interval(() => run(false));
  }
  stop(): void {
    this.running = false; this.generation++;
    this.ports.cancelFrame(this.frame);
    if (this.timer != null) this.ports.clearInterval(this.timer);
    this.timer = null; this.stopWorker?.(); this.stopWorker = null;
  }
}
