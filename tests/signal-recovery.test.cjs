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
test('engine drains safe buffer then waits ten seconds; returning side warms before rejoining',()=>{
 const e=setup(),a=e.streams.get('A'),b=e.streams.get('B');
 for(let now=0;now<=6000;now+=100){a.to=100e6+now*1000;e.tickLoop(now);}
 const held=e.tUs.value;assert.equal(e.sync.reason,'signal_wait');
 for(let now=6100;now<16000;now+=100){a.to=100e6+now*1000;e.tickLoop(now);}
 assert.equal(e.tUs.value,held);
 a.to=116e6;e.tickLoop(16000);assert.deepEqual([...e.sync.activeSides],['A']);
 assert.deepEqual([...e.sync.waitingSides],['B']);assert(e.tUs.value>held);assert.equal(e.presented.B,false);
 b.to=117e6;e.tickLoop(16100);assert.deepEqual([...e.sync.activeSides],['A']);
 for(let now=16200;now<=16600;now+=100){a.to=100e6+now*1000;b.to=a.to;e.tickLoop(now);}
 assert.deepEqual([...e.sync.activeSides],['A','B']);assert.equal(e.sync.presentedRt.A,e.sync.presentedRt.B);
});
test('both signals exhausted freeze T; one returned source can restart independently',()=>{
 const e=setup();for(let now=0;now<=6000;now+=100)e.tickLoop(now);
 assert.deepEqual([...e.sync.waitingSides],['A','B']);const held=e.tUs.value;
 e.tickLoop(7000);assert.equal(e.tUs.value,held);
 const a=e.streams.get('A');a.from=110e6;a.to=150e6;
 for(let now=7100;now<=8000;now+=100){a.to+=100000;e.tickLoop(now);}
 assert.deepEqual([...e.sync.activeSides],['A']);assert(e.tUs.value>=110e6);
});
test('ingest progresses during decoder stalls: no signal exclusion and seeks have cooldown',()=>{
 const e=setup();e.streams.get('B').ready=false;
 for(let now=0;now<=20000;now+=100){for(const s of e.streams.values())s.to=100e6+now*1000;e.tickLoop(now);}
 assert.deepEqual([...e.sync.waitingSides],[]);
 assert(e.sync.seekCount>=2);assert(e.sync.seekCount<=4);
});
test('followers use accepted membership; stale or malformed anchors cannot change it',()=>{
 const e=setup();e.setPublisher(false);
 const p={epoch:1,seq:1,rate:1,active_sides:['A'],waiting_sides:['B']};
 assert(e.setExternalTUs(70e6,p));e.tickLoop(performance.now());
 assert.deepEqual([...e.sync.activeSides],['A']);assert.deepEqual([...e.sync.waitingSides],['B']);
 assert(!e.setExternalTUs(70e6,{...p,active_sides:['B'],waiting_sides:['A']}));
 assert(!e.setExternalTUs(70e6,{...p,seq:2,active_sides:['B']}));
 e.tickLoop(performance.now());assert.deepEqual([...e.sync.activeSides],['A']);
 assert(e.setExternalTUs(70e6,{...p,seq:2,active_sides:[],waiting_sides:['A','B'],rate:0}));
 e.tickLoop(performance.now());assert.deepEqual([...e.sync.waitingSides],['A','B']);
});
test('promotion inherits excluded sides rather than restarting the ten-second hold',()=>{
 const e=setup();e.setPublisher(false);
 assert(e.setExternalTUs(69e6,{epoch:2,seq:1,rate:0,active_sides:['A'],waiting_sides:['B']}));
 e.tickLoop(performance.now());e.setPublisher(true);e.tickLoop(performance.now());
 assert.deepEqual([...e.sync.activeSides],['A']);assert.deepEqual([...e.sync.waitingSides],['B']);
});
test('rejoining follower conceals the old image until a new common frame is committed',()=>{
 const e=setup();e.setPublisher(false);const canvas={};e.canvases.set('B',[canvas]);e.paintedCanvases.add(canvas);
 assert(e.setExternalTUs(69e6,{epoch:1,seq:1,rate:0,active_sides:['A'],waiting_sides:['B']}));e.tickLoop(performance.now());
 assert(e.setExternalTUs(69e6,{epoch:1,seq:2,rate:0,active_sides:['A','B'],waiting_sides:[]}));
 e.streams.get('B').ready=false;e.tickLoop(performance.now());
 assert.equal(e.hasCanvasImage(canvas),false);assert.equal(e.presented.B,false);
});
