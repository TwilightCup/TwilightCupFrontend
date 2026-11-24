const { test } = require('node:test');
const assert = require('node:assert/strict');
const load = require('./load-ts.cjs')();
const { AlignEngine } = load('src/scenes/align/useFrameAlign.ts');
const { FrameQueue } = load('src/scenes/align/frameQueue.ts');
const { PlaybackRecovery } = load('src/scenes/align/playbackRecovery.ts');

function stalledEngine(completedReset) {
  const engine = new AlignEngine();
  engine.setRequiredSides(['A', 'B']);
  engine.setPublisher(true);
  engine.tUs.value = 65e6;
  engine.sync.state = 'playing';
  for (const side of ['A', 'B']) {
    engine.presented[side] = true;
    engine.sync.presentedRt[side] = 65e6;
    engine.streams.set(side, {
      queue: new FrameQueue(), available: side === 'A', seeks: [],
      coverage: () => ({ from: 0, to: 120e6 }), canSeek: () => true,
      seek(target) { this.seeks.push(target); this.queue.clear(); return true; },
      advance(target) {
        if (this.available) this.queue.add({ rtUs: target, isKey: true, handle: {} });
      },
    });
  }
  if (completedReset) engine.finishTimeline('completed', 65e6);
  return engine;
}

for (const completedReset of [false, true]) {
  test(`local recovery precedes reload, retries cannot extend grace (reset=${completedReset})`, () => {
    const engine = stalledEngine(completedReset), watchdog = new PlaybackRecovery();
    let firstSeekAt = null, escalationAt = null;
    watchdog.check(0, [65e6, 65e6], true);
    for (let now = 100; now <= 9000; now += 100) {
      engine.tickLoop(now);
      if (firstSeekAt == null && engine.sync.seekCount > 0) firstSeekAt = now;
      const escalate = watchdog.check(now, [engine.sync.presentedRt.A, engine.sync.presentedRt.B],
        true, engine.localRecoveryPending(now));
      if (now === 4000) assert(!escalate);
      if (escalate) { escalationAt = now; break; }
    }
    assert(firstSeekAt != null);
    assert.equal(escalationAt, Math.max(4000, firstSeekAt + 5000));
    assert.equal(engine.tUs.value, 65e6);
    if (completedReset) assert(engine.sync.seekCount > 1);
    assert(!watchdog.check(escalationAt + 4000, [65e6, 65e6], true));
  });

  test(`successful local recovery cancels escalation (reset=${completedReset})`, () => {
    const engine = stalledEngine(completedReset), watchdog = new PlaybackRecovery();
    let recovering = false;
    watchdog.check(0, [65e6, 65e6], true);
    for (let now = 100; now <= 8000; now += 100) {
      if (now === 3000) engine.streams.get('B').available = true;
      engine.tickLoop(now);
      recovering ||= engine.localRecoveryPending(now);
      assert(!watchdog.check(now, [engine.sync.presentedRt.A, engine.sync.presentedRt.B],
        true, engine.localRecoveryPending(now)));
    }
    assert(recovering);
    assert(!engine.localRecoveryPending(8000));
    assert.equal(engine.sync.state, 'playing');
    assert(engine.tUs.value > 65e6);
  });
}

test('partial progress retains grace; both sides progressing clears it', () => {
  const engine = stalledEngine(false);
  engine.beginLocalRecovery(1000);
  engine.recordPictureProgress(2000, ['A', 'B'], [{ rtUs: 66e6 }, { rtUs: 65e6 }]);
  assert(engine.localRecoveryPending(2000));
  engine.recordPictureProgress(2100, ['A', 'B'], [{ rtUs: 66e6 }, { rtUs: 66e6 }]);
  assert(!engine.localRecoveryPending(2100));
});

test('timeline, connection, role, source and membership changes clear local recovery', () => {
  for (const reset of [engine => engine.beginTimeline(70e6), engine => engine.resetClockConnection(),
    engine => engine.setPublisher(false), engine => engine.resetPresented('A'),
    engine => engine.setRequiredSides(['A'])]) {
    const engine = stalledEngine(false);
    engine.beginLocalRecovery(1000);
    assert(engine.localRecoveryPending(1000));
    reset(engine);
    assert(!engine.localRecoveryPending(1000));
  }
});
