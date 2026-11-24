const {test}=require('node:test');
const assert=require('node:assert/strict');
const load=require('./load-ts.cjs')();
const {AlignEngine}=load('src/scenes/align/useFrameAlign.ts');
const {FrameQueue}=load('src/scenes/align/frameQueue.ts');
function page(){
 const e=new AlignEngine(false);e.setRequiredSides(['A','B']);e.tUs.value=65e6;e.sync.state='playing';
 e.latestSeek=65e6;e.lastSeekAt=0;
 e.external.read=now=>({t:65e6+now*1000,rate:1,stale:false});
 for(const [side,fps,phase] of [['A',60,0],['B',30,14000]]) {
  e.presented[side]=true;e.sync.presentedRt[side]=65e6;e.lastPictureAt[side]=0;
  const queue=new FrameQueue();queue.add({rtUs:65e6,isKey:false,handle:{}});
  e.streams.set(side,{queue,available:true,seeks:0,coverage:()=>({from:0,to:100e6}),canSeek:()=>true,
   seek(){this.seeks++;},advance(t){
    if(!this.available)return;
    queue.advance(t);const period=1e6/fps;
    const rt=Math.floor((t-phase)/period)*period+phase;
    if(rt>=65e6)queue.add({rtUs:Math.round(rt),isKey:false,handle:{}});
   }});
 }
 return e;
}
test('stage mixed frame rates retain readiness across ordinary frame intervals without seek churn',()=>{
 const e=page();let repeats=0,last=e.tUs.value;
 for(let now=8;now<=4000;now+=8) {
  e.tickLoop(now);
  assert.equal(e.sync.state,'playing',`${now}: ${e.sync.reason}`);
  assert(e.presented.A && e.presented.B);
  if(e.tUs.value===last)repeats++;
  last=e.tUs.value;
 }
 assert(repeats>0);assert(e.tUs.value>68.9e6);assert.equal(e.sync.seekCount,0);
});
test('stage cadence hold cannot renew a stalled B picture beyond ten seconds',()=>{
 const e=page();for(let now=8;now<=1000;now+=8)e.tickLoop(now);
 e.streams.get('B').available=false;
 const age=e.lastPictureAt.B;
 for(let now=1008;now<=11500;now+=8)e.tickLoop(now);
 assert.equal(e.lastPictureAt.B,age);assert(e.pictureExpired.value);
 assert.equal(e.sync.state,'frozen');
});
test('fresh stage candidates are preferred over an exact repeated frame',()=>{
 const e=page();e.external.read=()=>({t:65016000,rate:1,stale:false});
 for(const stream of e.streams.values()) {
  stream.advance=()=>{};stream.queue.clear();
  stream.queue.add({rtUs:65e6,isKey:false,handle:{}});
  stream.queue.add({rtUs:65034000,isKey:false,handle:{}});
 }
 e.tickLoop(16);assert.equal(e.sync.state,'playing');
 assert.equal(e.sync.presentedRt.A,65034000);assert.equal(e.sync.presentedRt.B,65034000);
 assert.equal(e.sync.seekCount,0);
});
