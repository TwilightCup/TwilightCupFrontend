// One isolated Pinia store/clock/decoder per document; only media and transport are fakes.
const path = require('node:path');
const { createPinia, disposePinia } = require('pinia');
const createLoader = require('../load-ts.cjs');
const load = createLoader();
const { AlignEngine } = load('src/scenes/align/useFrameAlign.ts');
const { FrameQueue } = load('src/scenes/align/frameQueue.ts');

function createPage({ id, kind = 'stage', offset = 0 }) {
  let now = 0, socket;
  const sent = [], timers = new Map();
  let timerId = 0;
  const ports = fn => {
    const saved = { performance: global.performance, document: global.document,
      setInterval: global.setInterval, clearInterval: global.clearInterval };
    Object.assign(global, { performance: { now: () => now + offset }, document: { hidden: false },
      setInterval: fn => { timers.set(++timerId, fn); return timerId; },
      clearInterval: id => timers.delete(id) });
    try { return fn(); } finally { Object.assign(global, saved); }
  };
  const engine = ports(() => new AlignEngine(false));
  engine.setRequiredSides(['A', 'B']);
  const canvases = [];
  for (const side of ['A', 'B']) {
    const queue = new FrameQueue();
    engine.streams.set(side, { queue, cursor: null, seeks: 0,
      coverage: () => ({ from: 0, to: 110e6 + now * 1000 }), canSeek: () => true,
      seek(t) { this.cursor = t; this.seeks++; queue.clear(); return true; },
      advance(t) {
        if (this.cursor != null && Math.abs(t - this.cursor) < 400000) {
          this.cursor = t;
          queue.add({ rtUs: t, isKey: true, handle: { displayWidth: 1, displayHeight: 1 } });
        }
      },
    });
    const canvas = { width: 1, height: 1, getContext: () => ({ drawImage() {} }) };
    engine.registerCanvas(side, canvas); canvases.push(canvas);
  }
  engine.drawBuffer = () => ({ width: 1, height: 1 });
  class Socket {
    constructor() { socket = this; }
    connect(...args) { this.args = args; this.onStatusChange('open'); }
    send(msg) { sent.push(msg); return true; }
    sendQueued(msg) { return this.send(msg); }
    disconnect() { this.onStatusChange('closed'); }
  }
  const overrides = Object.fromEntries(Object.entries({
    'src/ws/socket.ts': { MatchSocket: Socket },
    'src/api/client.ts': { api: { getMyMatch: async () => ({}), getMatchLog: async () => { throw new Error('no match log'); } } },
    'src/stores/auth.ts': { useAuthStore: () => ({ token: 'test-token' }) },
    'src/locales.ts': { t: key => key },
    'src/scenes/composables/useDirectorConfig.ts': { mergeStoredConfig() {} },
    'src/scenes/align/useFrameAlign.ts': { alignEngine: engine },
  }).map(([file, value]) => [path.resolve(file), value]));
  const { useDirectorStore } = createLoader(overrides)('src/stores/director.ts');
  const pinia = createPinia();
  const store = ports(() => useDirectorStore(pinia));
  ports(() => kind === 'console' ? store.connectWithAuth('match') : store.connect('test-token', 'match'));
  return {
    id, kind, engine, store, socket, canvases,
    deliver(message, at = now) { now = at; ports(() => socket.onMessage(message)); },
    tick(at) { now = at; ports(() => { engine.tickLoop(now + offset); engine.clockPulse?.(); }); },
    heartbeat(at) { now = at; ports(() => { for (const fn of timers.values()) fn(); }); },
    drain() { return sent.splice(0); },
    snapshot() { return { role: engine.sync.role, state: engine.sync.state, reason: engine.sync.reason,
      t: engine.tUs.value, authorityReady: engine.authorityReady.value, candidate: engine.sync.candidate,
      seeks: [...engine.streams.values()].map(s => s.seeks),
      stageVisible: engine.authorityReady.value && canvases.every(c => engine.hasCanvasImage(c)) }; },
    close() { ports(() => store.disconnect()); disposePinia(pinia); },
  };
}
module.exports = { createPage };

// JSON-line bridge used by the read-only backend integration test.
if (require.main === module) {
  const pages = new Map();
  require('node:readline').createInterface({ input: process.stdin }).on('line', line => {
    try {
      const cmd = JSON.parse(line);
      if (cmd.op === 'create') pages.set(cmd.id, createPage(cmd));
      if (cmd.op === 'deliver') pages.get(cmd.id).deliver(cmd.message, cmd.now);
      if (cmd.op === 'tick') for (const p of pages.values()) p.tick(cmd.now);
      if (cmd.op === 'close') { pages.get(cmd.id).close(); pages.delete(cmd.id); }
      const out = [...pages.values()].flatMap(p => p.drain().map(message => ({ id: p.id, message })));
      const snapshots = Object.fromEntries([...pages].map(([id, p]) => [id, p.snapshot()]));
      process.stdout.write(JSON.stringify({ out, snapshots }) + '\n');
    } catch (e) { process.stdout.write(JSON.stringify({ error: e.stack }) + '\n'); }
  });
}
