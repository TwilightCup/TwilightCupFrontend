// Execute repository TypeScript in memory: no generated files or additional dependencies.
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
module.exports = function createLoader(overrides = {}) {
  const cache = new Map();
  function load(file) {
    file = path.resolve(file);
    if (overrides[file]) return overrides[file];
    if (cache.has(file)) return cache.get(file).exports;
    const mod = { exports: {} };
    cache.set(file, mod);
    const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    new Function('require', 'module', 'exports', code)((id) => {
      if (id.startsWith('.')) return load(path.resolve(path.dirname(file), id + '.ts'));
      if (id.startsWith('@/')) return load(path.resolve('src', id.slice(2) + '.ts'));
      return require(id);
    }, mod, mod.exports);
    return mod.exports;
  }
  return load;
};
