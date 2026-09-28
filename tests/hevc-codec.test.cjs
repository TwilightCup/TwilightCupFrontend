const { test } = require('node:test');
const assert = require('node:assert/strict');
const { hvc1Codec, FrameLockStream } = require('./load-ts.cjs')()('src/scenes/align/frameLock.ts');

function config(level = 120) {
  const bytes = new Uint8Array(23);
  bytes.set([1, 1, 0x60, 0, 0, 0, 0xb0, 0, 0, 0, 0, 0, level]);
  return bytes;
}

test('HEVC Main live stream levels produce browser codec identifiers', () => {
  assert.equal(hvc1Codec(config()), 'hvc1.1.6.L120.B0');
  assert.equal(hvc1Codec(config(123)), 'hvc1.1.6.L123.B0');
});

test('HEVC preserves profile space, tier, all compatibility bits and constraint bytes', () => {
  const bytes = config(153);
  bytes[1] = 0xa2; // profile space B, high tier, Main 10
  bytes.set([0, 0, 0, 1], 2);
  bytes.set([0x90, 0, 0x0a, 0, 0, 0], 6);
  assert.equal(hvc1Codec(bytes), 'hvc1.B2.80000000.H153.90.0.A');
  bytes.fill(0, 2, 12);
  assert.equal(hvc1Codec(bytes), 'hvc1.B2.0.H153');
});

test('HEVC rejects truncated or unknown configuration records', () => {
  assert.equal(hvc1Codec(config().slice(0, 12)), null);
  const bytes = config(); bytes[0] = 2;
  assert.equal(hvc1Codec(bytes), null);
});

test('HEVC fMP4 decoder receives corrected codec and unchanged hvcC', async () => {
  const calls = [];
  const decoder = { configure: async (...args) => { calls.push(args); return true; } };
  const source = { setOnSegment() {}, setOnError() {} };
  const stream = new FrameLockStream(source);
  stream.decoder = decoder;
  const description = config(123);
  stream.encapsulation = 'avcc';
  await stream.configureDecoder('hevc', description);
  assert.equal(calls[0][0], 'hvc1.1.6.L123.B0');
  assert.equal(calls[0][1], description);
});

test('failed configuration backs off repeated seeks and retries after the deadline', async () => {
  let calls = 0;
  const stream = new FrameLockStream({ setOnSegment() {}, setOnError() {} });
  stream.decoder = { close() {}, configure: async () => { calls++; return false; }, queueSize: 0, pendingSize: 0 };
  stream.raw = [{ rtUs: 1_000_000, isKey: true, payload: new Uint8Array([0, 0, 0, 2, 0x26, 1]), epoch: 0, codec: 'hevc', description: config() }];
  stream.continuousFromUs = stream.continuousToUs = 1_000_000;
  stream.ingestBroken = false;
  stream.advance(1_000_000);
  await Promise.resolve();
  for (let i = 0; i < 100; i++) {
    assert.equal(stream.seek(1_000_000), false);
    stream.advance(1_000_000);
  }
  assert.equal(calls, 1);
  stream.decodeRetryAt = 0;
  assert.equal(stream.seek(1_000_000), true);
  stream.advance(1_000_000);
  await Promise.resolve();
  assert.equal(calls, 2);
});
