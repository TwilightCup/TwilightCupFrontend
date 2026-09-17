const { test } = require('node:test');
const assert = require('node:assert/strict');
const load = require('./load-ts.cjs')();
const { HlsHarvester } = load('src/scenes/align/hlsPoller.ts');
const playlist = '#EXTM3U\n#EXT-X-MEDIA-SEQUENCE:10\n#EXT-X-MAP:URI="init.mp4"\n#EXT-X-PART:DURATION=0.2,URI="part.mp4"\n#EXTINF:2,\na.mp4\n#EXT-X-GAP\n#EXTINF:2,\ngap.mp4\n#EXTINF:2,\nb.mp4\n';
const ok = (text = playlist) => ({ ok: true, text: async () => text, arrayBuffer: async () => new ArrayBuffer(1) });
function harvester(deliver) { return new HlsHarvester('https://fixture.invalid/index.m3u8', deliver, { pollIntervalMs: 800, followParts: true }); }

test('serial complete segments: overlapping polls, parts, GAP and duplicates', async () => {
  const urls = [], delivered = [];
  const original = global.fetch;
  global.fetch = async (url) => { urls.push(url); await Promise.resolve(); return ok(); };
  try {
    const h = harvester((_, kind, meta) => delivered.push([kind, meta]));
    await Promise.all([h.poll(), h.poll()]);
    await h.poll();
    assert.equal(urls.filter(u => u.endsWith('a.mp4')).length, 1);
    assert(!urls.some(u => /part.mp4|gap.mp4/.test(u)));
    assert.deepEqual(delivered.map(d => d[0]), ['init', 'segment', 'segment']);
    assert.equal(delivered[2][1].discontinuity, true);
  } finally { global.fetch = original; }
});

test('init retries and failed media blocks later segments until recovered', async () => {
  let initAttempts = 0, aAttempts = 0;
  const delivered = [], urls = [], original = global.fetch;
  global.fetch = async (url) => {
    urls.push(url);
    if (url.endsWith('init.mp4') && ++initAttempts === 1) return { ok: false, status: 503 };
    if (url.endsWith('a.mp4') && ++aAttempts === 1) return { ok: false, status: 404 };
    return ok();
  };
  try {
    const h = harvester((_, kind, meta) => delivered.push([kind, meta]));
    await h.poll();
    assert.equal(delivered.length, 0);
    h.retry.at = 0;
    await h.poll();
    assert(!urls.some(u => u.endsWith('b.mp4')));
    h.retry.at = 0;
    await h.poll();
    assert.deepEqual(delivered.filter(d => d[1]).map(d => d[1].sequence), [10, 12]);
    assert.equal(initAttempts, 2);
  } finally { global.fetch = original; }
});

test('stop aborts and suppresses a fetch implementation that resolves late', async () => {
  let release, signal;
  const original = global.fetch, delivered = [];
  global.fetch = async (url, opts) => {
    if (url.endsWith('init.mp4')) { signal = opts.signal; await new Promise(r => { release = r; }); }
    return ok();
  };
  try {
    const h = harvester(() => delivered.push(1));
    const pending = h.poll();
    while (!release) await Promise.resolve();
    h.stop(); release(); await pending;
    assert(signal.aborted);
    assert.equal(delivered.length, 0);
  } finally { global.fetch = original; }
});

const { WebCodecsDecoder, FrameLockStream } = load('src/scenes/align/frameLock.ts');
function fakeSource() { return { start() {}, stop() { this.stopped = true; }, setOnSegment(cb) { this.deliver = cb; }, setOnError() {}, harvesterStats() { return { retries: 0, gaveUp: 0, authFail: 0 }; } }; }
function raw(rtUs, isKey = true) { return { rtUs, isKey, payload: new Uint8Array(10), epoch: 0, codec: 'h264', description: null }; }

test('B-frame output uses timestamps; old decoder callbacks are closed and ignored', async () => {
  const originalDecoder = global.VideoDecoder, originalChunk = global.EncodedVideoChunk;
  const instances = [], output = [], errors = [];
  global.VideoDecoder = class {
    static async isConfigSupported() { return { supported: true }; }
    constructor(callbacks) { this.callbacks = callbacks; instances.push(this); this.decodeQueueSize = 0; }
    configure() {} close() {} decode() { if (this.fail) throw new Error('bad chunk'); }
  };
  global.EncodedVideoChunk = class { constructor(data) { Object.assign(this, data); } };
  try {
    const decoder = new WebCodecsDecoder((rt, key) => output.push([rt, key]), e => errors.push(e));
    assert(await decoder.configure('avc1.42E01F', null));
    for (const t of [100, 300, 200]) assert(decoder.decodeSample(t, t === 100, new Uint8Array(1)));
    for (const t of [100, 200, 300]) instances[0].callbacks.output({ timestamp: t, close() {} });
    assert.deepEqual(output, [[100, true], [200, false], [300, false]]);
    await decoder.configure('avc1.42E01F', null);
    let closed = false;
    instances[0].callbacks.output({ timestamp: 400, close() { closed = true; } });
    assert(closed); assert.equal(output.length, 3);
    instances[1].fail = true;
    assert.equal(decoder.decodeSample(400, false, new Uint8Array(1)), false);
    assert.equal(errors.length, 1);
    assert.equal(decoder.isDecoding, false);
    assert.equal(decoder.pendingSize, 0);
  } finally { global.VideoDecoder = originalDecoder; global.EncodedVideoChunk = originalChunk; }
});

