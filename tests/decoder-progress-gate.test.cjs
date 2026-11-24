const {test}=require('node:test');
const assert=require('node:assert/strict');
const load=require('./load-ts.cjs')();
const {AlignEngine}=load('src/scenes/align/useFrameAlign.ts');
const {FrameQueue}=load('src/scenes/align/frameQueue.ts');
function page(){
 const e=new AlignEngine();e.setRequiredSides(['A','B']);e.setPublisher(true);e.setDelaySeconds(15);
 e.tUs.value=100e6;e.sync.state='playing';
 for(const side of ['A','B']) {
  e.presented[side]=true;e.sync.presentedRt[side]=100e6;e.lastPictureAt[side]=0;
  const queue=new FrameQueue(()=>{},3e6,3e6);queue.add({rtUs:100e6,isKey:false,handle:{}});
  e.streams.set(side,{queue,lag:0,
   coverage:()=>({from:0,to:130e6}),canSeek:()=>true,seek(){},
   advance(t){this.queue.advance(t);if(this.lag!==null)this.queue.add({rtUs:t-this.lag,isKey:false,handle:{}});}});
 }
 return e;
}
test('stalled B cannot remain ready while A and T run three seconds ahead',()=>{
 const e=page();e.streams.get('B').lag=null;
 for(let now=16;now<=1500;now+=16)e.tickLoop(now);
 assert(e.tUs.value<100.15e6,`T ran away to ${e.tUs.value}`);
 assert.equal(e.sync.state,'frozen');assert.equal(e.presented.A,false);assert.equal(e.presented.B,false);
 assert.equal(e.sync.reason,'decoder_progress_wait:B');
 assert(e.sync.seekCount===0);
});
test('delayed decoder output can catch a held target and restore both pictures',()=>{
 const e=page(),b=e.streams.get('B');b.lag=null;
 for(let now=16;now<=1000;now+=16)e.tickLoop(now);
 const held=e.tUs.value;b.lag=0;
 for(let now=1008;now<=2000;now+=16)e.tickLoop(now);
 assert.equal(e.sync.state,'playing');assert(e.tUs.value>held+0.5e6);
 assert.equal(e.sync.seekCount,0);assert(e.sync.pairErrorUs<100000);
});
test('continuously advancing B with a 2.8-second clock offset still uses the existing tolerance',()=>{
 const e=page(),b=e.streams.get('B');
 e.sync.presentedRt.B=97.2e6;b.queue.clear();b.lag=2.8e6;
 for(let now=16;now<=1000;now+=16) {
  e.tickLoop(now);assert.equal(e.sync.state,'playing');
  assert(e.sync.pairErrorUs<=3e6);
 }
 assert(e.tUs.value>100.9e6);
});
