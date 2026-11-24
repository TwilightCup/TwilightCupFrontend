const { test } = require('node:test');
const assert = require('node:assert/strict');
const load = require('./load-ts.cjs')();
test('parsed frame count is numeric; waiting for authority does not imply codec failure', () => {
  const { streamWaitingText } = load('src/scenes/align/streamStatus.ts');
  assert.equal(streamWaitingText({ frames: 120, authorityUs: null, state: 'waiting', aligned: false }),
    '已解析 120 帧，等待后端权威时间；尚未启动解码');
  assert.match(streamWaitingText({ frames: 120, authorityUs: 1, state: 'stale', aligned: false }), /权威时间已失联/);
  assert(!streamWaitingText({ frames: 120, authorityUs: 1, state: 'waiting', aligned: false }).includes('不支持'));
});
test('codec probe distinguishes absent API from unsupported codec configuration', async () => {
  const { WebCodecsDecoder } = load('src/scenes/align/frameLock.ts');
  const previous = global.VideoDecoder, errors = [];
  try {
    delete global.VideoDecoder;
    const d = new WebCodecsDecoder(() => {}, e => errors.push(String(e)));
    assert.equal(await d.configure('avc1.64002a', null), false);
    assert.match(errors.pop(), /VideoDecoder.*HTTPS/);
    global.VideoDecoder = class { static async isConfigSupported() { return { supported: false }; } };
    assert.equal(await d.configure('avc1.64002a', null), false);
    assert.match(errors.pop(), /avc1.64002a/);
  } finally { global.VideoDecoder = previous; }
});
