const { test } = require('node:test');
const assert = require('node:assert/strict');
const load = require('./load-ts.cjs')();
const { timerIsAdvancing, projectTimer } = load('src/scenes/match/timerProjection.ts');
const sample = (receivedAt, totalMs, segmentMs = totalMs, levelIndex = 0) => ({ receivedAt, totalMs, segmentMs, levelIndex });

test('one-second reports produce intermediate millisecond readings at playback T', () => {
  const previous = sample(1000, 10000), current = sample(2000, 11000);
  assert(timerIsAdvancing(previous, current));
  const values = [2000, 2100, 2200, 2500, 2900].map(t => projectTimer(current, t, true).main);
  assert.deepEqual(values, [11000, 11100, 11200, 11500, 11900]);
  assert.equal(projectTimer(current, 2500, true).main, 11500, 'frozen playback T freezes the timer');
});

test('unknown, repeated, reset and changed-level reports do not establish running', () => {
  const old = sample(1000, 10000, 4000);
  for (const next of [sample(2000, 10000, 4000), sample(2000, 11000, 0), sample(2000, 11000, 5000, 1), sample(2000, 0, 0)]) {
    assert.equal(timerIsAdvancing(old, next), false);
  }
  assert.equal(timerIsAdvancing(null, old), false);
});

test('paused or completed state holds; stale extrapolation is capped and future samples stay hidden', () => {
  const s = sample(2000, 11000, 5000);
  assert.deepEqual(projectTimer(s, 2500, false), { main: 11000, seg: 5000 });
  assert.deepEqual(projectTimer(s, 10000, true), { main: 12500, seg: 6500 });
  assert.deepEqual(projectTimer(s, 1999, true), { main: null, seg: null });
  assert.deepEqual(projectTimer(null, 2500, true), { main: null, seg: null });
});

test('stage store preserves growth decisions in history rather than using the newest timer state', () => {
  const { createPage } = require('./helpers/director-page.cjs');
  const p = createPage({ id: 'timer-stage' }), oldNow = Date.now;
  let now = 1000;
  Date.now = () => now;
  try {
    const report = (total, segment = total) => p.deliver({ type: 'live_time', seat: 'PLAYER_A',
      round_id: 'round', level_index: 0, total_ms: total, segment_ms: segment });
    report(10000);
    assert.equal(p.store.presentationAt(1000).liveTimeA.advancing, false);
    now = 2000; report(11000);
    now = 3000; report(11000);
    assert.equal(p.store.presentationAt(2500).liveTimeA.advancing, true);
    assert.equal(p.store.presentationAt(3000).liveTimeA.advancing, false);
    now = 7000; report(15000);
    assert.equal(p.store.presentationAt(7000).liveTimeA.advancing, false, 'long gaps require a fresh advancing pair');
  } finally { Date.now = oldNow; p.close(); }
});
