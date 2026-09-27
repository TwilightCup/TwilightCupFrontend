const { test } = require('node:test');
const assert = require('node:assert/strict');
const load = require('./load-ts.cjs')();
const { AlignEngine } = load('src/scenes/align/useFrameAlign.ts');
const { FrameQueue } = load('src/scenes/align/frameQueue.ts');

function playingEngine(fpsA, fpsB, phase) {
  const e = new AlignEngine();
  e.setPublisher(true); e.setRequiredSides(['A', 'B']);
  e.tUs.value = 65e6; e.sync.state = 'playing';
  let now = 0;
  for (const [side, fps, offset] of [['A', fpsA, 0], ['B', fpsB, phase]]) {
    const queue = new FrameQueue();
    e.presented[side] = true; e.sync.presentedRt[side] = 65e6 - 40000;
    e.streams.set(side, {
      queue, coverage: () => ({ from: 0, to: 100e6 + now * 1000 }),
      canSeek: () => true, seek() { assert.fail('steady playback must not seek'); },
      advance(t) {
        queue.advance(t);
        const period = 1e6 / fps, center = Math.floor((t - offset) / period);
        for (let i = center - 3; i <= center + 8; i++) {
          const rtUs = Math.round(i * period + offset);
          if (!queue.has(rtUs)) queue.add({ rtUs, isKey: false, handle: {} });
        }
      },
    });
  }
  return { e, tick(t) { now = t; e.tickLoop(t); } };
}

for (const [a, b, phase] of [[30, 30, 6200], [30, 60, 7100], [60, 60, 12000]]) {
  test(`publisher retains elapsed time across ${a}/${b}fps frame intervals`, () => {
    const { e, tick } = playingEngine(a, b, phase);
    let held = 0, previous = e.tUs.value;
    for (let now = 8; now <= 6000; now += 8) {
      tick(now);
      assert.equal(e.sync.state, 'playing');
      assert(e.presented.A && e.presented.B);
      assert(e.tUs.value >= previous);
      if (e.tUs.value === previous) held++;
      previous = e.tUs.value;
      assert(e.sync.pairErrorUs == null || e.sync.pairErrorUs <= 3e6);
    }
    assert(held > 0, 'exercise frames ahead of the shared target');
    assert(Math.abs(e.tUs.value - 71e6) < 50000, `lost playback time: ${e.tUs.value}`);
    assert.equal(e.sync.seekCount, 0);
  });
}

test('frame interval retains committed T and picture age, but reset still waits for the old picture', () => {
  const { e, tick } = playingEngine(30, 30, 6200);
  e.sync.presentedRt.A = e.sync.presentedRt.B = 65e6 + 200000;
  e.lastPictureAt = 0;
  tick(16); tick(32);
  assert.equal(e.tUs.value, 65e6);
  assert.equal(e.lastPictureAt, 0);
  assert.equal(e.sync.state, 'playing');
  assert(e.sync.targetUs > 65e6 + 16000);
  e.beginTimeline(64e6);
  tick(48);
  assert.equal(e.tUs.value, 65e6);
  assert.equal(e.sync.state, 'frozen');
  assert.equal(e.sync.reason, 'authority_behind_or_paused');
});
