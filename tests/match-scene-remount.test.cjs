const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { parse, compileScript } = require('@vue/compiler-sfc');
const vue = require('vue');
const load = require('./load-ts.cjs')({ [path.resolve('src/locales.ts')]: { t: key => key } });
const { MatchPhase, PlayerStatus, PickType } = load('src/api/types.ts');

// Execute the real SFC setup and eager delay sampling with an already-populated
// hosted store, as happens when returning from a different stage scene.
function setupScene(type, attempts = [], configPatch = {}) {
  const timers = new Set();
  const config = vue.reactive({ decoupled: false, alignA: true, alignB: true, hlsA: 'a', hlsB: 'b', delayA: 0, delayB: 0, delayDiff: 0, ...configPatch });
  const engine = { tUs: vue.ref(1000000), authorityReady: vue.ref(false), pictureExpired: vue.ref(true), requiredSides: [], setRequiredSides(sides) { this.requiredSides = sides; } };
  const watchers = [];
  const localVue = { ...vue, onMounted() {}, onUnmounted() {}, onBeforeUnmount() {}, watch(source, callback, options) { watchers.push(callback); if (options?.immediate) callback(source()); } };
  const player = () => ({ status: PlayerStatus.IN_GAME, completedLevels: [], attempts, currentLevelIndex: 0 });
  const state = { phase: MatchPhase.IN_ROUND, currentRound: { type,
    pick: { code: 'IL1', category: 'IL', retry_count: 4 }, collection: { raw: {} } },
    playerA: player(), playerB: player(), aOnline: true, bOnline: true,
    draft: { picks: [{ code: 'IL1', by: 'A', retry: 4 }] }, liveTimeA: null, liveTimeB: null };
  const store = vue.reactive({ presentation: state, liveBroadcast: { ...state }, presentationAt: () => state });
  function evaluate(code, requireFn) {
    const mod = { exports: {} };
    const js = ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    new Function('require', 'module', 'exports', 'window', js)(requireFn, mod, mod.exports,
      { setInterval(fn) { timers.add(fn); return timers.size; }, clearInterval() {} });
    return mod.exports;
  }
  const delayed = evaluate(fs.readFileSync('src/scenes/match/useDelayedRef.ts', 'utf8'), () => localVue);
  const overrides = {
    vue: localVue,
    'vue-i18n': { useI18n: () => ({ t: x => x }) },
    '@/stores/director': { useDirectorStore: () => store },
    '@/scenes/align/useFrameAlign': { alignEngine: engine },
    '@/api/speedrun': { setSpeedrunToken() {} },
    '@/scenes/composables/useSceneContext': { useSceneContext: () => ({ hosted: true, sharedBg: true, sharedTopBar: true, params: { token: 'fixture', matchId: 'match' } }) },
    '@/scenes/composables/useDirectorConfig': { useDirectorConfig: () => ({ config, load() {}, save() {} }) },
    '@/scenes/categoryinfo/useCategoryInfo': { useCategoryInfo: () => ({ status: vue.ref('idle'), rows: vue.ref([]), pbA: vue.ref(null), pbB: vue.ref(null) }) },
    './useLiveTimers': { useLiveTimers: () => ({ liveMsA: vue.ref(null), liveMsB: vue.ref(null), liveSegA: vue.ref(null), liveSegB: vue.ref(null) }) },
    './useAlignedTiming': { useAlignedTiming: () => ({ main: vue.ref(1000), seg: vue.ref(1000), active: vue.ref(true) }) },
    './useDelayedRef': delayed,
  };
  const descriptor = parse(fs.readFileSync('src/scenes/match/MatchScene.vue', 'utf8')).descriptor;
  const code = compileScript(descriptor, { id: 'remount-test' }).content;
  const component = evaluate(code, id => {
    if (overrides[id]) return overrides[id];
    if (id.endsWith('.vue')) return {};
    return load(id.startsWith('@/') ? `src/${id.slice(2)}.ts` : path.resolve('src/scenes/match', `${id}.ts`));
  }).default;
  const bindings = component.setup({}, { expose() {} });
  return { bindings, timers, config, engine, store, updateRequiredSides: watchers[0] };
}

test('returning to match during an active single round initializes both timer panels', () => {
  const { bindings, timers } = setupScene(PickType.SINGLE);
  assert.equal(bindings.timerAV.value.level, '1/4');
  assert.equal(bindings.timerBV.value.level, '1/4');
  assert.equal(timers.size, 3);
});
test('remount after previous attempts retains attempt labels and history', () => {
  for (let mount = 0; mount < 3; mount++) {
    const { bindings } = setupScene(PickType.SINGLE, [{ index: 0, status: 1, time_ms: 1200 }]);
    assert.equal(bindings.timerAV.value.level, '2/4');
    assert.equal(bindings.timerAV.value.prevLevel, '1/4');
  }
});
test('multi-round scene setup remains valid', () => {
  assert.doesNotThrow(() => setupScene(PickType.MULTI));
});


test('decoupled scene plays each side without authority and returns to saved alignment settings', () => {
  const { bindings: b, config, engine, store, updateRequiredSides } = setupScene(PickType.MULTI, [], {
    decoupled: true, delayA: 12, delayB: 15, delayDiff: 20,
  });
  store.liveBroadcast = { ...store.liveBroadcast, subsegmentGap: 450, subsegmentGapAt: 5000 };
  assert.equal(b.seiA.value, false);
  assert.equal(b.seiB.value, false);
  assert.equal(b.waitingForAuthority.value, false);
  assert.deepEqual(engine.requiredSides, []);
  assert.equal(b.broadcast.value, store.liveBroadcast);
  assert.equal(b.twMs.value, null, 'old aligned T must not gate realtime data');
  assert.equal(b.diffV.value, 450, 'saved manual delay must not delay realtime gap');
  config.hlsB = '';
  updateRequiredSides();
  assert.equal(b.waitingForAuthority.value, false, 'missing B cannot hide independent A');
  config.decoupled = false;
  updateRequiredSides();
  assert.equal(b.seiA.value, true);
  assert.equal(b.seiB.value, false);
  assert.equal(b.waitingForAuthority.value, true);
  assert.deepEqual(engine.requiredSides, ['A']);
  assert.equal(b.broadcast.value, store.presentation);
  assert.deepEqual([config.alignA, config.alignB, config.delayA, config.delayB, config.delayDiff], [true, true, 12, 15, 20]);
});
