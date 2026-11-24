const { test } = require('node:test');
const assert = require('node:assert/strict');
const load = require('./load-ts.cjs')();
const { DEFAULT_SCENE_BACKGROUND, SCENE_BACKGROUND_OPTIONS, normalizeSceneBackground } = load('src/scenes/composables/useSceneBackgrounds.ts');
const { useDirectorConfig, mergeStoredConfig } = load('src/scenes/composables/useDirectorConfig.ts');

test('scene backgrounds default to synthwave and preserve every explicit option and label', () => {
  assert.equal(DEFAULT_SCENE_BACKGROUND, 'synthwave');
  for (const value of [undefined, null, '', 'invalid', 0]) {
    assert.equal(normalizeSceneBackground(value), 'synthwave');
  }
  assert.deepEqual(SCENE_BACKGROUND_OPTIONS, [
    { key: 'default', labelKey: 'scenes.backgrounds.default' },
    { key: 'synthwave', labelKey: 'scenes.backgrounds.synthwave' },
    { key: 'synthwave_gl', labelKey: 'scenes.backgrounds.synthwave_gl' },
  ]);
  for (const { key } of SCENE_BACKGROUND_OPTIONS) assert.equal(normalizeSceneBackground(key), key);
});

test('director storage, URL overrides and broadcast merges use the same background fallback', () => {
  const saved = Object.fromEntries(['localStorage', 'document', 'window'].map(k => [k, Object.getOwnPropertyDescriptor(global, k)]));
  const storage = new Map();
  const ports = {
    localStorage: { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v) },
    document: { documentElement: { style: { setProperty() {} } } },
    window: { dispatchEvent() {} },
  };
  for (const [k, value] of Object.entries(ports)) Object.defineProperty(global, k, { value, configurable: true });
  try {
    const director = useDirectorConfig();
    assert.equal(director.config.background, 'synthwave');
    for (const raw of [null, '{}', '{"background":"invalid"}', 'broken json']) {
      storage.clear();
      if (raw !== null) storage.set('twc-director-cfg:match', raw);
      director.load('match', {});
      assert.equal(director.config.background, 'synthwave');
    }
    for (const { key } of SCENE_BACKGROUND_OPTIONS) {
      director.save('match', { background: key });
      director.refresh('match');
      assert.equal(director.config.background, key);
      assert.equal(mergeStoredConfig('match', { hideA: true }).background, key);
      director.load('match', { background: key });
      assert.equal(director.config.background, key);
    }
    assert.equal(mergeStoredConfig('match', { background: undefined }).background, 'synthwave');
    assert.equal(mergeStoredConfig('match', { background: 'invalid' }).background, 'synthwave');
    director.load('match', { background: 'invalid' });
    assert.equal(director.config.background, 'synthwave');
  } finally {
    for (const [k, descriptor] of Object.entries(saved)) {
      if (descriptor) Object.defineProperty(global, k, descriptor);
      else delete global[k];
    }
  }
});
