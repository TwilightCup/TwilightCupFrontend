const {test}=require('node:test');
const assert=require('node:assert/strict');
const load=require('./load-ts.cjs')();
const {AlignEngine}=load('src/scenes/align/useFrameAlign.ts');
const {FrameQueue}=load('src/scenes/align/frameQueue.ts');
function engine(){
 const e=new AlignEngine();e.setRequiredSides(['A','B']);e.setPublisher(true);
 e.tUs.value=65e6;e.sync.state='playing';e.setDelaySeconds(35);
 for(const side of ['A','B']) {
  e.presented[side]=true;e.sync.presentedRt[side]=65033000;e.lastPictureAt[side]=0;
  e.streams.set(side,{queue:new FrameQueue(),available:true,seeks:0,
   coverage(){return this.available?{from:0,to:110e6}:null;},canSeek:()=>true,
   seek(){this.queue.clear();this.seeks++;},
   advance(t){this.queue.add({rtUs:Math.ceil(t/33333)*33333,isKey:true,handle:{}});}});
 }
 return e;
}
test('one missing coverage tick cannot trap resumed publisher behind its last quantized picture',()=>{
 const e=engine(),b=e.streams.get('B');
 b.available=false;e.tickLoop(16);assert.equal(e.sync.state,'waiting');
 b.available=true;
 for(let now=32;now<=1000;now+=16)e.tickLoop(now);
 assert.equal(e.sync.state,'playing',e.sync.reason);
 assert(e.tUs.value>65.8e6);assert(e.sync.presentedRt.A>=65033000);
 assert.equal(e.pictureExpired.value,false);
});
test('recovery seek cannot remain pinned at the previously displayed frame',()=>{
 const e=engine();e.tUs.value=65033000;e.sync.state='frozen';e.missingMs=2000;
 e.streams.forEach(s=>s.coverage=()=>({from:0,to:96033000}));
 for(let now=16;now<=1000;now+=16)e.tickLoop(now);
 assert.equal(e.sync.state,'playing',e.sync.reason);
 assert(e.tUs.value>65033000);assert(e.sync.seekCount<=1);
});
test('a stale pending seek behind the picture is released without a backwards commit',()=>{
 const e=engine();e.sync.state='frozen';e.pendingSeek=65e6;
 for(let now=16;now<=1000;now+=16){e.tickLoop(now);assert(e.tUs.value>=65e6);}
 assert.equal(e.sync.state,'playing',e.sync.reason);assert(e.tUs.value>65.8e6);
});
