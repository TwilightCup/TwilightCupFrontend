const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createPage } = require('./helpers/director-page.cjs');
const load = require('./load-ts.cjs')();
const { MatchStatus, MatchPhase, RoundVerdict } = load('src/api/types.ts');
const scenes = load('src/scenes/stage/useStageScene.ts');
const auth = { type: 'auth_ok', account_id: 'account', match_id: 'match', seat: 'DIRECTOR' };
const flush = () => new Promise(resolve => setImmediate(resolve));
const doc = (final_result, round_ids = []) => ({ initial_info: { name: 'Final', bo_format: 5 }, final_result, round_ids });

test('victory scene persists per account/match; unknown cached keys keep the existing fallback', () => {
  const descriptor = Object.getOwnPropertyDescriptor(global, 'localStorage');
  const storage = new Map();
  Object.defineProperty(global, 'localStorage', { configurable: true, value: {
    getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value),
  } });
  try {
    scenes.writeStoredScene('account', 'match', 'victory');
    assert.equal(scenes.readStoredScene('account', 'match'), 'victory');
    assert.equal(scenes.readStoredScene('other', 'match'), null);
    storage.set(scenes.sceneStorageKey('account', 'match'), 'unknown');
    assert.equal(scenes.readStoredScene('account', 'match'), null);
    assert.equal(scenes.isSceneKey('victory'), true);
    assert.equal(scenes.isSceneKey('unknown'), false);
  } finally {
    if (descriptor) Object.defineProperty(global, 'localStorage', descriptor);
    else delete global.localStorage;
  }
});

test('finished match restores confirmed winner, player names and final score after refresh', async () => {
  const p = createPage({ id: 'stage', api: {
    getMyMatch: async () => ({ name: 'Final', status: MatchStatus.ENDED, winner: 'B', player_a_username: 'Alice', player_b_username: 'Bob', bo_format: 5 }),
    getMatchLog: async () => doc({ winner: 'B', wins_a: 1, wins_b: 3 }),
  } });
  try {
    p.deliver(auth);
    await flush();
    assert.equal(p.store.matchEnded, true);
    assert.equal(p.store.matchWinner, 'B');
    assert.equal(p.store.nameOf('A'), 'Alice');
    assert.equal(p.store.nameOf('B'), 'Bob');
    assert.deepEqual([p.store.winsA, p.store.winsB, p.store.resultScoreReady], [1, 3, true]);
    p.deliver({ type: 'director_cmd', action: 'state_sync', payload: { scene: 'victory' } });
    assert.equal(p.store.currentSceneCmd, 'victory');
    p.store.sendDirectorCommand('switch_scene', { scene: 'victory' });
    assert.equal(p.drain().some(m => m.action === 'switch_scene' && m.payload.scene === 'victory'), true);
    p.deliver({ type: 'director_cmd', action: 'switch_scene', payload: { scene: 'match' } });
    assert.equal(p.store.currentSceneCmd, 'match');
  } finally { p.close(); }
});

test('log winner and counted round verdicts restore when match document is unavailable', async () => {
  const p = createPage({ id: 'stage', api: {
    getMyMatch: async () => { throw new Error('unavailable'); },
    getMatchLog: async () => doc({ winner: 'A' }, ['round']),
    getRoundDetail: async () => ({ id: 'round', match_id: 'match', round_no: 1, counted: true, verdict: RoundVerdict.A_WIN }),
  } });
  try {
    p.deliver(auth);
    await flush();
    assert.equal(p.store.matchWinner, 'A');
    assert.equal(p.store.matchEnded, true);
    assert.deepEqual([p.store.winsA, p.store.winsB, p.store.resultScoreReady], [1, 0, true]);
  } finally { p.close(); }
});

