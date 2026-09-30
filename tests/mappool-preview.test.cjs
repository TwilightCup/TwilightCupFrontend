const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { parse, compileScript } = require('@vue/compiler-sfc');
const { compile } = require('@vue/compiler-dom');
const vue = require('vue');
const createLoader = require('./load-ts.cjs');

function preview(getMappool) {
  const filename = 'src/views/admin/MappoolPreviewView.vue';
  const { descriptor } = parse(fs.readFileSync(filename, 'utf8'), { filename });
  const scope = vue.effectScope();
  const route = vue.reactive({ params: { id: 'alpha' } });
  const load = createLoader({
    [path.resolve('src/locales.ts')]: { t: key => key },
    [path.resolve('src/api/client.ts')]: { api: { getMappool } },
    [path.resolve('src/stores/auth.ts')]: { useAuthStore: () => ({ token: 'test' }) },
    [path.resolve('src/stores/admin.ts')]: { useAdminStore: () => ({
      loadLevels() {}, levelById: new Map([['level-id', { name: 'Intro', display_name: 'Intro display' }]]),
      levelByName: new Map(),
    }) },
  });
  const code = ts.transpileModule(compileScript(descriptor, { id: 'preview-test' }).content, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', code)(id => {
    if (id === 'vue-router') return { useRoute: () => route, useRouter: () => ({ push() {} }) };
    return id.startsWith('@/') ? load(`src/${id.slice(2)}.ts`) : require(id);
  }, mod, mod.exports);
  const state = scope.run(() => mod.exports.default.setup({}, { expose() {} }));
  const render = new Function('Vue', compile(descriptor.template.content, { mode: 'function' }).code)({
    ...vue, resolveComponent: name => name,
  });
  const context = vue.proxyRefs({ ...state, $t: key => key });
  function text(n) {
    if (typeof n === 'string') return n;
    if (Array.isArray(n)) return n.map(text).join(' ');
    return [n?.props?.title ?? '', n?.props?.description ?? '', text(n?.children ?? '')].join(' ');
  }
  return { state, route, text: () => text(render(context, [])), stop: () => scope.stop() };
}

const tick = async () => { await new Promise(resolve => setImmediate(resolve)); await vue.nextTick(); };
const pool = tag => ({ name: 'Alpha Test', created_at: '2026-08-15T13:46:44Z', mappool: { categories: [
  { name: 'TB', picks: [{ code: 'TB', name: 'Any% Glitchless', type: 1, tag,
    collection: { raw: { levels: ['level-id', '123456'] } } }] },
] } });

test('read-only preview renders saved TB tags without inferring Glitchless from the name', async () => {
  for (const tag of [null, 'Glitchless']) {
    const source = pool(tag), before = JSON.stringify(source), requests = [];
    const view = preview(async (id, token) => { requests.push([id, token]); return source; });
    try {
      await tick();
      const output = view.text();
      assert(output.includes('Any% Glitchless'));
      assert(output.includes('Intro display'));
      assert(output.includes('123456'));
      assert.deepEqual(view.state.pickTagTokens(view.state.pool.value.mappool.categories[0].picks[0]), tag ? [tag] : []);
      assert.equal(JSON.stringify(source), before, 'preview must not change loaded data');
      assert.deepEqual(requests, [['alpha', 'test']]);
      assert(!output.includes('mappoolForm.saveEditBtn'));
      assert(!output.includes('pickEditor.glitchlessAutoUnsaved'));
    } finally { view.stop(); }
  }
});

test('preview shows loading/errors and permits retry; stale route responses cannot replace current pool', async () => {
  let resolveOld;
  const old = new Promise(resolve => { resolveOld = resolve; });
  let fail = true;
  const view = preview(id => {
    if (id === 'alpha') return old;
    if (fail) return Promise.reject(new Error('404'));
    return Promise.resolve({ ...pool(null), name: 'New pool' });
  });
  try {
    assert(view.text().includes('common.loading'));
    view.route.params.id = 'beta';
    await tick();
    assert(view.text().includes('admin.mappools.previewLoadError'));
    fail = false;
    await view.state.load();
    assert(view.text().includes('New pool'));
    resolveOld(pool('Glitchless'));
    await tick();
    assert.equal(view.state.pool.value.name, 'New pool');
    assert(!view.text().includes('admin.mappools.previewLoadError'));
  } finally { view.stop(); }
});
