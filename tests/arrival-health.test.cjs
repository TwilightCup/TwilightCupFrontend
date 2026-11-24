const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

for (const format of ['sample', 'annexb']) test(`${format} signal age follows arrival, not SEI or wall clock`, () => {
  let mono = 100, wall = 1700000000000;
  const info = { realtime_us: BigInt(wall - 30000) * 1000n, seq: 1, clock_ntp: false, keyframe: true };
  const load = require('./load-ts.cjs')({
    [path.resolve('src/scenes/align/sei.ts')]: {
      parseSampleSei: () => info, parseAnnexbFrames: () => [info],
    },
  });
  const { FrameLockStream } = load('src/scenes/align/frameLock.ts');
  const source = { setOnSegment() {}, setOnError() {}, harvesterStats: () => ({ retries: 0, gaveUp: 0, authFail: 0 }) };
  const oldPerformance = global.performance, oldNow = Date.now;
  try {
    global.performance = { now: () => mono }; Date.now = () => wall;
    const s = new FrameLockStream(source);
    assert.equal(s.stats().arrivalAgeMs, null);
    const receive = () => format === 'sample' ? s.onSample({ payload: new Uint8Array(), isKey: true }) : s.ingestAnnexb(new Uint8Array());
    receive(); assert.equal(s.stats().arrivalAgeMs, 0); assert.equal(s.stats().liveFps, 1);
    mono += 4100; wall -= 60000;
    assert.equal(s.stats().arrivalAgeMs, 4100); assert.equal(s.stats().liveFps, 0);
    wall += 120000; assert.equal(s.stats().arrivalAgeMs, 4100);
    receive(); assert.equal(s.stats().arrivalAgeMs, 0);
  } finally { global.performance = oldPerformance; Date.now = oldNow; }
});
