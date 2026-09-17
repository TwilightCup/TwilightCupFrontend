/** Per-document renderer. The server elects one publisher; other documents follow
 * its relayed anchors. Only canvases inside this document share decoded frames. */
import { reactive, ref, type Ref } from "vue";
import type { LeaseSample } from "./frameLeaseClient";
import { PlaybackDriver } from "./playbackDriver";
import { SignalRecovery, SIGNAL } from "./signalPolicy";
import { ExternalClock, type FrameAlignAnchor } from "./externalClock";
import { commonFrames } from "./frameQueue";
import { CATCHUP, planCatchup, recoveryGate, publisherTarget, type CatchupMode } from "./rateControl";
import { FrameLockStream } from "./frameLock";
import { createFrameSource } from "./transport";
import { logAuth } from "./debugLog";
import { emptyHealth, type StreamHealth } from "./types";

export type Side = "A" | "B";

/** 拉流失败 → 可读文案（fetch 对 ERR_CONNECTION_REFUSED 等一律抛 TypeError "Failed to fetch"，
 * 据此给通用"连不上服务器"，命中具体信号再细分） */
export function friendlyStreamError(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  if (/CORS|is not allowed|Access control|No 'Access-Control-Allow-Origin'/i.test(m)) {
    return "跨域被拦（CORS）：检查流服务器 hlsAllowOrigins";
  }
  if (/404|Not Found/i.test(m)) return "流地址不存在（404）";
  if (/abort/i.test(m)) return "拉流被中断";
  if (/Failed to fetch|NetworkError|ECONN|connection/i.test(m)) {
    return "无法连接到流服务器（地址写错 / 服务未启动 / 连接被拒）";
  }
  return `拉流失败：${m}`;
}

export class AlignEngine {
  private streams = new Map<Side, FrameLockStream>();
  private paintedCanvases = reactive(new Set<HTMLCanvasElement>());
  hasCanvasImage(canvas: HTMLCanvasElement | null): boolean {
    return canvas != null && this.paintedCanvases.has(canvas);
  }
  private canvases = new Map<Side, HTMLCanvasElement[]>();
  private catchupMode: CatchupMode = "normal";
  private pendingSeek: number | null = null;
  private waitingT: number | null = null;
  private stableMs = 0;
  private missingMs = 0;
  private takeoverSeek = false;
  private candidateProbe: { target: number; sides: string; at: number } | null = null;
  private lastSeekAt = -Infinity;
  private signalPolicy = new SignalRecovery();
  private signalProgress = new Map<Side, { frontier: number | null; at: number }>();
  private warming = new Map<Side, { at: number; stable: number | null }>();
  private remoteSides: Side[] | null = null;
  private remoteWaiting: Side[] = [];
  private driver = new PlaybackDriver();
  private clockPulse: (() => void) | null = null;
  setClockPulse(pulse: (() => void) | null): void { this.clockPulse = pulse; }
  private last = 0;
  private running = false;
  private healthTimer: ReturnType<typeof setInterval> | null = null;

  private external = new ExternalClock();
  private publisher = false;
  private authorityFloor: number | null = null;
  private requiredSides = new Set<Side>();
  private sourceUrls = new Map<Side, string>();
  private streamGenerations = new Map<Side, number>();
  readonly enabled = ref(false);
  readonly sync = reactive({ state: "waiting" as "waiting" | "playing" | "frozen" | "stale",
    role: "follower" as "publisher" | "follower",
    catchup: "wait" as CatchupMode, authorityUs: null as number | null,
    activeSides: [] as Side[], waitingSides: [] as Side[],
    candidate: "off" as "off" | "warming" | "ready",
    reason: "startup", seekCount: 0, lastSeekReason: "", lastJumpUs: 0,
    targetUs: null as number | null, pairErrorUs: null as number | null,
    presentedRt: { A: null, B: null } as Record<Side, number | null>,
    targetErrorUs: { A: null, B: null } as Record<Side, number | null> });

