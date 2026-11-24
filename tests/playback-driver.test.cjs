const {test}=require('node:test');const assert=require('node:assert/strict');
const load=require('./load-ts.cjs')();
const {PlaybackDriver}=load('src/scenes/align/playbackDriver.ts');
function setup(){let now=0,hidden=true,workerTick,rafTick,timerTick,terminated=0,cancelled=0;const ticks=[];
 const d=new PlaybackDriver({now:()=>now,hidden:()=>hidden,frame:f=>(rafTick=f,1),cancelFrame(){cancelled++;},
 interval:f=>(timerTick=f,1),clearInterval(){},worker:f=>(workerTick=f,()=>terminated++)});
 d.start(t=>ticks.push(t));return {d,ticks,setNow:n=>now=n,setHidden:h=>hidden=h,worker:workerTick,raf:()=>rafTick(),timer:()=>timerTick(),terminated:()=>terminated,cancelled:()=>cancelled};}
test('hidden page keeps a sub-100ms playback cadence without any animation frame',()=>{
 const p=setup();for(let n=25;n<=10000;n+=25){p.setNow(n);p.worker();}
 assert.equal(p.ticks.length,400);assert.equal(p.ticks.at(-1),10000);p.d.stop();
});
test('visible page uses animation frames, but recovers if they stop without a visibility event',()=>{
 const p=setup();p.setHidden(false);p.setNow(16);p.raf();p.setNow(25);p.worker();assert.deepEqual(p.ticks,[16]);
 p.setNow(116);p.worker();assert.deepEqual(p.ticks,[16,116]);p.d.stop();
});
test('stop fences queued callbacks and restart cannot run callbacks from the old worker',()=>{
 const p=setup(),old=p.worker;p.d.stop();p.setNow(100);old();assert.equal(p.ticks.length,0);assert.equal(p.terminated(),1);
 p.d.start(t=>p.ticks.push(t));p.setNow(125);old();assert.equal(p.ticks.length,0);p.d.stop();
});
test('hidden publisher advances ten seconds and emits clock pulses without rAF or main timers',()=>{
 const {AlignEngine}=load('src/scenes/align/useFrameAlign.ts');const {FrameQueue}=load('src/scenes/align/frameQueue.ts');
 let now=0,pulse;const e=new AlignEngine();e.setPublisher(true);e.setRequiredSides(['A','B']);e.tUs.value=65e6;
 e.driver=new PlaybackDriver({now:()=>now,hidden:()=>true,frame:()=>1,cancelFrame(){},interval:()=>1,clearInterval(){},worker:f=>(pulse=f,()=>{})});
 e.refreshHealth=()=>{};let beats=0;e.setClockPulse(()=>beats++);
 for(const side of ['A','B'])e.streams.set(side,{queue:new FrameQueue(),coverage:()=>({from:0,to:100e6+now*1000}),
  canSeek:()=>true,seek(){assert.fail('normal background scheduling must not reanchor');},advance(t){this.queue.add({rtUs:t,isKey:true,handle:{}});}});
 try{e.start();for(now=25;now<=10000;now+=25)pulse();assert(e.tUs.value>=74.9e6);assert.equal(beats,400);assert.equal(e.sync.state,'playing');}
 finally{e.stop();}
});
test('worker unavailable keeps bounded timer fallback and stop is safe',()=>{
 let timer,now=0;const ticks=[];
 const d=new PlaybackDriver({now:()=>now,hidden:()=>true,frame:()=>1,cancelFrame(){},interval:f=>(timer=f,1),clearInterval(){},worker:()=>null});
 d.start(t=>ticks.push(t));now=100;timer();assert.deepEqual(ticks,[100]);d.stop();now=200;timer();assert.deepEqual(ticks,[100]);
});
