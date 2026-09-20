const {test}=require('node:test');
const assert=require('node:assert/strict');
const load=require('./load-ts.cjs')();
const {SignalRecovery}=load('src/scenes/align/signalPolicy.ts');
const {planCatchup}=load('src/scenes/align/rateControl.ts');
test('single loss waits ten seconds, retries do not reset wait, healthy side continues',()=>{
 const s=new SignalRecovery();
 assert.equal(s.update(0,['A','B'],['B'],[]).hold,true);
 assert.equal(s.update(9999,['A','B'],['B'],[]).hold,true);
 assert.deepEqual(s.update(10000,['A','B'],['B'],[]).active,['A']);
 assert.deepEqual(s.update(12000,['A','B'],[],[]).active,['A']);
 assert.deepEqual(s.update(13000,['A','B'],[],['B']).active,['A','B']);
});
test('both lost show waiting immediately, either side can recover without the other',()=>{
 const s=new SignalRecovery();
 assert.deepEqual(s.update(0,['A','B'],['A','B'],[]).active,[]);
 assert.deepEqual(s.update(100,['A','B'],['B'],['A']).active,['A']);
});
test('short outage recovers without excluding a side; reset has no previous wait',()=>{
 const s=new SignalRecovery();s.update(0,['A','B'],['B'],[]);
 assert.equal(s.update(9999,['A','B'],[],[]).hold,false);
 assert.equal(s.update(10000,['A','B'],['B'],[]).hold,true);
 s.reset();assert.equal(s.update(30000,['A','B'],['B'],[]).hold,true);
});
test('publisher delay alone stays soft, persistent missing frames still reanchor',()=>{
 const i={current:50e6,authority:80e6,from:0,safeTo:90e6,elapsedMs:16,rate:1,supply:true,publisher:true};
 assert.equal(planCatchup(i).mode,'soft');
 assert.equal(planCatchup({...i,recovering:true}).mode,'seek');
 assert.equal(planCatchup({...i,from:55e6}).mode,'seek');
});
const {AlignEngine}=load('src/scenes/align/useFrameAlign.ts');
const {FrameQueue}=load('src/scenes/align/frameQueue.ts');
function setup(){
 const e=new AlignEngine();e.setPublisher(true);e.setRequiredSides(['A','B']);e.tUs.value=68.7e6;
 for(const side of ['A','B'])e.streams.set(side,{to:100e6,from:0,ready:true,seeks:[],queue:new FrameQueue(),
  coverage(){return {from:this.from,to:this.to};},frontier(){return this.to;},canSeek(t){return t>=this.from&&t<=this.to;},
  seek(t){this.seeks.push(t);this.queue.clear();return true;},advance(t){if(this.ready)this.queue.add({rtUs:t,isKey:true,handle:{}});}});
 return e;
}
test('each page keeps both local sides even when the publisher reports one missing',()=>{
 const e=setup();e.setPublisher(false);
 assert(e.setExternalTUs(70e6,{epoch:1,seq:1,rate:1,active_sides:['A'],waiting_sides:['B']}));
 e.streams.get('B').ready=false;e.tickLoop(performance.now());
 assert.deepEqual([...e.sync.activeSides],['A','B']);assert.equal(e.tUs.value,68.7e6);
 assert(!e.setExternalTUs(70e6,{epoch:1,seq:1,active_sides:['B']}));
 e.streams.get('B').ready=true;e.tickLoop(performance.now());
 assert.equal(e.sync.state,'playing');assert.equal(e.sync.presentedRt.A,e.sync.presentedRt.B);
});
test('publisher never excludes a missing local side to advance the other',()=>{
 const e=setup();e.streams.get('B').ready=false;const held=e.tUs.value;
 for(let now=0;now<=20000;now+=100){for(const s of e.streams.values())s.to=100e6+now*1000;e.tickLoop(now);}
 assert.deepEqual([...e.sync.activeSides],['A','B']);assert.equal(e.tUs.value,held);
 assert(e.pictureExpired.value);
});
test('past timeline retains last pixels and cannot replay backwards',()=>{
 const e=setup();e.setPublisher(false);const canvas={};e.paintedCanvases.add(canvas);
 e.sync.presentedRt.A=e.sync.presentedRt.B=70e6;e.lastPictureAt=0;
 e.beginTimeline(60e6);e.external.accept({t_us:60e6,epoch:2,seq:1,rate:1},0);
 e.tickLoop(500);assert(e.hasCanvasImage(canvas));assert.equal(e.sync.state,'frozen');
 assert.equal(e.sync.presentedRt.A,70e6);assert(!e.pictureExpired.value);
 e.external.accept({t_us:71e6,epoch:2,seq:2,rate:1},1000);e.tickLoop(1000);
 assert.equal(e.sync.state,'playing');assert.equal(e.sync.presentedRt.A,71e6);
});
test('last frame expires only after ten seconds without actual frame advancement',()=>{
 const e=setup();e.setPublisher(false);const canvas={};e.paintedCanvases.add(canvas);e.lastPictureAt=100;
 e.refreshAuthority(10100);assert(!e.pictureExpired.value);assert(e.hasCanvasImage(canvas));
 e.refreshAuthority(10101);assert(e.pictureExpired.value);assert(e.hasCanvasImage(canvas));
});
test('new T outside three-second tolerance does not play an older safe target',()=>{
 const e=setup();e.setPublisher(false);e.external.accept({t_us:104e6,epoch:1,seq:1,rate:1},0);
 e.tickLoop(0);assert.equal(e.tUs.value,68.7e6);assert.equal(e.sync.reason,'target_unavailable');
 e.external.accept({t_us:110e6,epoch:1,seq:2,rate:1},1000);
 for(const stream of e.streams.values())stream.to=104e6;
 e.tickLoop(1000);assert.equal(e.tUs.value,68.7e6);
 for(const stream of e.streams.values())stream.to=111e6;
 e.tickLoop(1025);assert.equal(e.sync.state,'playing');assert(e.tUs.value>=110e6);
});
test('three-second tolerance applies to both target and pair, preferring closest frames',()=>{
 const {commonFrames}=load('src/scenes/align/frameQueue.ts');
 const a=new FrameQueue(),b=new FrameQueue();
 a.add({rtUs:97e6,isKey:true,handle:{}});b.add({rtUs:100e6,isKey:true,handle:{}});
 assert(commonFrames([a,b],100e6,3e6));
 b.clear();b.add({rtUs:100e6+1,isKey:true,handle:{}});
 assert.equal(commonFrames([a,b],100e6,3e6),null);
});