  /** 虚拟对齐时间戳 T（epoch 微秒）；未就绪 null */
  readonly tUs: Ref<number | null> = ref(null);
  /** 各侧解码能力（响应式，供 UI 切 SeiStream/回退 MSE） */
  readonly modes = reactive<Record<Side, "aligned" | "off">>({ A: "off", B: "off" });
  /** 各侧最近拉流错误（可读文案；有内容后清空）。供导播界面直接提示，不必翻 console */
  readonly streamError = reactive<Record<Side, string | null>>({ A: null, B: null });
  /** 各侧连通性/健康指标（对齐 SEIInjector 冒烟工具；~2.5Hz 刷新） */
  readonly health = reactive<Record<Side, StreamHealth>>({ A: emptyHealth(), B: emptyHealth() });
  /** 各侧是否已真正上屏过一帧（攒够缓冲的判据；供 A/B 画面提示"攒缓冲中/已就绪"） */
  readonly presented = reactive<Record<Side, boolean>>({ A: false, B: false });
  /** 全局播放诊断：当前 T 播放倍速（×>1 → 在追/快进）与 T 落后最慢前沿的秒数（追 Xs） */
  readonly playback = reactive({ speed: 1, behindS: 0 });
  /** 主循环（rAF）是否正常推进——死循环 = 画面卡住、队列不清理（追在涨但画面停） */
  readonly loopAlive = ref(true);
  readonly loopErr = ref<string | null>(null);
  private lastTickTime = performance.now();

  get ready(): boolean {
    return this.tUs.value != null;
  }

  /** Called only after validating the backend connection-specific role assignment. */
  setPublisher(selected: boolean): void {
    if (this.publisher !== selected) {
      this.pendingSeek = null; this.waitingT = null; this.stableMs = 0; this.catchupMode = "normal";
      this.signalPolicy.reset(selected ? this.remoteWaiting : []); this.warming.clear();
      if (selected && this.candidateProbe != null) {
        // Private preparation may have moved the decoder beyond the public T.
        // Rebuild immediately on takeover, not after the ordinary missing-frame timeout.
        this.takeoverSeek = true; this.lastSeekAt = -Infinity;
        this.candidateProbe = null;
      }
    }
    if (!selected) this.takeoverSeek = false;
    this.publisher = selected;
    this.sync.role = selected ? "publisher" : "follower";
  }
  resetClockConnection(): void {
    this.takeoverSeek = false;
    this.publisher = false; this.sync.role = "follower";
    this.external = new ExternalClock();
    this.candidateProbe = null; this.sync.candidate = "off";
    this.remoteSides = null; this.remoteWaiting = [];
    this.authorityFloor = this.tUs.value;
    this.pendingSeek = null; this.waitingT = null; this.stableMs = 0;
    this.sync.authorityUs = null;
    this.sync.state = "waiting";
    this.presented.A = this.presented.B = false;
    this.playback.speed = 0;
  }

