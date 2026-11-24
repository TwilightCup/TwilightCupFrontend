const { test } = require('node:test');
const assert = require('node:assert/strict');
const load = require('./load-ts.cjs')();
const { useDirectorConfig, mergeStoredConfig } = load('src/scenes/composables/useDirectorConfig.ts');
const { useSceneParams } = load('src/scenes/composables/useSceneParams.ts');

test('decoupled mode persists per match, accepts broadcast updates and explicit URL overrides', () => {
  const saved = Object.fromEntries(['localStorage', 'document', 'window', 'location'].map(k => [k, Object.getOwnPropertyDescriptor(global, k)]));
  const storage = new Map();
  const ports = {
    localStorage: { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v) },
    document: { documentElement: { style: { setProperty() {} } } },
    window: { dispatchEvent() {} },
    location: { search: '?decoupled=true' },
  };
  for (const [k, value] of Object.entries(ports)) Object.defineProperty(global, k, { value, configurable: true, writable: true });
  try {
    const consoleConfig = useDirectorConfig();
    consoleConfig.load('match', {});
    assert.equal(consoleConfig.config.decoupled, false);
    consoleConfig.save('match', { decoupled: true, alignA: true, alignB: false, delayA: 12 });
    const stageConfig = useDirectorConfig();
    stageConfig.load('match', {});
    assert.equal(stageConfig.config.decoupled, true);
    stageConfig.load('other-match', {});
    assert.equal(stageConfig.config.decoupled, false);
    stageConfig.load('match', useSceneParams());
    assert.equal(stageConfig.config.decoupled, true);
    global.location.search = '?decoupled=false';
    stageConfig.load('match', useSceneParams());
    assert.equal(stageConfig.config.decoupled, false);
    mergeStoredConfig('match', { decoupled: true });
    stageConfig.refresh('match');
    assert.equal(stageConfig.config.decoupled, true);
    mergeStoredConfig('match', { decoupled: false });
    stageConfig.refresh('match');
    assert.deepEqual([stageConfig.config.decoupled, stageConfig.config.alignA, stageConfig.config.alignB, stageConfig.config.delayA], [false, true, false, 12]);
  } finally {
    for (const [k, descriptor] of Object.entries(saved)) {
      if (descriptor) Object.defineProperty(global, k, descriptor);
      else delete global[k];
    }
  }
});
