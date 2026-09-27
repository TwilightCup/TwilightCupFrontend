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
function setupScene(type, attempts = []) {
  const timers = new Set();
  const localVue = { ...vue, onMounted() {}, onUnmounted() {}, onBeforeUnmount() {}, watch() {} };
  const player = () => ({ status: PlayerStatus.IN_GAME, completedLevels: [], attempts, currentLevelIndex: 0 });
  const state = { phase: MatchPhase.IN_ROUND, currentRound: { type,
    pick: { code: 'IL1', category: 'IL', retry_count: 4 }, collection: { raw: {} } },
    playerA: player(), playerB: player(), aOnline: true, bOnline: true,
    draft: { picks: [{ code: 'IL1', by: 'A', retry: 4 }] }, liveTimeA: null, liveTimeB: null };
  const store = { presentation: state, liveBroadcast: state, presentationAt: () => state };
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
    '@/api/speedrun': { setSpeedrunToken() {} },
    '@/scenes/composables/useSceneContext': { useSceneContext: () => ({ hosted: true, sharedBg: true, sharedTopBar: true, params: { token: 'fixture', matchId: 'match' } }) },
    '@/scenes/composables/useDirectorConfig': { useDirectorConfig: () => ({ config: { alignA: true, alignB: true, hlsA: 'a', hlsB: 'b', delayA: 0, delayB: 0, delayDiff: 0 }, load() {}, save() {} }) },
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
  return { bindings, timers };
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
