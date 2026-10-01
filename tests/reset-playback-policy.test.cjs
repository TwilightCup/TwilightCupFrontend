const {test}=require('node:test');
const assert=require('node:assert/strict');
const load=require('./load-ts.cjs')();
const {AlignEngine}=load('src/scenes/align/useFrameAlign.ts');
const {FrameQueue}=load('src/scenes/align/frameQueue.ts');
function engine(){
 const e=new AlignEngine();e.setDelaySeconds(35);e.setPublisher(true);e.setRequiredSides(['A','B']);
 e.tUs.value=65e6;e.sync.state='playing';
 for(const side of ['A','B']){
  e.presented[side]=true;e.sync.presentedRt[side]=65e6;e.lastPictureAt[side]=0;
  e.streams.set(side,{queue:new FrameQueue(),seeks:0,
   coverage:()=>({from:0,to:110e6}),canSeek:()=>true,
   seek(){this.seeks++;this.queue.clear();},
   advance(t){this.queue.add({rtUs:t,isKey:true,handle:{}});}});
 }
 return e;
}
test('completed reset uses the ordinary publisher soft correction and shared frame commits',()=>{
 const ordinary=engine(),completed=engine();completed.finishTimeline('completed',65e6);
 const latest=completed.presentLatest.bind(completed);
 completed.presentLatest=()=>assert.fail('completed publisher must not use follower/reset preparation policy');
 for(let now=16;now<=2000;now+=16){
  ordinary.tickLoop(now);completed.tickLoop(now);
  assert.equal(completed.tUs.value,ordinary.tUs.value);
  assert.equal(completed.playback.speed,ordinary.playback.speed);
  assert.deepEqual(completed.sync.presentedRt,ordinary.sync.presentedRt);
  assert.equal(completed.sync.seekCount,0);
 }
 assert(completed.playback.speed>1 && completed.playback.speed<=1.08);
 completed.presentLatest=latest;
});
test('completed reset permits brief B frame reuse while A advances within existing tolerance',()=>{
 const e=engine();e.finishTimeline('completed',65e6);
 const b=e.streams.get('B');b.queue.add({rtUs:65e6,isKey:true,handle:{}});b.advance=()=>{};
 e.tickLoop(16);
 assert.equal(e.sync.state,'playing');assert(e.tUs.value>65e6);
 assert(e.sync.presentedRt.A>65e6);assert.equal(e.sync.presentedRt.B,65e6);
 assert.equal(e.sync.seekCount,0);
});
test('completion preserves actual reset picture floor and never re-seeks a confirmed frame',()=>{
 const e=engine();e.beginTimeline(70e6);e.tickLoop(16);
 assert.equal(e.resetPresentedUs.value,70e6);
 const seekCount=e.sync.seekCount;e.finishTimeline('completed',70e6);
 for(let now=32;now<=1000;now+=16){e.tickLoop(now);assert(e.tUs.value>=70e6);}
 assert.equal(e.sync.seekCount,seekCount);
 assert(e.tUs.value>70e6);assert.equal(e.resetPresentedUs.value,70e6);
});
test('completed snapshot target older than the picture never replays backwards',()=>{
 const e=engine();e.streams.forEach(s=>s.coverage=()=>({from:0,to:99e6}));
 e.beginTimeline(60e6);e.finishTimeline('completed',60e6);
 for(let now=16;now<=1000;now+=16){e.tickLoop(now);assert(e.tUs.value>=65e6);assert(e.sync.presentedRt.A>=65e6);}
});
test('ordinary and completed-reset publishers recover identically after a missing B frame interval',()=>{
 for(const gap of [16,200,2000]) {
  const ordinary=engine(),completed=engine();completed.finishTimeline('completed',65e6);
  const pages=[ordinary,completed],advance=pages.map(e=>e.streams.get('B').advance);
  for(let now=16;now<=5000;now+=16) {
   for(let i=0;i<pages.length;i++) {
    const e=pages[i],b=e.streams.get('B');
    if(now===1008) b.queue.clear();
    b.advance=now>=1008 && now<1008+gap ? ()=>{} : advance[i];
    e.tickLoop(now);
   }
   assert.equal(completed.sync.state,ordinary.sync.state);
   assert.equal(completed.tUs.value,ordinary.tUs.value);
   assert.equal(completed.sync.seekCount,ordinary.sync.seekCount);
  }
  assert.equal(completed.sync.state,'playing');
  assert(completed.tUs.value>68e6);
 }
});
test('preparing reset still rejects an earlier or more than one-second-late frame',()=>{
 for(const offset of [-1,1000001]) {
  const e=engine();
  for(const stream of e.streams.values()) stream.advance=function(t){this.queue.add({rtUs:t+offset,isKey:true,handle:{}});};
  e.beginTimeline(70e6);e.tickLoop(16);
  assert.equal(e.resetPresentedUs.value,null);
  assert.equal(e.tUs.value,65e6);
  assert.equal(e.sync.state,'frozen');
 }
});