  setExternalTUs(us: number | null, meta: Partial<FrameAlignAnchor> = {}): boolean {
    if (us == null) return false;
    const validSides = (v: unknown): v is Side[] => Array.isArray(v) &&
      v.length <= 2 && v.every(s => s === "A" || s === "B") && new Set(v).size === v.length;
    if ((meta.active_sides != null && !validSides(meta.active_sides)) ||
        (meta.waiting_sides != null && !validSides(meta.waiting_sides)) ||
        meta.waiting_sides?.some(s => meta.active_sides?.includes(s))) return false;
    const revision = this.external.revision;
    const accepted = this.external.accept({ ...meta, t_us: us }, performance.now());
    if (accepted) {
      if (this.candidateProbe != null && this.external.hasFreshAuthority(performance.now())) {
        this.candidateProbe = null; this.sync.candidate = "off";
        this.pendingSeek = null; this.waitingT = null;
        this.takeoverSeek = true; this.lastSeekAt = -Infinity;
      }
      this.authorityFloor = Math.max(this.authorityFloor ?? us, us);
      this.remoteSides = meta.active_sides == null ? null : [...meta.active_sides];
      this.remoteWaiting = [...(meta.waiting_sides ?? [])];
    }
    if (accepted && revision !== this.external.revision) {
      this.pendingSeek = null; this.waitingT = null; this.stableMs = 0;
      this.missingMs = CATCHUP.stallSeekMs; this.catchupMode = "normal";
    }
    return accepted;
  }
  selectAuthority(src: string | null, epoch?: number): void {
    this.external.selectSource(src, epoch);
    if (src == null) {
      this.setPublisher(false); this.sync.state = "waiting"; this.sync.authorityUs = null;
      this.playback.speed = 0; this.presented.A = this.presented.B = false;
    }
  }
  setAuthorityFloor(floor: number | null): void {
    if (floor != null) this.authorityFloor = Math.max(this.authorityFloor ?? 0, floor);
  }
  /** Private cold-start probe: decode a shared safe point without publishing or
   * advancing presentation T. Once elected, normal common presentation owns T. */
  leaseSample(now: number): LeaseSample {
    const required = [...this.requiredSides];
    const capability = this.enabled.value && required.some(s => this.streams.has(s));
    let active = this.sync.activeSides.filter(s => required.includes(s));
    let media = false, decoded = false;
    const progress = Math.floor(this.tUs.value ?? 0);
    // First presentation may be pending even with a valid authority. Never let
    // lease sampling seek the same decoder away from normal follower startup.
    const preparing = !this.publisher && !this.external.hasFreshAuthority(now);
    if (preparing) {
      active = required.filter(s => {
        const c = this.streams.get(s)?.coverage();
        return c != null && c.to - c.from >= CATCHUP.backUs + 5_000_000;
      });
      const streams = active.map(s => this.streams.get(s)!);
      const covers = streams.map(s => s.coverage()!);
      const from = Math.max(...covers.map(c => c.from), this.authorityFloor ?? 0);
      const to = Math.min(...covers.map(c => c.to)) - CATCHUP.backUs;
      const probe = this.candidateProbe;
      let target = probe?.target ?? to - 5_000_000;
      if (target < from || target > to || probe?.sides !== active.join()) target = Math.max(from, to - 5_000_000);
      media = streams.length > 0 && target >= from && target <= to && streams.every(s => s.canSeek(target));
      if (media) {
        if (!probe || probe.target !== target || probe.sides !== active.join() || (now - probe.at >= SIGNAL.retryMs && !commonFrames(streams.map(s => s.queue), target, CATCHUP.maxFrameErrorUs))) {
          for (const s of streams) s.seek(target);
          this.candidateProbe = { target, sides: active.join(), at: now };
        }
        for (const s of streams) s.advance(target);
        decoded = commonFrames(streams.map(s => s.queue), target, CATCHUP.maxFrameErrorUs) != null;
      }
    } else if (this.tUs.value != null && active.length) {
      this.candidateProbe = null;
      const target = this.tUs.value;
      media = active.every(side => {
        const c = this.streams.get(side)?.coverage();
        return c != null && target >= c.from && target <= c.to - CATCHUP.backUs;
      });
      decoded = media && commonFrames(active.map(s => this.streams.get(s)!.queue), target,
        CATCHUP.maxFrameErrorUs) != null;
    }
    this.sync.candidate = preparing && capability ? decoded ? "ready" : "warming" : "off";
    const waiting = (["A", "B"] as Side[]).filter(s => !active.includes(s));
    const holdingSignal = !preparing && this.tUs.value != null && this.sync.reason === "signal_wait";
    return { capability, media_ready: media, decode_ready: decoded, progress_t_us: progress,
      active_sides: active, waiting_sides: waiting,
      state: media && decoded && !holdingSignal ? "running" : "media_wait" };
  }
  setRequiredSides(sides: Side[]): void {
    this.requiredSides = new Set(sides);
    this.enabled.value = sides.length > 0;
  }

