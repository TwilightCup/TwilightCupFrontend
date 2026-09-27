const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const { parse, compileScript } = require('@vue/compiler-sfc');
const vue = require('vue');

// Run the real host setup. Any attempt to acquire media from the host fails;
// media belongs to the dynamically mounted MatchScene children instead.
function mountStage(scene) {
  const store = vue.reactive({ currentSceneCmd: scene, matchId: 'match', accountId: 'account',
    remoteConfig: { alignA: true, alignB: true, hlsA: 'a', hlsB: 'b' },
    connect() {}, disconnect() {} });
  const mounted = [];
  const components = {};
  const source = fs.readFileSync('src/scenes/stage/StageScene.vue', 'utf8');
  const script = compileScript(parse(source).descriptor, { id: 'stage-lifecycle' }).content;
  const code = ts.transpileModule(script, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  const requireMock = id => {
    if (id === 'vue') return { ...vue, provide() {}, onMounted(fn) { mounted.push(fn); }, onUnmounted() {} };
    if (id === '@/stores/director') return { useDirectorStore: () => store };
    if (id.endsWith('useSceneParams')) return { useSceneParams: () => ({}) };
    if (id.endsWith('useSceneContext')) return { SCENE_CONTEXT_KEY: Symbol() };
    if (id.endsWith('bilingual')) return { bi: key => key };
    if (id === './useStageScene') return {
      isSceneKey: s => ['match', 'soon', 'bracket', 'mappool', 'categoryinfo'].includes(s),
      readStoredScene: () => null, sceneStorageKey: () => 'fixture',
    };
    if (id.endsWith('.vue')) return { default: components[id] ??= { name: id } };
    throw new Error(`Unexpected stage dependency: ${id}`);
  };
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', 'window', code)(requireMock, mod, mod.exports,
    { addEventListener() {}, removeEventListener() {} });
  const scope = vue.effectScope();
  const bindings = scope.run(() => {
    const result = mod.exports.default.setup({}, { expose() {} });
    mounted.forEach(fn => fn());
    return result;
  });
  return { store, bindings, stop: () => scope.stop() };
}

test('stage restores non-match scene without owning background media, and can return to match', async () => {
  const stage = mountStage('soon');
  try {
    assert.match(stage.bindings.activeComponent.value.name, /SoonScene/);
    for (const scene of ['match', 'mappool', 'bracket', 'categoryinfo', 'soon', 'match']) {
      stage.store.currentSceneCmd = scene;
      await vue.nextTick();
      assert.equal(stage.bindings.currentScene.value, scene);
      assert.equal(stage.bindings.activeComponent.value, stage.bindings.sceneMap[scene]);
    }
  } finally { stage.stop(); }
});