test('stop during async decoder configuration cannot resurrect the decoder', async () => {
  const original = global.VideoDecoder;
  let resolve, created = 0;
  global.VideoDecoder = class {
    static isConfigSupported() { return new Promise(r => { resolve = r; }); }
    constructor() { created++; }
  };
  try {
    const decoder = new WebCodecsDecoder(() => {});
    const pending = decoder.configure('avc1.42E01F', null);
    decoder.close(); resolve({ supported: true });
    assert.equal(await pending, false); assert.equal(created, 0);
  } finally { global.VideoDecoder = original; }
});

test('raw sliding window preserves the next decode sample beyond 20 minutes', () => {
  const stream = new FrameLockStream(fakeSource());
  stream.raw = Array.from({ length: 6001 }, (_, i) => raw(i * 100000, i % 10 === 0));
  stream.rawBytes = stream.raw.length * 10;
  stream.decPos = 5700;
  for (let i = 6001; i < 13200; i++) {
    stream.raw.push(raw(i * 100000, i % 10 === 0)); stream.rawBytes += 10;
    stream.targetUs = (i - 300) * 100000;
    while (stream.raw[stream.decPos].rtUs < stream.targetUs) stream.decPos++;
    const next = stream.raw[stream.decPos];
    stream.trimRaw(i * 100000);
    assert.equal(stream.raw[stream.decPos], next);
    assert(stream.raw.length <= 6001);
  }
});

test('memory budget protects the target GOP and explicitly stops intake when exhausted', () => {
  const source = fakeSource(), stream = new FrameLockStream(source, { maxRawBytes: 25 });
  stream.raw = [raw(0), raw(1e6), raw(2e6), raw(3e6)]; stream.rawBytes = 40;
  stream.decPos = 2; stream.targetUs = 1e6;
  stream.trimRaw(3e6);
  assert.equal(stream.raw[0].rtUs, 1e6); // do not remove protected keyframe
  assert.equal(stream.decPos, 1);
  assert(stream.memoryBlocked); assert(source.stopped);
});

test('decode throw invalidates reference chain; following delta is not fed', () => {
  const stream = new FrameLockStream(fakeSource());
  stream.raw = [raw(1e6, false), raw(1.01e6, false), raw(1.02e6)];
  stream.encapsulation = 'avcc'; stream.ready = true; stream.decodedEpoch = 0;
  let calls = 0;
  stream.decoder = { queueSize: 0, pendingSize: 0, decodeSample() { calls++; return false; }, close() {}, async configure() { return true; } };
  stream.pump(1e6);
  assert.equal(calls, 1); assert(stream.needKey); assert.equal(stream.decPos, 1);
  stream.pump(1e6);
  assert.equal(calls, 1); assert.equal(stream.decPos, 2); assert(stream.pendingConfigure);
});

const { ExternalClock } = load('src/scenes/align/externalClock.ts');
test('external clock interpolates, rejects old epoch/seq/time, then freezes stale', () => {
  const c = new ExternalClock(); c.selectSource('stage');
  assert(c.accept({ t_us: 100e6, src: 'stage', epoch: 2, seq: 1, rate: 1 }, 0));
  assert.equal(c.read(200).t, 100.2e6);
  assert(!c.accept({ t_us: 101e6, src: 'stage', epoch: 1, seq: 99 }, 210));
  assert(!c.accept({ t_us: 101e6, src: 'stage', epoch: 2, seq: 1 }, 210));
  assert(!c.accept({ t_us: 99e6, src: 'stage', epoch: 2, seq: 2 }, 210));
  assert(c.accept({ t_us: 100.4e6, src: 'stage', epoch: 2, seq: 2, rate: 2 }, 400));
  assert.equal(c.read(600).t, 100.8e6);
  assert(c.read(3000).stale);
  assert.equal(c.read(3000).t, c.read(10000).t);
});