  /* ---- 流管理（每侧唯一流，引用计数：舞台/控制台共同引用，计数归零才停） ---- */
  private refs = new Map<Side, Set<symbol>>();
  startStream(side: Side, url: string, kind: "hls" | "annexb" = "hls"): () => void {
    if (this.sourceUrls.get(side) !== url && this.streams.has(side)) {
      this.streams.get(side)!.stop();
      this.streams.delete(side);
      this.pendingSeek = null; this.waitingT = null; this.catchupMode = "normal";
    }
    this.enabled.value = true;
    if (!this.streams.has(side)) {
      const generation = (this.streamGenerations.get(side) ?? 0) + 1;
      this.streamGenerations.set(side, generation);
      this.sourceUrls.set(side, url);
      const source = createFrameSource(kind, { url });
      const s = new FrameLockStream(source, {
        onError: (e) => {
          if (this.streamGenerations.get(side) !== generation) return;
          console.warn(`[align ${side}]`, e);
          // 仅"尚无内容"时的拉流失败值得提示"拉不到"；已有内容后的偶发报错不盖画面
          if (!s.hasContent) this.streamError[side] = friendlyStreamError(e);
        },
        onModeChange: (m) => {
          if (this.streamGenerations.get(side) !== generation) return;
          this.modes[side] = m;
          if (this.streamError[side]) this.streamError[side] = null;
        },
      });
      this.signalProgress.delete(side); this.warming.delete(side); this.candidateProbe = null;
      this.streams.set(side, s);
      this.modes[side] = s.mode;
      this.resetPresented(side);
      s.start();
    }
    const token = Symbol(side);
    const refs = this.refs.get(side) ?? new Set<symbol>();
    refs.add(token);
    this.refs.set(side, refs);
    return () => this.stopStream(side, token);
  }
  private stopStream(side: Side, token: symbol): void {
    const refs = this.refs.get(side);
    if (!refs?.delete(token)) return; // old session/component cannot release a new lease
    if (refs.size === 0) {
      this.refs.delete(side);
      this.streams.get(side)?.stop();
      this.streams.delete(side);
      this.sourceUrls.delete(side);
      this.streamGenerations.set(side, (this.streamGenerations.get(side) ?? 0) + 1);
      this.modes[side] = "off";
      this.presented[side] = false;
      this.sync.presentedRt[side] = null;
    }
  }
  restartStream(side: Side): void {
    const url = this.sourceUrls.get(side);
    if (!url) return;
    this.streams.get(side)?.stop();
    this.streams.delete(side);
    this.pendingSeek = null; this.waitingT = null; this.catchupMode = "normal"; // explicit operator recovery, not automatic timeline jump
    const release = this.startStream(side, url);
    release();
  }
  resetSession(): void {
    for (const stream of this.streams.values()) stream.stop();
    this.streams.clear(); this.refs.clear(); this.sourceUrls.clear();
    this.paintedCanvases.clear(); this.candidateProbe = null; this.sync.candidate = "off";
    this.takeoverSeek = false;
    this.publisher = false; this.sync.role = "follower"; this.authorityFloor = null;
    this.external = new ExternalClock(); this.pendingSeek = null; this.waitingT = null; this.catchupMode = "normal";
    this.tUs.value = null; this.sync.state = "waiting";
    this.sync.reason = "startup"; this.sync.seekCount = 0;
    this.sync.lastSeekReason = ""; this.sync.lastJumpUs = 0;
    this.stableMs = this.missingMs = 0;
    this.lastSeekAt = -Infinity; this.signalPolicy.reset(); this.signalProgress.clear(); this.warming.clear();
    this.remoteSides = null; this.remoteWaiting = [];
    this.sync.activeSides = []; this.sync.waitingSides = [];
    this.sync.authorityUs = this.sync.targetUs = null; this.sync.catchup = "wait";
    this.modes.A = this.modes.B = "off";
    this.presented.A = this.presented.B = false;
    this.sync.presentedRt.A = this.sync.presentedRt.B = null;
  }

  modeOf(side: Side): "aligned" | "off" {
    return this.streams.get(side)?.mode ?? "off";
  }
  /** 重挂流时还原"未上屏"状态（下轮攒够缓冲再提） */
  private resetPresented(side: Side): void {
    for (const canvas of this.canvases.get(side) ?? []) this.paintedCanvases.delete(canvas);
    this.presented[side] = false;
    this.sync.presentedRt[side] = null;
    this.sync.targetErrorUs[side] = null;
  }
  frontierOf(side: Side): number | null {
    return this.streams.get(side)?.frontier() ?? null;
  }
  /** 已注册展示 canvas 数（供监控统计） */
  registerCanvas(side: Side, canvas: HTMLCanvasElement): () => void {
    const arr = this.canvases.get(side) ?? [];
    arr.push(canvas);
    this.canvases.set(side, arr);
    return () => this.unregisterCanvas(side, canvas);
  }
  private unregisterCanvas(side: Side, canvas: HTMLCanvasElement): void {
    this.paintedCanvases.delete(canvas);
    const arr = this.canvases.get(side);
    if (!arr) return;
    const i = arr.indexOf(canvas);
    if (i >= 0) arr.splice(i, 1);
    if (arr.length === 0) this.canvases.delete(side);
  }
  /* ---- 主循环 ---- */
  private refreshHealth(): void {
    for (const side of ["A", "B"] as Side[]) {
      const s = this.streams.get(side);
      this.health[side] = s ? s.stats() : emptyHealth();
    }
    // 主循环存活看门狗：2s 无 tick → 判定循环卡死（画面会卡住但拉流/统计还在走）
    if (performance.now() - this.lastTickTime > 2000) {
      this.loopAlive.value = false;
    }
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    this.refreshHealth();
    this.healthTimer = setInterval(() => this.refreshHealth(), 400);
    this.driver.start((now: number) => {
      if (!this.running) return;
      // 主循环无论单帧是否抛错都继续（此前一旦某帧绘制异常就会掐断 rAF → 画面永久卡死）
      try {
        this.tickLoop(now);
        this.clockPulse?.(); // Same driver as T; no dependence on a throttled heartbeat timer.
      } catch (e) {
        console.error("[align loop]", e);
        this.loopErr.value = e instanceof Error ? e.message : String(e);
      }
      this.loopAlive.value = true;
      this.lastTickTime = now;
    });
  }

