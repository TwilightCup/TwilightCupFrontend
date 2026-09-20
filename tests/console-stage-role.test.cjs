const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createPage } = require('./helpers/director-page.cjs');
const auth = (id, extra = {}) => ({ type: 'auth_ok', seat: 'DIRECTOR', match_id: 'match',
  account_id: 'account', connection_id: id, align_authority_src: id, authority_epoch: 1,
  align_role: 'publisher', align_lease_required: true, ...extra });
const assignment = (id, src, epoch = 1) => ({ type: 'director_cmd', action: 'align_authority', payload: {
  connection_id: id, src, epoch, role: id === src ? 'publisher' : 'follower',
  account_id: 'account', match_id: 'match', lease_required: true, t_floor_us: null,
} });
const anchor = (t, seq, extra = {}) => ({ type: 'director_cmd', action: 'frame_align', payload: {
  t_us: t, src: 'console', epoch: 1, seq, rate: 1, ...extra,
} });

test('stage declines even a publisher assignment and never probes or publishes a T', () => {
  const p = createPage({ id: 'stage' });
  try {
    assert.equal(p.socket.args[4], 'stage');
    p.deliver(auth('stage')); p.deliver(assignment('stage', 'stage'));
    for (let now = 0; now <= 5000; now += 25) p.tick(now);
    const sent = p.drain(); assert.equal(sent.length, 0);
    assert.equal(p.engine.leaseSample(5000).capability, false);
    assert.equal(p.snapshot().role, 'follower'); assert.equal(p.snapshot().t, null);
    assert.equal(p.snapshot().stageVisible, false); assert.deepEqual(p.snapshot().seeks, [0, 0]);
  } finally { p.close(); }
});

test('console entry opts into election and confirms readiness before publishing', () => {
  const p = createPage({ id: 'console', kind: 'console' });
  try {
    assert.equal(p.socket.args[4], 'console');
    p.deliver(auth('console')); p.deliver(assignment('console', 'console'));
    for (let now = 0; now <= 1000; now += 25) p.tick(now);
    const sent = p.drain(), firstT = sent.findIndex(m => m.action === 'frame_align');
    assert(firstT > 0); assert(sent.slice(0, firstT).some(m => m.action === 'frame_align_status' && m.payload.capability && m.payload.decode_ready));
    assert.equal(p.snapshot().role, 'publisher');
  } finally { p.close(); }
});

test('stage hides cached video on stale, explicit revocation and socket loss, then follows recovery', () => {
  const p = createPage({ id: 'stage', offset: 500000 });
  try {
    p.deliver(auth('stage', { align_role: 'follower', align_authority_src: 'console' }));
    p.deliver(anchor(75e6, 1));
    for (let now = 0; now <= 500; now += 25) p.tick(now);
    assert(p.snapshot().stageVisible); const t = p.snapshot().t;
    p.heartbeat(1600); assert.equal(p.snapshot().stageVisible, false); assert.equal(p.snapshot().t, t);
    assert(p.canvases.every(c => p.engine.hasCanvasImage(c)), 'test includes previously painted pixels');
    p.deliver(anchor(76e6, 2), 1700);
    for (let now = 1700; now <= 2000; now += 25) p.tick(now);
    assert(p.snapshot().stageVisible);
    p.deliver(anchor(76.4e6, 3, { frozen: true, stale: true }), 2100);
    assert.equal(p.snapshot().stageVisible, false);
    p.deliver(assignment('stage', null, 2), 2200);
    assert.equal(p.snapshot().stageVisible, false);
    p.deliver(anchor(76.4e6, 0, { src: null, epoch: 2, frozen: true, stale: true }), 2200);
    p.tick(2250); assert.equal(p.snapshot().stageVisible, false);
    p.deliver(assignment('stage', 'console', 3), 2300);
    assert.equal(p.snapshot().stageVisible, false);
    p.deliver(anchor(76.5e6, 1, { epoch: 3 }), 2300);
    for (let now = 2300; now <= 2800; now += 25) p.tick(now);
    assert(p.snapshot().stageVisible);
    p.socket.onStatusChange('closed'); assert.equal(p.snapshot().stageVisible, false);
    assert(p.drain().every(m => m.action !== 'frame_align'));
  } finally { p.close(); }
});

test('actual stage template gates both aligned and ordinary video on authority', () => {
  const fs = require('node:fs'); const vue = require('vue');
  const { parse } = require('@vue/compiler-sfc'); const { parse: parseDom, compile } = require('@vue/compiler-dom');
  const ast = parseDom(parse(fs.readFileSync('src/scenes/match/MatchScene.vue', 'utf8')).descriptor.template.content);
  const find = node => node.type === 1 && node.tag === 'section' && node.props.some(p => p.name === 'class' && p.value?.content === 'streams')
    ? node : (node.children ?? []).map(find).find(Boolean);
  const render = new Function('Vue', compile(find(ast).loc.source, { mode: 'function' }).code)({ ...vue, resolveComponent: name => name });
  const players = node => (['SeiStream', 'StreamFrame'].includes(node.type) ? [node] : [])
    .concat(...(Array.isArray(node.children) ? node.children.filter(n => n && typeof n === 'object').map(players) : []));
  for (const aligned of [true, false]) for (const waiting of [true, false]) {
    const ctx = { seiA: aligned, seiB: aligned,
      director: { matchId: 'match' }, config: { hideA: false, hideB: false }, params: {}, waitingForAuthority: waiting };
    const video = players(render(ctx, [])); assert.equal(video.length, 2);
    assert(video.every(v => v.props.hidden === waiting));
  }
});

test('WebSocket URL keeps the page purpose across reconnect without exclusive takeover', () => {
  const fs = require('node:fs'), path = require('node:path'), ts = require('typescript');
  const config = { exports: {} };
  const source = fs.readFileSync('src/api/config.ts', 'utf8').replaceAll('import.meta.env', '({})');
  new Function('exports', ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText)(config.exports);
  const { MatchSocket } = require('./load-ts.cjs')({
    [path.resolve('src/api/config.ts')]: config.exports,
    [path.resolve('src/api/client.ts')]: { notifySessionExpired() {} },
  })('src/ws/socket.ts');
  const saved = { WebSocket: global.WebSocket, location: global.location,
    setTimeout: global.setTimeout, clearTimeout: global.clearTimeout };
  const connections = []; let reconnect;
  global.WebSocket = class {
    static OPEN = 1;
    constructor(url) { this.url = url; connections.push(this); }
    close() {}
  };
  global.location = { protocol: 'https:', host: 'broadcast.test' };
  global.setTimeout = fn => { reconnect = fn; return 1; };
  global.clearTimeout = () => {};
  const socket = new MatchSocket();
  try {
    socket.connect('test-token', 'DIRECTOR', 'match', false, 'stage');
    connections[0].onclose({ code: 1006 }); reconnect();
    for (const ws of connections) {
      const params = new URL(ws.url).searchParams;
      assert.equal(params.get('align_client'), 'stage'); assert.equal(params.get('match'), 'match');
      assert.equal(params.has('exclusive'), false);
    }
    socket.connect('test-token', 'DIRECTOR', 'match', false, 'console');
    assert.equal(new URL(connections.at(-1).url).searchParams.get('align_client'), 'console');
  } finally { socket.disconnect(); Object.assign(global, saved); }
});
