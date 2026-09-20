const { test } = require('node:test');
const assert = require('node:assert/strict');
const load = require('./load-ts.cjs')();
test('only backend-selected connection can publish; old role messages cannot promote', () => {
  const { AuthorityRole } = load('src/scenes/align/authorityRole.ts');
  const pages = ['a','b','c'].map(id => { const r = new AuthorityRole(); r.connect(id); return r; });
  pages.forEach((r,i) => assert(r.assign({ connection_id: ['a','b','c'][i], src:'a', epoch:10, role:i ? 'follower':'publisher' })));
  assert.deepEqual(pages.map(r=>r.publisher),[true,false,false]);
  assert(!pages[1].assign({connection_id:'b',src:'a',epoch:11,role:'publisher'}));
  assert(pages[1].assign({connection_id:'b',src:'b',epoch:11,role:'publisher'}));
  assert(!pages[1].assign({connection_id:'b',src:'a',epoch:10,role:'follower'}));
  pages[1].disconnect(); assert(!pages[1].publisher);
  pages[1].connect('d');
  assert(!pages[1].assign({connection_id:'b',src:'b',epoch:12,role:'publisher'}));
});
test('publisher bootstraps without external T; followers cannot; safety floor survives takeover', () => {
  const { publisherTarget } = load('src/scenes/align/rateControl.ts');
  assert.equal(publisherTarget(0,100e6,null),65e6);
  assert.equal(publisherTarget(80e6,100e6,null),null);
  assert.equal(publisherTarget(0,100e6,75e6),null);
  assert.equal(publisherTarget(0,110e6,75e6),75e6);
});

test('a sole cold director can confirm takeover at a safe floor before its deadline', () => {
  const { AlignEngine } = load('src/scenes/align/useFrameAlign.ts');
  const { FrameQueue } = load('src/scenes/align/frameQueue.ts');
  const { AuthorityRole } = load('src/scenes/align/authorityRole.ts');
  const { FrameLeaseClient } = load('src/scenes/align/frameLeaseClient.ts');
  const e = new AlignEngine(); e.setRequiredSides(['A', 'B']);
  for (const side of ['A', 'B']) e.streams.set(side, {
    queue: new FrameQueue(), coverage: () => ({ from: 0, to: 100e6 }),
    canSeek: () => true, seek() { this.queue.clear(); return true; },
    advance(t) { this.queue.add({ rtUs: t, isKey: true, handle: {} }); },
  });
  e.selectAuthority(null, 1); e.setAuthorityFloor(68e6);
  assert(e.setExternalTUs(68e6, { epoch: 1, seq: 0, src: null, frozen: true }));
  assert(e.leaseSample(0).decode_ready); assert.equal(e.tUs.value, null);
  const role = new AuthorityRole(); role.connect('director');
  const assignment = { connection_id: 'director', src: 'director', role: 'publisher',
    epoch: 2, lease_required: true, t_floor_us: 68e6, takeover_timeout_ms: 3000 };
  assert(role.assign(assignment));
  const lease = new FrameLeaseClient(); lease.observe(assignment, role, 0);
  e.selectAuthority('director', 2); e.setPublisher(true);
  for (let now = 0; now <= 500; now += 25) {
    e.tickLoop(now); lease.report(role, 'account', 'match', e.leaseSample(now), 'visible', now);
  }
  assert(lease.canPublish(role)); assert(e.tUs.value >= 68e6);
  assert(e.tUs.value <= 68.8e6); assert.equal(e.sync.state, 'playing');
});

test('elected publisher starts both frames; two followers wait then track its anchor', () => {
  const { AlignEngine } = load('src/scenes/align/useFrameAlign.ts');
  const { FrameQueue } = load('src/scenes/align/frameQueue.ts');
  function page() {
    const e = new AlignEngine(); e.setRequiredSides(['A','B']);
    for (const side of ['A','B']) {
      const queue = new FrameQueue();
      e.streams.set(side, { queue, coverage:()=>({from:0,to:100e6}), canSeek:()=>true,
        seek() { queue.clear(); return true; }, advance(t) { queue.add({rtUs:t,isKey:true,handle:{}}); } });
    }
    return e;
  }
  const [main,a,b] = [page(),page(),page()]; main.setPublisher(true);
  for (let t=0;t<=320;t+=16) for (const e of [main,a,b]) e.tickLoop(t);
  assert(main.tUs.value >=65e6); assert.equal(a.tUs.value,null); assert.equal(b.tUs.value,null);
  const anchor={t_us:Math.floor(main.tUs.value),epoch:1,seq:1,rate:1};
  a.external.accept(anchor,320); b.external.accept(anchor,320);
  for (let t=336;t<=656;t+=16) {a.tickLoop(t); b.tickLoop(t);}
  assert.equal(a.tUs.value,b.tUs.value); assert(a.tUs.value>=anchor.t_us);
  const before=main.tUs.value; main.resetClockConnection(); main.tickLoop(672);
  assert.equal(main.tUs.value,before); assert.equal(main.playback.speed,0);
  a.setPublisher(true); a.authorityFloor=80e6; a.tickLoop(672);
  assert(a.tUs.value<80e6); assert.equal(a.playback.speed,0);
});
