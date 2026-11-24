const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const vue = require('vue');
const { parse, compileScript } = require('@vue/compiler-sfc');
const { createPage } = require('./helpers/director-page.cjs');
const load = require('./load-ts.cjs')();
const { MatchStatus, MatchPhase } = load('src/api/types.ts');
const auth = { type: 'auth_ok', seat: 'DIRECTOR', account_id: 'account', match_id: 'match' };
const flush = () => new Promise(resolve => setImmediate(resolve));

// Execute the real TopBar setup with the real director store and playback engine.
function topbar(page, props = {}) {
  const script = compileScript(parse(fs.readFileSync('src/scenes/components/TopBar.vue', 'utf8')).descriptor, { id: 'score-test' }).content;
  const code = ts.transpileModule(script, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', code)(id => {
    if (id === 'vue') return { ...vue, onMounted() {}, useId: () => 'test' };
    if (id === '@/stores/director') return { useDirectorStore: () => page.store };
    if (id === '@/scenes/align/useFrameAlign') return { alignEngine: page.engine };
    if (id === '@/scenes/composables/useSceneContext') return { useSceneContext: () => ({ params: {} }) };
    if (id === '@/utils/bilingual') return { bi: key => key };
    if (id === '@/api/client') return { api: {} };
    throw new Error(`Unexpected TopBar dependency: ${id}`);
  }, mod, mod.exports);
  const scope = vue.effectScope();
  const bindings = scope.run(() => mod.exports.default.setup(props, { expose() {} }));
  return { bindings, stop: () => scope.stop() };
}

function frozenPlayback(page) {
  page.engine.tUs.value = 1_000_000;
  page.engine.sync.presentedRt.A = page.engine.sync.presentedRt.B = 1_000_000;
}

test('topbar updates cumulative wins immediately even while the playback clock is frozen', async () => {
  const p = createPage({ id: 'stage' });
  p.deliver(auth);
  await flush();
  frozenPlayback(p);
  const bar = topbar(p);
  try {
    p.deliver({ type: 'cumulative_score', wins_a: 1, wins_b: 0, threshold: 3 });
    assert.deepEqual([p.store.winsA, p.store.winsB], [1, 0]);
    // The playback overlay intentionally retains its historical score.
    assert.deepEqual(p.store.presentedScore, { winsA: 0, winsB: 0 });
    assert.deepEqual([bar.bindings.winsA.value, bar.bindings.winsB.value], [1, 0]);
    p.deliver({ type: 'cumulative_score', wins_a: 1, wins_b: 1, threshold: 3 });
    assert.deepEqual([bar.bindings.winsA.value, bar.bindings.winsB.value], [1, 1]);
    p.deliver({ type: 'director_cmd', action: 'soon_set_target', payload: { target_ms: 120000 } });
    p.deliver({ type: 'director_cmd', action: 'soon_start', payload: {} });
    assert.equal(p.engine.tUs.value, 1_000_000);
    assert.deepEqual([bar.bindings.winsA.value, bar.bindings.winsB.value], [1, 1]);
    // Corrections may decrease a score; no local increment or cached maximum.
    p.deliver({ type: 'cumulative_score', wins_a: 0, wins_b: 1, threshold: 3 });
    assert.deepEqual([bar.bindings.winsA.value, bar.bindings.winsB.value], [0, 1]);
  } finally { bar.stop(); p.close(); }
});

test('topbar shows final live score after match end without requiring another countdown', async () => {
  const p = createPage({ id: 'stage' });
  p.deliver(auth);
  await flush();
  frozenPlayback(p);
  const bar = topbar(p);
  try {
    p.deliver({ type: 'cumulative_score', wins_a: 2, wins_b: 3, threshold: 3 });
    p.deliver({ type: 'match_end', winner: 'B' });
    p.deliver({ type: 'phase_change', phase: MatchPhase.MATCH_END });
    assert.equal(p.store.matchEnded, true);
    assert.deepEqual([bar.bindings.winsA.value, bar.bindings.winsB.value], [2, 3]);
    assert.equal(p.engine.tUs.value, 1_000_000);
  } finally { bar.stop(); p.close(); }
});

test('topbar shows restored final score when the log has totals but no round records', async () => {
  const p = createPage({ id: 'stage', api: {
    getMyMatch: async () => ({ status: MatchStatus.ENDED, winner: 'A' }),
    getMatchLog: async () => ({ initial_info: { win_threshold: 3 }, round_ids: [], final_result: { winner: 'A', wins_a: 3, wins_b: 1 } }),
  } });
  p.deliver(auth);
  await flush();
  frozenPlayback(p);
  const bar = topbar(p);
  try {
    assert.deepEqual([p.store.winsA, p.store.winsB], [3, 1]);
    assert.deepEqual([bar.bindings.winsA.value, bar.bindings.winsB.value], [3, 1]);
    assert.equal(bar.bindings.pipCount.value, 3);
  } finally { bar.stop(); p.close(); }
});

test('topbar retains explicit demo scores', () => {
  const p = createPage({ id: 'stage' });
  const bar = topbar(p, { mock: { winsA: 2, winsB: 1, pipCount: 3 } });
  try { assert.deepEqual([bar.bindings.winsA.value, bar.bindings.winsB.value, bar.bindings.pipCount.value], [2, 1, 3]); }
  finally { bar.stop(); p.close(); }
});
