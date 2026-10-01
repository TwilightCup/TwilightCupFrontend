const { test } = require('node:test');
const assert = require('node:assert/strict');
const load = require('./load-ts.cjs')();
const { AlignEngine } = load('src/scenes/align/useFrameAlign.ts');
const { FrameQueue } = load('src/scenes/align/frameQueue.ts');

function playingEngine(fpsA, fpsB, phase) {
  const e = new AlignEngine(); e.setDelaySeconds(35);
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

test('alternating A/B frame updates remain visible for thirty seconds', () => {
  const { e, tick } = playingEngine(30, 30, 16000);
  const changes = { A: 0, B: 0 };
  for (let now = 8; now <= 30000; now += 8) {
    const before = { ...e.sync.presentedRt };
    tick(now);
    for (const side of ['A', 'B']) if (e.sync.presentedRt[side] > before[side]) changes[side]++;
    assert.equal(e.pictureExpired.value, false, `unexpected waiting mask at ${now}ms`);
  }
  assert(changes.A >= 890 && changes.B >= 890);
  assert(Math.abs(e.tUs.value - 95e6) < 50000);
});

test('repeating B while A advances cannot keep the shared picture alive', () => {
  const { e, tick } = playingEngine(30, 30, 16000);
  for (let now = 8; now <= 1000; now += 8) tick(now);
  const b = e.streams.get('B'), oldB = e.sync.presentedRt.B;
  b.queue.clear(); b.queue.add({ rtUs: oldB, isKey: false, handle: {} });
  b.advance = () => {}; b.seek = () => {};
  e.streams.get('A').seek = () => {};
  const oldA = e.sync.presentedRt.A;
  for (let now = 1008; now <= 11008; now += 8) tick(now);
  assert(e.sync.presentedRt.A > oldA, 'A advances while B repeats');
  assert.equal(e.sync.presentedRt.B, oldB);
  assert.equal(e.pictureExpired.value, true);
});

test('frame interval retains committed T and picture age, but reset still waits for the old picture', () => {
  const { e, tick } = playingEngine(30, 30, 6200);
  e.sync.presentedRt.A = e.sync.presentedRt.B = 65e6 + 200000;
  e.lastPictureAt.A = e.lastPictureAt.B = 0;
  tick(16); tick(32);
  assert.equal(e.tUs.value, 65e6);
  assert.deepEqual(e.lastPictureAt, { A: 0, B: 0 });
  assert.equal(e.sync.state, 'playing');
  assert(e.sync.targetUs > 65e6 + 16000);
  e.beginTimeline(64e6);
  tick(48);
  assert.equal(e.tUs.value, 65e6);
  assert.equal(e.sync.state, 'frozen');
  assert.equal(e.sync.reason, 'authority_behind_or_paused');
});

for (const [a,b,phase] of [[30,30,6200],[30,60,7100],[60,60,12000]]) {
 test(`completed reset preserves cadence at ${a}/${b}fps without seeking`,()=>{
  const {e,tick}=playingEngine(a,b,phase);
  e.finishTimeline('completed',65e6);
  e.latestSeek=65e6;
  for(let now=8;now<=6000;now+=8) {
   tick(now);
   assert.equal(e.sync.state,'playing',`${now}: ${e.sync.reason}`);
  }
  assert(Math.abs(e.tUs.value-71e6)<60000,`lost time: ${e.tUs.value}`);
  assert.equal(e.sync.seekCount,0);
 });
}

test('completed reset still expires the picture when one stream genuinely stops',()=>{
 const {e,tick}=playingEngine(30,30,6200);
 e.finishTimeline('completed',65e6);e.latestSeek=65e6;
 for(let now=8;now<=1000;now+=8)tick(now);
 const b=e.streams.get('B');b.advance=()=>{};
 for(const s of e.streams.values())s.seek=()=>{};
 for(let now=1008;now<=12000;now+=8)tick(now);
 assert.equal(e.sync.state,'frozen');
 assert.equal(e.pictureExpired.value,true);
});

for(const gap of [8,200,2000]) {
 test(`completed reset resumes after ${gap}ms of missing decoder output`,()=>{
  const {e,tick}=playingEngine(30,30,6200);
  e.finishTimeline('completed',65e6);e.latestSeek=65e6;
  for(const stream of e.streams.values())stream.seek=()=>{};
  for(let now=8;now<=1000;now+=8)tick(now);
  const before=e.tUs.value,b=e.streams.get('B'),advance=b.advance;
  b.queue.clear();b.advance=()=>{};
  for(let now=1008;now<=1000+gap;now+=8)tick(now);
  b.advance=advance;
  const seeks=e.sync.seekCount;
  for(let now=1008+gap;now<=5000+gap;now+=8)tick(now);
  assert.equal(e.sync.state,'playing',e.sync.reason);
  assert(e.tUs.value>before+3.8e6,`clock stayed at ${e.tUs.value}`);
  assert(e.sync.seekCount<=seeks+1,'recovery must not repeatedly rebuild the decoder');
  assert.equal(e.pictureExpired.value,false);
 });
}
