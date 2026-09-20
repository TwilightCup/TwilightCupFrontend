const {test}=require('node:test');
const assert=require('node:assert/strict');
const load=require('./load-ts.cjs')();
const {DirectorFrameRenderer}=load('src/scenes/align/directorFrameRenderer.ts');
function canvas(){return {width:0,height:0,draws:[],getContext(){return {drawImage:(...args)=>this.draws.push(args)};}};}
const frame=()=>({displayWidth:1920,displayHeight:1080});
const options=(visible=true)=>({maxWidth:640,maxHeight:360,visible:()=>visible});
test('same identity is drawn once; new identity or generation with same timestamp redraws',()=>{
 const r=new DirectorFrameRenderer(canvas),c=canvas(),f=frame();
 const draw=(handle,generation=1)=>r.prepare('A',handle,generation,[{canvas:c,options:options()}])();
 draw(f);draw(f);assert.equal(c.draws.length,1);draw(frame());draw(f,2);assert.equal(c.draws.length,3);
 assert.equal(c.width,640);assert.equal(c.height,360);
});
test('same-side conversion shared across outputs; late output and resizing receive pixels',()=>{
 const scratch=[];const r=new DirectorFrameRenderer(()=>{const c=canvas();scratch.push(c);return c;});
 const a=canvas(),b=canvas(),f=frame();
 r.prepare('A',f,1,[{canvas:a,options:options()},{canvas:b,options:options()}])();
 assert.equal(scratch.length,1);assert.equal(scratch[0].draws.length,1);
 const c=canvas();r.prepare('A',f,1,[{canvas:c,options:options()}])();assert.equal(c.draws.length,1);assert.equal(scratch[0].draws.length,1);
 r.prepare('A',f,1,[{canvas:a,options:{...options(),maxWidth:960,maxHeight:540}}])();assert.equal(a.width,960);assert.equal(a.draws.length,2);
});
test('invisible output performs no conversion; resume draws current validated frame',()=>{
 const scratch=[];const r=new DirectorFrameRenderer(()=>{const c=canvas();scratch.push(c);return c;});const c=canvas();
 r.prepare('A',frame(),1,[{canvas:c,options:options(false)}])();assert.equal(scratch.length,0);assert.equal(c.draws.length,0);
 r.prepare('A',frame(),1,[{canvas:c,options:options()}])();assert.equal(c.draws.length,1);
});
test('both sides can prepare before either commits; failed preparation retains visible images',()=>{
 const r=new DirectorFrameRenderer(canvas),a=canvas(),b=canvas();
 const commit=r.prepare('A',frame(),1,[{canvas:a,options:options()}]);
 assert.throws(()=>r.prepare('B',{displayWidth:0,displayHeight:0},1,[{canvas:b,options:options()}]));
 assert.equal(a.draws.length,0);assert.equal(b.draws.length,0);commit();assert.equal(a.draws.length,1);
});
const {AlignEngine}=load('src/scenes/align/useFrameAlign.ts');
const {FrameQueue}=load('src/scenes/align/frameQueue.ts');
test('hidden director keeps validated authority progress; resume waits for both sides before drawing',()=>{
 const e=new AlignEngine();e.setPublisher(true);e.setRequiredSides(['A','B']);e.tUs.value=65e6;
 let visible=false,now=0;const outputs=[];
 e.directorRenderer=new DirectorFrameRenderer(canvas);
 for(const side of ['A','B']){
  const c=canvas();outputs.push(c);e.registerCanvas(side,c,{...options(),visible:()=>visible});
  e.streams.set(side,{queue:new FrameQueue(),available:true,coverage:()=>({from:0,to:100e6+now*1000}),canSeek:()=>true,seek(){return true;},
   advance(t){if(this.available)this.queue.add({rtUs:t,isKey:true,handle:frame()});}});
 }
 for(now=25;now<=1000;now+=25)e.tickLoop(now);
 assert(e.tUs.value>65.9e6);assert(outputs.every(c=>c.draws.length===0));
 assert.equal(e.leaseSample(now).decode_ready,true);
 visible=true;const b=e.streams.get('B');b.available=false;b.queue.clear();const previous=e.tUs.value;e.tickLoop(now);
 assert.equal(e.tUs.value,previous);assert(outputs.every(c=>c.draws.length===0));
 b.available=true;now+=25;e.tickLoop(now);assert(outputs.every(c=>c.draws.length===1));assert.equal(e.sync.state,'playing');
});
test('unmount/remount releases the old stream and requires new common frames',()=>{
 const e=new AlignEngine();e.setRequiredSides(['A','B']);e.setPublisher(true);e.tUs.value=65e6;
 let stops=0;const outputs=[];
 e.directorRenderer=new DirectorFrameRenderer(canvas);
 for(const side of ['A','B']){
  const c=canvas();outputs.push(c);e.registerCanvas(side,c,options());
  const queue=new FrameQueue();queue.add({rtUs:65e6,isKey:true,handle:frame()});
  e.streams.set(side,{queue,stop(){stops++;queue.clear();},coverage:()=>({from:0,to:100e6}),canSeek:()=>true,advance(){}});
  const token=Symbol(side);e.refs.set(side,new Set([token]));e.stopStream(side,token);
 }
 assert.equal(stops,2);assert.equal(e.streams.size,0);e.tickLoop(16);assert.equal(e.tUs.value,65e6);assert(outputs.every(c=>c.draws.length===0));
 for(const side of ['A','B'])e.streams.set(side,{queue:new FrameQueue(),coverage:()=>({from:0,to:100e6}),canSeek:()=>true,advance(t){this.queue.add({rtUs:t,isKey:true,handle:frame()});}});
 e.tickLoop(32);assert(outputs.every(c=>c.draws.length===1));assert.equal(e.sync.state,'playing');
});
test('mixed output budgets convert once at the largest required size',()=>{
 const scratch=[];const r=new DirectorFrameRenderer(()=>{const c=canvas();scratch.push(c);return c;});const small=canvas(),large=canvas();
 r.prepare('A',frame(),1,[{canvas:small,options:options()},{canvas:large,options:{...options(),maxWidth:960,maxHeight:540}}])();
 assert.equal(scratch.length,1);assert.equal(scratch[0].draws.length,1);assert.equal(scratch[0].width,960);
 assert.equal(small.width,640);assert.equal(large.width,960);
 r.release('A');r.prepare('A',frame(),2,[{canvas:small,options:options()}])();assert.equal(scratch.length,2);
});
test('director native output retains full source resolution and identity deduplication',()=>{
 const r=new DirectorFrameRenderer(canvas),c=canvas(),f={displayWidth:3840,displayHeight:2160};
 const surfaces=[{canvas:c,options:{visible:()=>true}}];
 r.prepare('A',f,1,surfaces)();r.prepare('A',f,1,surfaces)();
 assert.equal(c.width,3840);assert.equal(c.height,2160);assert.equal(c.draws.length,1);
});