  /** Publisher-only loss detection: a stopped ingest frontier must also have
   * exhausted the safely playable buffer. Decoder stalls alone never remove a side. */
  private playbackSides(now: number, required: Side[]): { sides: Side[]; hold: boolean } {
    if (!this.publisher) {
      const active = this.remoteSides == null ? [...required] : required.filter(s => this.remoteSides!.includes(s));
      if (active.join() !== this.sync.activeSides.join()) {
        this.pendingSeek = null; this.waitingT = null; this.stableMs = 0;
        if (active.some(s => this.sync.waitingSides.includes(s))) {
          this.missingMs = CATCHUP.stallSeekMs; this.lastSeekAt = -Infinity;
        }
        for (const side of active) if (this.sync.waitingSides.includes(side)) this.resetPresented(side);
      }
      this.sync.activeSides = active;
      this.sync.waitingSides = required.filter(s => this.remoteWaiting.includes(s));
      return { sides: this.sync.activeSides, hold: false };
    }
    const lost: Side[] = [], recovered: Side[] = [];
    const allWaiting = required.every(s => this.sync.waitingSides.includes(s));
    const recoveryCoverage = required.map(s => this.streams.get(s)?.coverage()).filter(c => c != null);
    const recoveryTarget = allWaiting && recoveryCoverage.length
      ? Math.max(this.tUs.value ?? 0, Math.max(...recoveryCoverage.map(c => c.from)),
          Math.min(...recoveryCoverage.map(c => c.to)) - CATCHUP.backUs - 5_000_000)
      : this.tUs.value;
    for (const side of required) {
      const stream = this.streams.get(side), coverage = stream?.coverage();
      const frontier = stream?.frontier?.() ?? coverage?.to ?? null;
      let progress = this.signalProgress.get(side);
      if (!progress || (frontier != null && (progress.frontier == null || frontier > progress.frontier))) {
        progress = { frontier, at: now }; this.signalProgress.set(side, progress);
      }
      const exhausted = !coverage || this.tUs.value == null ||
        this.tUs.value + 1_400_000 >= coverage.to - CATCHUP.backUs;
      const missing = now - progress.at >= SIGNAL.staleMs && exhausted;
      if (missing) { lost.push(side); this.warming.delete(side); continue; }
      if (!this.sync.waitingSides.includes(side) || !stream || !coverage || recoveryTarget == null) continue;
      // Keep the healthy side running while the returning decoder is prepared.
      const target = recoveryTarget;
      if (target < coverage.from || target + 300_000 > coverage.to - CATCHUP.backUs || !stream.canSeek(target)) continue;
      let warm = this.warming.get(side);
      if (!warm || (warm.stable == null && now - warm.at >= SIGNAL.retryMs)) {
        stream.seek(target); warm = { at: now, stable: null }; this.warming.set(side, warm);
      }
      stream.advance(target);
      if (stream.queue.nearest(target, CATCHUP.maxFrameErrorUs)) {
        warm.stable ??= now;
        if (now - warm.stable >= SIGNAL.joinMs) recovered.push(side);
      } else warm.stable = null;
    }
    const decision = this.signalPolicy.update(now, required, lost, recovered);
    if (this.sync.activeSides.join() !== decision.active.join()) {
      this.pendingSeek = null; this.waitingT = null; this.stableMs = 0; this.missingMs = 0;
    }
    for (const side of decision.active) if (this.sync.waitingSides.includes(side)) this.resetPresented(side);
    this.sync.activeSides = decision.active; this.sync.waitingSides = decision.waiting;
    for (const side of recovered) this.warming.delete(side);
    return { sides: decision.active, hold: decision.hold };
  }

