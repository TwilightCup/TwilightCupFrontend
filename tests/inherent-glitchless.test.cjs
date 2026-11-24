const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

// utils/mappool.ts imports the i18n entry (vue-i18n); stub it for a pure unit load.
const load = require('./load-ts.cjs')({ [path.resolve('src/locales.ts')]: { t: (k) => k } });
const {
  GLITCHLESS_TAG,
  inherentPickTags,
  mergeInherentTags,
  pickTagTokens,
  setGlitchlessTag,
  supportsGlitchless,
} = load('src/utils/mappool.ts');

const pick = (category, tag) => ({
  code: 'X',
  name: 'n',
  type: 2,
  collection: { raw: {} },
  category,
  tag,
});

test('Glitchless inherent tag is scoped to ML/IL/CP/TB', () => {
  for (const k of ['ML', 'IL', 'CP', 'TB']) {
    assert(supportsGlitchless(k));
    assert.deepEqual(inherentPickTags(pick(k, 'Glitchless')), [GLITCHLESS_TAG]);
  }
  for (const k of ['CT', 'EX', null, undefined, 'ZZ']) {
    assert.equal(supportsGlitchless(k), false);
    assert.deepEqual(inherentPickTags(pick(k, 'Glitchless')), []);
  }
});

test('inherent tag ignores unrelated tokens and whitespace', () => {
  assert.deepEqual(pickTagTokens(pick('ML', ' Foo , Glitchless ,, ')), ['Foo', 'Glitchless']);
  assert.deepEqual(inherentPickTags(pick('ML', 'Foo')), []);
  assert.deepEqual(inherentPickTags(pick('ML', 'glitchless')), []);
});

test('setGlitchlessTag toggles Glitchless while preserving other tokens', () => {
  const p = pick('IL', 'Foo, Glitchless');
  setGlitchlessTag(p, false);
  assert.equal(p.tag, 'Foo');
  setGlitchlessTag(p, true);
  assert.equal(p.tag, 'Foo,Glitchless');
  const q = pick('CP', null);
  setGlitchlessTag(q, true);
  assert.equal(q.tag, 'Glitchless');
  setGlitchlessTag(q, false);
  assert.equal(q.tag, null);
});

test('mergeInherentTags appends Glitchless after referee tags, deduped', () => {
  assert.deepEqual(mergeInherentTags(['Checkpoint'], pick('CP', 'Glitchless')), [
    'Checkpoint',
    'Glitchless',
  ]);
  assert.deepEqual(mergeInherentTags(['Glitchless'], pick('ML', 'Glitchless')), ['Glitchless']);
  assert.deepEqual(mergeInherentTags(['No EC'], pick('CT', 'Glitchless')), ['No EC']);
});
