const {test}=require('node:test');
const assert=require('node:assert/strict');
const load=require('./load-ts.cjs')();
const {FrameLockStream}=load('src/scenes/align/frameLock.ts');
const {AlignEngine}=load('src/scenes/align/useFrameAlign.ts');

async function withSurfacePool(run,surfaceLimit=8){
 const saved={VideoDecoder:global.VideoDecoder,VideoFrame:global.VideoFrame,
  EncodedVideoChunk:global.EncodedVideoChunk,OffscreenCanvas:global.OffscreenCanvas};
 const decoders=[],snapshots=[];
 global.OffscreenCanvas=class{
  constructor(width,height){this.width=width;this.height=height;}
  getContext(){return {drawImage:frame=>{
   if(this.fail)throw new Error('snapshot failed');
   this.pixels=frame.timestamp;
  }};}
 };
 global.VideoFrame=class{
  constructor(canvas,init){
   this.timestamp=init.timestamp;this.pixels=canvas.pixels;
   this.displayWidth=canvas.width;this.displayHeight=canvas.height;
   this.closed=false;snapshots.push(this);
  }
  close(){this.closed=true;}
 };
 global.EncodedVideoChunk=class{constructor(data){Object.assign(this,data);}};
 global.VideoDecoder=class{
  static async isConfigSupported(){return {supported:true};}
  constructor(callbacks){this.callbacks=callbacks;this.chunks=[];this.surfaces=0;decoders.push(this);}
  configure(){}
  get decodeQueueSize(){return this.chunks.length;}
  decode(chunk){this.chunks.push(chunk);}
  close(){this.chunks=[];}
  drain(){
   // A finite hardware pool stops output until clients close its frames.
   while(this.chunks.length && this.surfaces<surfaceLimit){
    const chunk=this.chunks.shift();this.surfaces++;
    let closed=false;
    this.callbacks.output({timestamp:chunk.timestamp,displayWidth:1920,displayHeight:1080,
     close:()=>{if(!closed){closed=true;this.surfaces--;}}});
   }
  }
 };
 try{await run({decoders,snapshots});}finally{Object.assign(global,saved);}
}
function stream(){
 return new FrameLockStream({setOnSegment(){},setOnError(){},start(){},stop(){},
  harvesterStats:()=>({retries:0,gaveUp:0,authFail:0})});
}
function samples(start,count,offset=0){
 return Array.from({length:count},(_,i)=>({rtUs:Math.round(start+i*1e6/30+offset),isKey:i%30===0,
  payload:new Uint8Array([0,0,0,2,0x65,0]),epoch:0,codec:'h264',description:null}));
}

test('buffered pixels outlive closed decoder surfaces and do not alias the reused canvas',async()=>{
 await withSurfacePool(async({decoders,snapshots})=>{
  const s=stream();s.raw=samples(100e6,30);s.rawBytes=180;
  s.continuousFromUs=100e6;s.continuousToUs=101e6;
  s.advance(100e6);await Promise.resolve();await Promise.resolve();
  s.advance(100e6);decoders[0].drain();
  assert(s.queue.length>=8);assert.equal(decoders[0].surfaces,0);
  const first=s.queue.nearest(100e6,0).handle;
  assert.equal(first.pixels,100e6);assert.equal(first.closed,false);
  assert.notEqual(s.snapshotCanvas.pixels,first.pixels);
  assert.equal(s.queue.nearest(100e6,0).isKey,true);
  s.stop();assert.equal(s.snapshotCanvas,null);assert(snapshots.every(f=>f.closed));
 });
});

test('snapshot failure still returns the original surface to the decoder',async()=>{
 await withSurfacePool(async({decoders})=>{
  const s=stream(),errors=[];s.opts.onError=e=>errors.push(e.message);
  s.raw=samples(100e6,30);s.rawBytes=180;
  s.advance(100e6);await Promise.resolve();await Promise.resolve();
  s.snapshotCanvas=new OffscreenCanvas(1920,1080);s.snapshotCanvas.fail=true;
  s.advance(100e6);decoders[0].drain();
  assert.equal(decoders[0].surfaces,0);assert.equal(s.queue.length,0);
  assert(errors.length>0);assert.equal(s.decodeError,'snapshot failed');s.stop();
 });
});

test('two streams with constrained decoder surfaces recover delayed output and play without stall seeks',async()=>{
 await withSurfacePool(async({decoders,snapshots})=>{
  const e=new AlignEngine();e.setPublisher(true);e.setRequiredSides(['A','B']);e.setDelaySeconds(15);
  const streams=[];
  for(const [side,offset] of [['A',0],['B',6200]]){
   const s=stream();
   // B's next picture arrives beyond the normal decode horizon. Recovery
   // selects it ahead of A, while A's older surfaces still occupy its pool.
   s.raw=side==='B' ? [samples(99e6,1,offset)[0],...samples(100.5e6,1500,offset)]
    : samples(99e6,1500,offset);
   s.rawBytes=s.raw.length*6;
   s.continuousFromUs=99e6+offset;s.continuousToUs=115e6;
   streams.push(s);e.streams.set(side,s);
  }
  let frozenAfterWarmup=0;
  for(let now=16;now<=30000;now+=16){
   for(const s of streams)s.continuousToUs=115e6+now*1000;
   for(const d of decoders)d.drain();
   e.tickLoop(now);await Promise.resolve();await Promise.resolve();
   if(now>1000 && e.sync.state!=='playing')frozenAfterWarmup++;
  }
  assert.equal(frozenAfterWarmup,0,e.sync.reason);
  assert.equal(e.sync.seekCount,1,'only the startup seek is needed');
  assert(e.tUs.value>129e6,`shared T stuck at ${e.tUs.value}`);
  assert.equal(e.pictureExpired.value,false);
  assert(decoders.every(d=>d.surfaces===0));
  for(const s of streams)s.stop();assert(snapshots.every(f=>f.closed));
 },2); // Reference pictures may leave only two surfaces available for output.
});
