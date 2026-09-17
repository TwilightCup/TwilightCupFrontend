const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const load = require('./load-ts.cjs')();
const { planCatchup, CATCHUP } = load('src/scenes/align/rateControl.ts');
const { ExternalClock } = load('src/scenes/align/externalClock.ts');
const { AlignEngine } = load('src/scenes/align/useFrameAlign.ts');
const { FrameLockStream } = load('src/scenes/align/frameLock.ts');
const input = { current: 60e6, authority: 61e6, from: 0, safeTo: 70e6, elapsedMs: 16, rate: 1, supply: true, recovering: false };
test('soft catchup is bounded, hysteretic and returns to normal', () => {
  let current = 60e6, authority = 61e6, mode = 'normal';
  for (let i = 0; i < 2500; i++) {
    authority += 16000;
    const p = planCatchup({ ...input, current, authority, safeTo: authority + 1e6, mode });
    assert(p.rate >= 1 && p.rate <= 1.08); current = p.t; mode = p.mode;
  }
  assert.equal(mode, 'normal');
  assert.equal(planCatchup({ ...input, authority: 60.3e6, mode: 'normal' }).rate, 1);
  assert(planCatchup({ ...input, authority: 60.3e6, mode: 'soft' }).rate > 1);
  assert.equal(planCatchup({ ...input, authority: 60.05e6, mode: 'soft' }).rate, 1);
});
test('hard recovery selects a common safe point, missing supply never accelerates', () => {
  const p = planCatchup({ ...input, authority: 90e6, mode: 'normal' });
  assert.equal(p.mode, 'seek'); assert.equal(p.t, 70e6);
  assert.equal(planCatchup({ ...input, mode: 'soft', supply: false }).rate, 0);
  assert.equal(planCatchup({ ...input, from: 80e6 }).mode, 'wait');
  assert.equal(planCatchup({ ...input, authority: 65e6, from: 62e6 }).mode, 'seek');
});
test('three pages wait for backend; no Stage election or clock publishing remains', () => {
  for (let i = 0; i < 3; i++) {
    const e = new AlignEngine();
    e.streams.set("A", { coverage: () => ({ from: 0, to: 100e6 }),
      canSeek() { assert.fail("no authority must not seek"); }, advance() { assert.fail("no authority must not decode"); } });
    e.tickLoop(100);
    assert.equal(e.tUs.value, null); assert.equal(e.setAuthority, undefined);
  }
  const stage = fs.readFileSync('src/scenes/stage/StageScene.vue', 'utf8');
  assert(!stage.includes('setAuthority(')); assert(!stage.includes('sendFrameAlign('));
});
test('same anchors continuously project in separate performance clock domains', () => {
  const a = new ExternalClock(), b = new ExternalClock();
  const anchor = { t_us: 60e6, epoch: 2, seq: 3, rate: 1, server_now_ms: 1000, effective_at_ms: 1000 };
  assert(a.accept(anchor, 0)); assert(b.accept(anchor, 100));
  for (const dt of [0, 16, 100, 250, 399]) assert.equal(a.read(dt).t, b.read(100 + dt).t);
  assert.equal(a.read(399).t, 60e6 + 399000);
  assert(!a.accept({ ...anchor, seq: 2 }, 400));
  assert(!a.accept({ ...anchor, epoch: 1, seq: 9 }, 400));
  assert(!a.accept({ ...anchor, seq: 4, t_us: 59e6 }, 400));
  assert(a.read(2000).stale);
});
test('hard seek resets decoder cursor and closes old output before rebuilding', () => {
  const source = { setOnSegment() {}, setOnError() {}, stop() {} };
  const s = new FrameLockStream(source); let closed = 0;
  s.decoder = { close() { closed++; } };
  s.raw = [0, 10, 20].map(t => ({ rtUs: t * 1e6, isKey: true, epoch: 0, payload: new Uint8Array(1), codec: 'h264', description: null }));
  s.continuousFromUs = 0; s.continuousToUs = 50e6;
  s.decPos = 3; s.pendingConfigure = true;
  assert(s.seek(15e6)); assert.equal(s.decPos, 1); assert.equal(s.pendingConfigure, false);
  assert(s.needKey); assert.equal(closed, 1);
});

test('legacy late-join snapshot is stale, modern timed replay is immediately usable', () => {
  const c = new ExternalClock();
  assert(c.accept({ t_us: 60e6, replay: true }, 0)); assert(c.read(0).stale);
  assert(c.accept({ t_us: 61e6, epoch: 1, seq: 1, replay: true, rate: 1,
    effective_at_ms: 500, server_now_ms: 600 }, 100));
  assert(!c.read(100).stale); assert.equal(c.read(100).t, 61.1e6);
});

test('A/B hard recovery uses one pinned target and waits for both before overlay T changes', () => {
  const { FrameQueue } = load('src/scenes/align/frameQueue.ts');
  const e = new AlignEngine(); e.setRequiredSides(['A', 'B']); e.tUs.value = 40e6;
  e.external.accept({ t_us: 70e6, epoch: 1, seq: 1, rate: 1 }, 0);
  function stream(ready) { return { ready, seeks: [], queue: new FrameQueue(), coverage: () => ({ from: 50e6, to: 110e6 }),
    canSeek: () => true, seek(t) { this.seeks.push(t); this.queue.clear(); return true; },
    advance(t) { if (this.ready) this.queue.add({ rtUs: t, isKey: true, handle: {} }); } }; }
  const a = stream(true), b = stream(false); e.streams.set('A', a); e.streams.set('B', b);
  e.tickLoop(0);
  assert.deepEqual(a.seeks, [70e6]); assert.deepEqual(b.seeks, [70e6]);
  for (let t = 16; t <= 160; t += 16) e.tickLoop(t);
  assert.equal(e.tUs.value, 40e6); assert.equal(e.playback.speed, 0);
  b.ready = true;
  for (let t = 176; t <= 416; t += 16) e.tickLoop(t);
  assert.equal(e.tUs.value, 70e6);
  assert.equal(e.sync.presentedRt.A, e.sync.presentedRt.B);
  assert.equal(a.seeks.length, 1); assert.equal(b.seeks.length, 1);
});

test('recovery hysteresis resets on any missing frame; no wall-time-only resume', () => {
  const { recoveryGate } = load('src/scenes/align/rateControl.ts');
  assert.equal(recoveryGate(240, false, 100).stableMs, 0);
  assert.equal(recoveryGate(0, true, 5000).ready, false);
  assert.equal(recoveryGate(240, true, 16).ready, true);
});

test('scene/source scope cannot change inside one authority epoch', () => {
  const c = new ExternalClock();
  const anchor = { t_us: 60e6, epoch: 1, seq: 1, scene: 'broadcast', source_id: 'pair1' };
  assert(c.accept(anchor, 0));
  assert(!c.accept({ ...anchor, seq: 2, source_id: 'pair2' }, 10));
  assert(!c.accept({ ...anchor, seq: 2, scene: 'other' }, 10));
  assert(c.accept({ ...anchor, epoch: 2, source_id: 'pair2' }, 20));
});
