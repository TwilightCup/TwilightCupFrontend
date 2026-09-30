const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { parse, compileScript } = require('@vue/compiler-sfc');
const vue = require('vue');
const { createPinia, disposePinia } = require('pinia');
const createLoader = require('./load-ts.cjs');

// Compile and mount the actual editor, including its checkbox v-model handler.
function mountEditor(load, pick, categoryName) {
  const filename = 'src/components/admin/MappoolPickEditor.vue';
  const { descriptor } = parse(fs.readFileSync(filename, 'utf8'), { filename });
  const script = compileScript(descriptor, { id: 'tb-test', inlineTemplate: true });
  const code = ts.transpileModule(script.content, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', code)((id) => {
    if (id.endsWith('.vue')) return { default: { render: () => null } };
    if (id === 'vue-i18n') return { useI18n: () => ({ t: key => key }) };
    return id.startsWith('@/') ? load(`src/${id.slice(2)}.ts`) : require(id);
  }, mod, mod.exports);
  const node = () => ({ children: [], style: {} });
  const renderer = vue.createRenderer({
    createElement: node, createText: node, createComment: node,
    insert(child, parent) { parent.children.push(child); },
    remove() {}, setText() {}, setElementText() {}, patchProp() {},
    parentNode: () => null, nextSibling: () => null,
  });
  let checkbox;
  const app = renderer.createApp(mod.exports.default, { pick, index: 0, categoryName });
  app.config.globalProperties.$t = key => key;
  const passthrough = { inheritAttrs: false, setup: (_, { slots }) => () => slots.default?.() };
  for (const name of ['el-button', 'el-icon', 'el-form-item', 'el-select', 'el-tag', 'el-button-group']) app.component(name, passthrough);
  for (const name of ['el-input', 'el-option', 'el-input-number']) app.component(name, { render: () => null });
  app.component('el-checkbox', {
    props: ['modelValue'], emits: ['update:modelValue'],
    setup(props, { emit }) {
      checkbox = { props, toggle: value => emit('update:modelValue', value) };
      return () => null;
    },
  });
  app.mount(node());
  return { checkbox, unmount: () => app.unmount() };
}

for (const category of ['ML', 'IL', 'CP', 'TB']) {
  test(`${category} checkbox tag survives save/load and referee submission`, async () => {
    const requests = [];
    class Socket {
      connect() {}
      disconnect() {}
      send(message) { requests.push(message); return true; }
    }
    const load = createLoader(Object.fromEntries(Object.entries({
      'src/locales.ts': { t: key => key },
      'src/stores/admin.ts': { useAdminStore: () => ({
        loadLevels() {}, levels: [], levelById: new Map(), levelByName: new Map(),
      }) },
      'src/stores/auth.ts': { useAuthStore: () => ({ token: 'test' }) },
      'src/ws/socket.ts': { MatchSocket: Socket },
      'src/api/config.ts': { restBase: 'https://frontend-test.invalid' },
    }).map(([file, value]) => [path.resolve(file), value])));
    const { api } = load('src/api/client.ts');
    const { PickType } = load('src/api/types.ts');
    const pick = vue.reactive({
      code: category === 'TB' ? 'TB' : `${category}1`, name: 'Any%',
      type: category === 'IL' ? PickType.SINGLE : PickType.MULTI, category, tag: null,
      collection: { raw: { name: 'Any%', levels: ['Intro'] } },
    });
    const editor = mountEditor(load, pick, category);
    const pinia = createPinia();
    const originalFetch = global.fetch;
    let stored;
    // Mock HTTP/WebSocket transport; execute the real REST client and match/draft stores.
    global.fetch = async (url, options) => {
      if (options.method === 'POST' || options.method === 'PATCH') {
        stored = JSON.parse(options.body);
        assert.equal(stored.mappool.categories[0].picks[0].tag, 'Glitchless');
      }
      const result = url.includes('/me/matches/')
        ? { id: 'test-match', mappool: stored.mappool, status: 1 }
        : { id: 'pool', ...stored };
      return { ok: true, text: async () => JSON.stringify(result) };
    };
    try {
      assert(editor.checkbox, 'Glitchless checkbox is visible');
      editor.checkbox.toggle(true);
      await vue.nextTick();
      assert.equal(pick.tag, 'Glitchless', 'checkbox writes persisted Pick.tag');
      assert.equal(editor.checkbox.props.modelValue, true);
      const body = { name: 'TB test', mappool: { categories: [{ name: category, picks: [pick] }] } };
      await api.createMappool(body, 'test');
      await api.updateMappool('pool', body, 'test');
      const loaded = await api.getMappool('pool', 'test');
      assert.equal(loaded.mappool.categories[0].picks[0].tag, 'Glitchless');
      const match = load('src/stores/match.ts').useMatchStore(pinia);
      match.connect('test-match');
      match.matchId = 'test-match';
      const draft = load('src/stores/draft.ts').useDraftStore(pinia);
      await draft.loadFromMatch('test-match', 'test');
      assert.equal(draft.loadError, '');
      assert.equal(draft.pickByCode(pick.code).tag, 'Glitchless');
      if (category === 'TB') draft.forceTB();
      else if (category === 'CP') draft.confirmPickWithOptions(pick.code, ['Checkpoint']);
      else draft.confirmPick(pick.code);
      assert.deepEqual(requests.find(message => message.type === 'referee_select_pick'), {
        type: 'referee_select_pick', pick_code: pick.code,
        tags: category === 'CP' ? ['Checkpoint', 'Glitchless'] : ['Glitchless'],
      });
      editor.checkbox.toggle(false);
      await vue.nextTick();
      assert.equal(pick.tag, null, 'manual uncheck clears tag');
      pick.name = 'Any% Glitchless';
      await vue.nextTick();
      assert.equal(pick.tag, 'Glitchless', 'name watcher also writes tag');
    } finally {
      global.fetch = originalFetch;
      editor.unmount();
      load('src/stores/match.ts').useMatchStore(pinia).disconnect();
      disposePinia(pinia);
    }
  });
}