test('late REST cannot replace newer live winner or cumulative score', async () => {
  let resolveMatch;
  const p = createPage({ id: 'stage', api: {
    getMyMatch: () => new Promise(resolve => { resolveMatch = resolve; }),
    getMatchLog: async () => doc({ winner: 'A', wins_a: 3, wins_b: 0 }),
  } });
  try {
    p.deliver(auth);
    p.deliver({ type: 'cumulative_score', wins_a: 2, wins_b: 3, threshold: 3 });
    p.deliver({ type: 'match_end', winner: 'B' });
    p.deliver({ type: 'phase_change', phase: MatchPhase.MATCH_END });
    resolveMatch({ winner: 'A', status: MatchStatus.ENDED });
    await flush();
    assert.equal(p.store.matchWinner, 'B');
    assert.deepEqual([p.store.winsA, p.store.winsB, p.store.resultScoreReady], [2, 3, true]);
  } finally { p.close(); }
});

test('missing result stays unknown and changing matches clears winner, score and scene', async () => {
  const p = createPage({ id: 'stage', api: {
    getMyMatch: async () => ({ status: MatchStatus.ENDED }),
    getMatchLog: async () => doc(null),
  } });
  try {
    p.deliver(auth);
    await flush();
    assert.equal(p.store.matchWinner, null);
    assert.equal(p.store.resultScoreReady, false);
    p.deliver({ type: 'match_end', winner: 'A' });
    p.deliver({ type: 'cumulative_score', wins_a: 3, wins_b: 0, threshold: 3 });
    p.deliver({ type: 'director_cmd', action: 'state_sync', payload: { scene: 'victory' } });
    p.deliver({ ...auth, match_id: 'other' });
    assert.equal(p.store.matchWinner, null);
    assert.equal(p.store.resultScoreReady, false);
    assert.equal(p.store.currentSceneCmd, null);
    assert.deepEqual([p.store.winsA, p.store.winsB], [0, 0]);
    await flush();
  } finally { p.close(); }
});

// Render the actual shared SFC used by both the console and stage.
async function renderResult(store, bilingual = false) {
  const fs = require('node:fs');
  const ts = require('typescript');
  const { parse, compileScript } = require('@vue/compiler-sfc');
  const vue = require('vue');
  const { renderToString } = require('@vue/server-renderer');
  const source = fs.readFileSync('src/scenes/victory/VictoryResult.vue', 'utf8');
  const script = compileScript(parse(source).descriptor, { id: 'victory-result', inlineTemplate: true }).content;
  const code = ts.transpileModule(script, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', code)(id => {
    if (id === 'vue') return vue;
    if (id === 'vue-i18n') return { useI18n: () => ({ t: key => key }) };
    if (id === '@/stores/director') return { useDirectorStore: () => store };
    if (id === '@/utils/bilingual') return { bi: key => `bilingual:${key}` };
    throw new Error(`Unexpected dependency: ${id}`);
  }, mod, mod.exports);
  return renderToString(vue.createSSRApp(mod.exports.default, { bilingual }));
}

test('console and stage result render A/B winners, score and format without inventing missing results', async () => {
  const base = { matchName: 'Final', boFormat: 5, matchEnded: true, nameOf: side => side === 'A' ? 'Alice' : 'Bob', winsA: 3, winsB: 1 };
  for (const bilingual of [false, true]) {
    for (const side of ['A', 'B']) {
      const html = await renderResult({ ...base, matchWinner: side, resultScoreReady: true }, bilingual);
      assert.match(html, new RegExp(`winner-name[^>]*>${side === 'A' ? 'Alice' : 'Bob'}</h1>`));
      assert.match(html, /Final/);
      assert.match(html, /BO5/);
      assert.match(html, /<strong>3<\/strong>/);
      assert.match(html, /<strong>1<\/strong>/);
    }
  }
  const waiting = await renderResult({ ...base, matchEnded: false, matchWinner: null, resultScoreReady: true });
  assert.match(waiting, /scenes.victory.waiting/);
  assert.doesNotMatch(waiting, /winner-name|score-row/);
  const missing = await renderResult({ ...base, matchWinner: null, resultScoreReady: false });
  assert.match(missing, /scenes.victory.missingWinner/);
  const missingScore = await renderResult({ ...base, matchWinner: 'A', resultScoreReady: false });
  assert.match(missingScore, /scenes.victory.missingScore/);
  assert.doesNotMatch(missingScore, /score-row/);
});