  private tickLoop(now: number): void {
    const elapsed = Math.max(0, Math.min(now - this.last, 100));
    this.last = now;
    const requiredSides = this.requiredSides.size ? [...this.requiredSides] : [...this.streams.keys()];
    const membership = this.playbackSides(now, requiredSides);
    const sides = membership.sides;
    for (const side of requiredSides) if (!sides.includes(side)) {
      this.presented[side] = false; this.sync.presentedRt[side] = null; this.sync.targetErrorUs[side] = null;
    }
    const streams = sides.map(side => this.streams.get(side));
    const coverage = streams.map(stream => stream?.coverage() ?? null);
    const freeze = (state: "waiting" | "frozen" | "stale", keepRecovery = false, reason = state as string) => {
      if (this.sync.reason !== reason) logAuth("freeze", `reason=${reason} T=${this.tUs.value} missingMs=${this.missingMs}`);
      this.sync.reason = reason;
      if (!keepRecovery) this.stableMs = 0;
      this.sync.state = state;
      this.playback.speed = 0;
      for (const side of sides) this.presented[side] = false;
    };
    if (membership.hold || !sides.length) { freeze("waiting", false, "signal_wait"); return; }
    if (coverage.some(c => !c)) { freeze("waiting", false, "coverage"); return; }
    const frontiers = coverage.map(c => c!.to);
    const slow = Math.min(...frontiers);
    const required = slow - CATCHUP.backUs;
    const earliest = Math.max(...coverage.map(c => c!.from));
    const localTarget = this.publisher ? publisherTarget(earliest, slow,
      Math.max(this.authorityFloor ?? 0, this.tUs.value ?? 0), this.tUs.value == null) : null;
    const external = this.publisher
      ? localTarget == null ? null : { t: localTarget, rate: 1, stale: false }
      : this.external.read(now);
    if (!external) { freeze("waiting", false, "authority_or_safe_target"); return; }
    this.sync.authorityUs = external.t;
    if (external.stale) { freeze("stale", false, "authority_stale"); return; }
    if (earliest > required) { freeze("waiting", false, "buffer_short"); return; }
    const plan = planCatchup({ current: this.tUs.value, authority: external.t,
      from: earliest, safeTo: required, elapsedMs: elapsed, rate: external.rate,
      supply: true, publisher: this.publisher, mode: this.catchupMode, recovering: (this.takeoverSeek || this.missingMs >= CATCHUP.stallSeekMs) && now - this.lastSeekAt >= SIGNAL.retryMs });
    if (this.pendingSeek != null && (this.pendingSeek < earliest || this.pendingSeek > required ||
        (this.missingMs >= CATCHUP.stallSeekMs && now - this.lastSeekAt >= SIGNAL.retryMs))) {
      this.pendingSeek = null; this.waitingT = null;
    }
    if (this.pendingSeek == null && plan.mode === "seek" && plan.t != null) {
      if (!streams.every(stream => stream!.canSeek(plan.t!))) { freeze("waiting", false, "no_keyframe"); return; }
      // Preflight both GOPs before invalidating either decoder. Commit T only after both decode.
      this.lastSeekAt = now;
      this.sync.seekCount++;
      this.sync.lastSeekReason = this.tUs.value == null ? "startup" : this.tUs.value < earliest
        ? "coverage_gap" : this.missingMs >= CATCHUP.stallSeekMs ? "decode_stall" : "clock_drift";
      this.sync.lastJumpUs = this.tUs.value == null ? 0 : plan.t - this.tUs.value;
      logAuth("seek", `reason=${this.sync.lastSeekReason} jumpUs=${this.sync.lastJumpUs} missingMs=${this.missingMs}`);
      for (const stream of streams) stream!.seek(plan.t);
      this.takeoverSeek = false;
      this.pendingSeek = plan.t;
      this.stableMs = 0;
      this.missingMs = 0;
    }
    if (this.waitingT != null && (this.waitingT < earliest || this.waitingT > required)) this.waitingT = null;
    const T = this.pendingSeek ?? this.waitingT ?? plan.t;
    this.sync.catchup = this.pendingSeek != null ? "seek" : plan.mode;
    this.sync.targetUs = T;
    if (T == null || (this.pendingSeek == null && plan.mode === "wait") || T > external.t ||
        T < earliest || T > required || (this.tUs.value != null && T < this.tUs.value)) {
      freeze("frozen"); return;
    }
    for (const stream of streams) stream!.advance(T);
    const frames = commonFrames(streams.map(s => s!.queue), T, CATCHUP.maxFrameErrorUs,
      sides.map(side => this.sync.presentedRt[side])) ?? [];
    const pairError = frames.length ? Math.max(...frames.map(f => f.rtUs)) - Math.min(...frames.map(f => f.rtUs)) : null;
    if (frames.length !== sides.length || (pairError ?? Infinity) > CATCHUP.maxFrameErrorUs) {
      this.waitingT ??= T;
      this.missingMs += elapsed; this.stableMs = 0; this.catchupMode = "normal";
      const missing = sides.filter((_, i) => !streams[i]!.queue.nearest(T, CATCHUP.maxFrameErrorUs));
      freeze("frozen", false, missing.length ? `missing_frame:${missing.join("+")}` : "pair_error"); return;
    }
    if (this.pendingSeek != null || this.missingMs > 0) {
      const gate = recoveryGate(this.stableMs, true, elapsed, this.pendingSeek == null ? this.missingMs : Infinity);
      this.stableMs = gate.stableMs;
      if (!gate.ready) { freeze("frozen", true, "recovery_hysteresis"); return; }
    }
    // Stage all draws before touching any visible canvas. A missing/closed frame cannot
    // advance one side alone. JS canvas commits run in the same task, before browser paint.
    const prepared: { canvas: HTMLCanvasElement; buffer: HTMLCanvasElement }[] = [];
    try {
      for (let i = 0; i < sides.length; i++) {
        for (const canvas of this.canvases.get(sides[i]!) ?? []) {
          const buffer = this.drawBuffer(canvas, frames[i]!.handle as globalThis.VideoFrame);
          prepared.push({ canvas, buffer });
        }
      }
    } catch {
      this.waitingT ??= T;
      this.missingMs += elapsed; this.stableMs = 0; this.catchupMode = "normal";
      freeze("frozen"); return;
    }
    for (const { canvas, buffer } of prepared) {
      if (canvas.width !== buffer.width) canvas.width = buffer.width;
      if (canvas.height !== buffer.height) canvas.height = buffer.height;
      canvas.getContext("2d")!.drawImage(buffer, 0, 0);
      this.paintedCanvases.add(canvas);
    }
    const advanced = this.tUs.value == null || T > this.tUs.value;
    this.tUs.value = T; // committed presentation time; overlays must never use targetUs
    this.sync.state = "playing";
    this.sync.reason = "playing";
    this.sync.pairErrorUs = pairError;
    this.playback.speed = this.pendingSeek != null || !advanced ? 0 : plan.rate;
    this.catchupMode = plan.mode === "soft" ? "soft" : "normal";
    this.pendingSeek = null; this.waitingT = null; this.missingMs = 0; this.stableMs = 0;
    this.playback.behindS = (required - T) / 1e6;
    for (let i = 0; i < sides.length; i++) {
      const side = sides[i]!;
      this.sync.presentedRt[side] = frames[i]!.rtUs;
      this.sync.targetErrorUs[side] = frames[i]!.rtUs - T;
      this.presented[side] = true;
      this.streamError[side] = null;
    }
    logAuth("present", `T=${T} pairErrorUs=${pairError} A=${this.sync.presentedRt.A} B=${this.sync.presentedRt.B}`);
  }
  private buffers = new WeakMap<HTMLCanvasElement, HTMLCanvasElement>();
  private drawBuffer(canvas: HTMLCanvasElement, frame: globalThis.VideoFrame): HTMLCanvasElement {
    let buffer = this.buffers.get(canvas);
    if (!buffer) { buffer = document.createElement("canvas"); this.buffers.set(canvas, buffer); }
    if (!frame.displayWidth || !frame.displayHeight || !canvas.getContext("2d")) throw new Error("Invalid presentation surface");
    if (buffer.width !== frame.displayWidth) buffer.width = frame.displayWidth;
    if (buffer.height !== frame.displayHeight) buffer.height = frame.displayHeight;
    const ctx = buffer.getContext("2d");
    if (!ctx) throw new Error("Canvas unavailable");
    ctx.drawImage(frame, 0, 0);
    return buffer;
  }
  stop(): void {
    this.running = false;
    this.driver.stop();
    if (this.healthTimer) clearInterval(this.healthTimer);
    this.healthTimer = null;
  }
}

/** Document-local singleton; separate pages follow WS anchors independently. */
export const alignEngine = new AlignEngine();
