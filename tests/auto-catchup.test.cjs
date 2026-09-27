const {test}=require('node:test');
const assert=require('node:assert/strict');
const {AutoCatchup}=require('./load-ts.cjs')()('src/scenes/align/autoCatchup.ts');
test('strict initial delta+15 threshold and delta+5 target, with hysteresis and cooldown',()=>{
 for(const delta of [0,10,20,30]) {
  const g=new AutoCatchup(delta), threshold=100000+(delta+15)*1000;
  assert.equal(g.targetSeconds,delta+5);
  assert(!g.check(100e6,threshold,0,true));
  assert(g.check(100e6,threshold+1,1,true));
  assert(!g.check(100e6,threshold+20000,20000,true));
  assert(!g.check(100e6,100000+(delta+5)*1000,20001,true));
  assert(g.check(100e6,threshold+1,20002,true));
  assert(!g.check(100e6,100000+(delta+5)*1000,20003,true));
  assert(!g.check(100e6,threshold+1,20004,true));
  assert(g.check(100e6,threshold+1,35002,true));
  assert.equal(g.targetSeconds,delta+5);
 }
});
test('ineligible playback cannot trigger or rearm',()=>{
 const g=new AutoCatchup(10);
 assert(!g.check(100e6,126000,0,false));
 assert(g.check(100e6,126000,1,true));
 assert(!g.check(110e6,125000,20000,false));
 assert(!g.check(110e6,140000,30000,true));
});
test('automatic target requires seekable coverage on both streams',()=>{
 const {AlignEngine}=require('./load-ts.cjs')()('src/scenes/align/useFrameAlign.ts');
 const e=new AlignEngine();e.setRequiredSides(['A','B']);
 e.streams.set('A',{coverage:()=>({from:80e6,to:100e6}),canSeek:()=>true});
 e.streams.set('B',{coverage:()=>({from:80e6,to:94e6}),canSeek:()=>true});
 assert(!e.canAutoSeek(95e6));assert(e.canAutoSeek(90e6));
 e.streams.get('B').canSeek=()=>false;assert(!e.canAutoSeek(90e6));
});
