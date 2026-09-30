const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { parse, compileScript } = require('@vue/compiler-sfc');
const vue = require('vue');
const { createPinia, disposePinia } = require('pinia');
const createLoader = require('./load-ts.cjs');

// Compile the real SFCs; replace only unrelated mapping UI and Element Plus controls.
function mountComponent(load, filename, props) {
  function compileComponent(file) {
    const { descriptor } = parse(fs.readFileSync(file, 'utf8'), { filename: file });
    const script = compileScript(descriptor, { id: 'tb-test', inlineTemplate: true });
    const code = ts.transpileModule(script.content, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const mod = { exports: {} };
    new Function('require', 'module', 'exports', code)((id) => {
      if (id.endsWith('.vue')) {
        if (id.includes('SpeedrunMappingEditor')) return { default: { render: () => null } };
        return compileComponent(id.startsWith('@/')
          ? path.resolve('src', id.slice(2)) : path.resolve(path.dirname(file), id));
      }
      if (id === 'vue-i18n') return { useI18n: () => ({ t: key => key }) };
      return id.startsWith('@/') ? load(`src/${id.slice(2)}.ts`) : require(id);
    }, mod, mod.exports);
    return mod.exports;
  }
  const node = (text = '') => ({ children: [], style: {}, props: {}, text });
  const renderer = vue.createRenderer({
    createElement: node, createText: node, createComment: node,
    insert(child, parent, anchor) {
      if (child.parent) child.parent.children = child.parent.children.filter(n => n !== child);
      child.parent = parent;
      const index = anchor ? parent.children.indexOf(anchor) : -1;
      if (index < 0) parent.children.push(child);
      else parent.children.splice(index, 0, child);
    },
    remove(child) { child.parent.children = child.parent.children.filter(n => n !== child); },
    setText(child, text) { child.text = text; },
    setElementText(child, text) { child.text = text; },
    patchProp(child, key, previous, value) { child.props[key] = value; },
    parentNode: child => child.parent,
    nextSibling: child => child.parent?.children[child.parent.children.indexOf(child) + 1] ?? null,
  });
  let checkbox;
  const component = compileComponent(filename).default;
  const app = renderer.createApp({ render: () => vue.h(component, props) });
  app.config.globalProperties.$t = key => key;
  const passthrough = { inheritAttrs: false, setup: (_, { slots, attrs }) => () => vue.h('div', attrs, slots.default?.()) };
  for (const name of ['el-button', 'el-icon', 'el-form-item', 'el-select', 'el-tag', 'el-button-group', 'el-form']) app.component(name, passthrough);
  for (const name of ['el-input', 'el-option', 'el-input-number']) app.component(name, { render: () => null });
  app.component('el-dialog', { inheritAttrs: false, emits: ['update:modelValue'], setup: (_, { slots }) => () => [slots.default?.(), slots.footer?.()] });
  app.component('el-checkbox', {
    props: ['modelValue'], emits: ['update:modelValue'],
    setup(props, { emit }) {
      checkbox = { props, toggle: value => emit('update:modelValue', value) };
      return () => null;
    },
  });
  const root = node();
  app.mount(root);
  const text = n => [n.text, ...n.children.map(text)].join(' ');
  function find(predicate, n = root) {
    if (predicate(n)) return n;
    for (const child of n.children) { const found = find(predicate, child); if (found) return found; }
  }
  return { get checkbox() { return checkbox; }, text: () => text(root), nodeText: text, find, unmount: () => app.unmount() };
}

function mountEditor(load, pick, categoryName) {
  return mountComponent(load, 'src/components/admin/MappoolPickEditor.vue', {
    pick, index: 0, categoryName, savedTag: pick.tag ?? null,
  });
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

function editorLoader() {
  return createLoader({
    [path.resolve('src/locales.ts')]: { t: key => key },
    [path.resolve('src/stores/admin.ts')]: { useAdminStore: () => ({
      loadLevels() {}, loadCustomTags() {}, customTags: [], levels: [],
      levelById: new Map(), levelByName: new Map(),
    }) },
  });
}

for (const initialName of ['Any% Glitchless', 'Any%']) {
  test(`TB auto-check visibly requires saving: loaded name ${initialName}`, async () => {
    const pick = vue.reactive({
      code: 'TB', name: initialName, type: 1, category: 'TB', tag: null,
      collection: { raw: { name: initialName, levels: ['Intro'] } },
    });
    const editor = mountEditor(editorLoader(), pick, 'TB');
    try {
      if (initialName === 'Any%') {
        assert(!editor.text().includes('pickEditor.glitchlessAutoUnsaved'));
        pick.name = 'Any% Glitchless';
        await vue.nextTick();
      }
      assert.equal(pick.tag, 'Glitchless');
      assert.equal(editor.checkbox.props.modelValue, true);
      assert(editor.text().includes('pickEditor.glitchlessAutoUnsaved'),
        'auto-checked tag must visibly say it is not saved');
      editor.checkbox.toggle(false);
      await vue.nextTick();
      assert.equal(pick.tag, null);
      assert(!editor.text().includes('pickEditor.glitchlessAutoUnsaved'));
    } finally { editor.unmount(); }
  });
}

test('persisted TB Glitchless does not show an unsaved auto-check warning', () => {
  const pick = vue.reactive({
    code: 'TB', name: 'Any% Glitchless', type: 1, category: 'TB', tag: 'Glitchless',
    collection: { raw: { name: 'Any% Glitchless', levels: ['Intro'] } },
  });
  const editor = mountEditor(editorLoader(), pick, 'TB');
  try {
    assert.equal(editor.checkbox.props.modelValue, true);
    assert(!editor.text().includes('pickEditor.glitchlessAutoUnsaved'));
  } finally { editor.unmount(); }
});


test('legacy TB warning survives category switches; save and reopen clears it', async () => {
  let stored = {
    id: 'alpha', name: 'Alpha Test', mappool: { categories: [
      { name: 'TB', picks: [{ code: 'TB', name: 'Any% Glitchless', type: 1, category: 'TB', tag: null,
        collection: { raw: { name: 'Any% Glitchless', levels: ['Intro'] } } }] },
      { name: 'ML', picks: [{ code: 'ML1', name: 'Any%', type: 1, category: 'ML', tag: null,
        collection: { raw: { name: 'Any%', levels: ['Intro'] } } }] },
    ] },
  };
  const admin = {
    loadLevels() {}, loadCustomTags() {}, customTags: [], levels: [],
    levelById: new Map(), levelByName: new Map(),
    allowSave: false,
    async updateMappool(id, body) {
      if (!this.allowSave) return null;
      stored = JSON.parse(JSON.stringify({ id, ...body }));
      return stored;
    },
  };
  const load = createLoader({
    [path.resolve('src/locales.ts')]: { t: key => key },
    [path.resolve('src/stores/admin.ts')]: { useAdminStore: () => admin },
  });
  const props = vue.reactive({ modelValue: false, mappool: stored,
    'onUpdate:modelValue': value => { props.modelValue = value; } });
  const dialog = mountComponent(load, 'src/components/admin/MappoolFormDialog.vue', props);
  try {
    props.modelValue = true;
    await vue.nextTick();
    assert.equal(stored.mappool.categories[0].picks[0].tag, null, 'opening edits only a draft');
    assert(dialog.text().includes('pickEditor.glitchlessAutoUnsaved'));
    assert(dialog.text().includes('mappoolForm.unsavedHint'));
    // The category abbreviation is in a nested span.
    const categoryButton = name => dialog.find(n => n.props.class === 'category-item'
      && n.children.some(c => c.children?.some(t => t.text === name) || c.text === name));
    categoryButton('ML').props.onClick();
    await vue.nextTick();
    assert(dialog.text().includes('mappoolForm.unsavedHint'));
    categoryButton('TB').props.onClick();
    await vue.nextTick();
    assert(dialog.text().includes('pickEditor.glitchlessAutoUnsaved'));
    const save = dialog.find(n => n.props.type === 'primary'
      && dialog.nodeText(n).includes('mappoolForm.saveEditBtn'));
    await save.props.onClick();
    await vue.nextTick();
    assert.equal(props.modelValue, true, 'failed save leaves dialog open');
    assert(dialog.text().includes('pickEditor.glitchlessAutoUnsaved'));
    assert(dialog.text().includes('mappoolForm.unsavedHint'));
    assert.equal(stored.mappool.categories[0].picks[0].tag, null);
    admin.allowSave = true;
    await save.props.onClick();
    await vue.nextTick();
    assert.equal(stored.mappool.categories[0].picks[0].tag, 'Glitchless');
    assert.equal(props.modelValue, false);
    props.mappool = stored;
    props.modelValue = true;
    await vue.nextTick();
    assert.equal(dialog.checkbox.props.modelValue, true);
    assert(!dialog.text().includes('pickEditor.glitchlessAutoUnsaved'));
    assert(!dialog.text().includes('mappoolForm.unsavedHint'));
  } finally { dialog.unmount(); }
});
