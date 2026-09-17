const {test}=require('node:test');
const assert=require('node:assert/strict');
const load=require('./load-ts.cjs')();
const {planCatchup,recoveryGate,publisherTarget}=load('src/scenes/align/rateControl.ts');
const {AlignEngine}=load('src/scenes/align/useFrameAlign.ts');
const {FrameQueue}=load('src/scenes/align/frameQueue.ts');
test('one missed refresh resumes immediately, real rebuffer still uses hysteresis',()=>{
  assert(recoveryGate(0,true,16,16).ready);
  assert(!recoveryGate(0,true,16,300).ready);
  assert(!recoveryGate(0,true,16).ready);
});
test('publisher does not chase every 2-second segment step to the buffer edge',()=>{
  let current=65e6,mode='normal',maxRate=0,stalls=0;
  for(let now=16;now<120000;now+=16){
    const slow=100e6+Math.floor(now/2000)*2e6;
    const authority=publisherTarget(0,slow,current,false);
    const p=planCatchup({current,authority,from:0,safeTo:slow-30e6,elapsedMs:16,rate:1,supply:true,mode,publisher:true});
    if(p.t===current)stalls++; maxRate=Math.max(maxRate,p.rate);current=p.t;mode=p.mode;
  }
  assert.equal(stalls,0);assert.equal(maxRate,1);
});
test('canvas retains last common image while readiness and committed T freeze',()=>{
  const e=new AlignEngine();e.setRequiredSides(['A','B']);e.setPublisher(true);
  const canvases=['A','B'].map(side=>{const canvas={width:1,height:1,getContext:()=>({drawImage(){}})};e.registerCanvas(side,canvas);return canvas;});
  e.drawBuffer=()=>({width:1,height:1});
  for(const side of ['A','B']){const queue=new FrameQueue();e.streams.set(side,{queue,available:true,coverage:()=>({from:0,to:100e6}),canSeek:()=>true,seek(){return true;},advance(t){if(this.available)queue.add({rtUs:t,isKey:true,handle:{}});}});}
  for(let t=0;t<=320;t+=16)e.tickLoop(t);
  assert(canvases.every(c=>e.hasCanvasImage(c)));
  const T=e.tUs.value,b=e.streams.get('B');b.available=false;b.queue.clear();e.tickLoop(336);
  assert.equal(e.tUs.value,T);assert.equal(e.presented.A,false);assert.equal(e.presented.B,false);
  assert(canvases.every(c=>e.hasCanvasImage(c)));
  b.available=true;e.tickLoop(352);assert.equal(e.sync.state,'playing');
  e.resetPresented('A');assert(!e.hasCanvasImage(canvases[0]));
});
test('publisher hard recovery retains segment reserve without reversing T',()=>{
  const p=planCatchup({current:50e6,authority:70e6,from:0,safeTo:75e6,elapsedMs:16,rate:1,supply:true,publisher:true});
  assert.equal(p.mode,'seek');assert.equal(p.t,66e6);
  const gap=planCatchup({current:69e6,authority:70e6,from:69.5e6,safeTo:75e6,elapsedMs:16,rate:1,supply:true,publisher:true});
  assert.equal(gap.t,69.5e6);
});