test('legacy anchors work, paused anchors do not rewind, source switch requires selection', () => {
  const c = new ExternalClock();
  assert(c.accept({ t_us: 100e6, src: 'a' }, 0));
  assert.equal(c.read(200).t, 100.2e6);
  assert(c.accept({ t_us: 100e6, src: 'a' }, 400));
  assert.equal(c.read(600).t, 100.2e6);
  assert(!c.accept({ t_us: 101e6, src: 'b' }, 650));
  c.selectSource('b');
  assert(c.accept({ t_us: 101e6, src: 'b' }, 700));
  assert(!c.accept({ t_us: 102e6, src: 'a' }, 710));
});

const { AlignEngine } = load('src/scenes/align/useFrameAlign.ts');
const { FrameQueue } = load('src/scenes/align/frameQueue.ts');
function mockStream(ready = true) {
  const queue = new FrameQueue();
  return { queue, coverage: () => ({ from: 0, to: 100e6 }), ready,
    advance(t) { if (this.ready) queue.add({ rtUs: t, isKey: true, handle: {} }); }, stop() {} };
}
test('common presentation requires both streams; no committed T or one-sided readiness on miss', () => {
  const e = new AlignEngine(); e.setRequiredSides(['A', 'B']);
  const a = mockStream(), b = mockStream(false);
  e.streams.set('A', a);
  e.tickLoop(0); assert.equal(e.tUs.value, null);
  e.streams.set('B', b);
  e.tickLoop(16); assert.equal(e.tUs.value, null); assert.equal(e.presented.A, false);
  b.ready = true; e.tickLoop(32);
  assert.equal(e.tUs.value, 70e6); assert.equal(e.sync.state, 'playing');
  b.ready = false; b.queue.clear();
  e.tickLoop(48);
  assert.equal(e.tUs.value, 70e6); assert.equal(e.presented.A, false); assert.equal(e.presented.B, false);
  assert.equal(e.sync.state, 'frozen');
});
test('nearest never returns a distant frame', () => {
  const q = new FrameQueue(); q.add({ rtUs: 1e6, isKey: true, handle: {} });
  assert.equal(q.nearest(2e6), null);
  assert(q.nearest(1.02e6));
});

const { RateController } = load('src/scenes/align/rateControl.ts');
test('30s lag and 2x/15s catch-up are preserved without an automatic 60s jump', () => {
  const rate = new RateController();
  assert.equal(rate.step(0, [100e6, 101e6]), 70e6);
  assert.equal(rate.step(1000, [200e6]), 71e6);
  assert.equal(rate.speed, 2);
  assert.equal(rate.step(15000, [215e6]), 101e6);
  assert.equal(rate.speed, 1);
});
const { PresentationHistory } = load('src/scenes/align/presentationHistory.ts');
const { TimerHistory } = load('src/scenes/align/timerHistory.ts');
test('event snapshots preserve old gap/score/round and never reveal first future sample', () => {
  const h = new PresentationHistory();
  h.add(100000, { gap: 10, score: 0, round: 'one' });
  h.add(110000, { gap: 20, score: 1, round: 'two' });
  assert.equal(h.at(99999), null);
  assert.deepEqual(h.at(105000), { gap: 10, score: 0, round: 'one' });
  assert.equal(h.at(110000).round, 'two');
  h.clear(); assert.equal(h.at(110000), null);
  const timer = new TimerHistory(); timer.add({ receivedAt: 100000, totalMs: 2000, segmentMs: 1000, running: false });
  assert.equal(timer.valueAt(70000), null);
  assert.equal(timer.valueAt(160000).totalMs, 2000);
});

test('historical decoder configuration does not overwrite current ingest configuration', async () => {
  const stream = new FrameLockStream(fakeSource());
  stream.codec = 'hevc';
  const current = new Uint8Array([1, 2]); stream.description = current;
  stream.raw = [raw(1000000)]; stream.rawBytes = 10;
  stream.decoder = { queueSize: 0, pendingSize: 0, close() {}, configure: async () => true };
  stream.advance(1000000);
  await Promise.resolve();
  assert.equal(stream.codec, 'hevc'); assert.equal(stream.description, current);
});

test('invalid timing metadata cannot consume a sequence number', () => {
  const c = new ExternalClock();
  assert.equal(c.accept({ t_us: 1e6, seq: 1, server_now_ms: NaN, effective_at_ms: 0 }, 0), false);
  assert(c.accept({ t_us: 1e6, seq: 1 }, 0));
});

test('old component lease cannot stop a replacement session', () => {
  const e = new AlignEngine();
  const old = Symbol(), current = Symbol(); let stopped = false;
  e.refs.set('A', new Set([current]));
  e.streams.set('A', { stop() { stopped = true; } });
  e.stopStream('A', old); assert.equal(stopped, false);
  e.stopStream('A', current); assert.equal(stopped, true);
});
