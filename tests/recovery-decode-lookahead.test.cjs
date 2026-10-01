const {test}=require('node:test');
const assert=require('node:assert/strict');
const load=require('./load-ts.cjs')();
const {AlignEngine}=load('src/scenes/align/useFrameAlign.ts');
const {FrameLockStream}=load('src/scenes/align/frameLock.ts');
const {FrameQueue}=load('src/scenes/align/frameQueue.ts');
function stream(){
 const s=new FrameLockStream({setOnSegment(){},setOnError(){},harvesterStats(){return {retries:0,gaveUp:0,authFail:0};}});
 s.ready=true;s.encapsulation='avcc';s.decodedEpoch=0;s.frameBytes=4;
 s.continuousFromUs=0;s.continuousToUs=130e6;
 s.decoder={queueSize:0,pendingSize:0,decodeSample(rtUs){s.queue.add({rtUs,isKey:false,handle:{}});return true;},close(){}};
 return s;
}
test('publisher waiting for progress can decode an available frame beyond the normal 250ms horizon',()=>{
 const e=new AlignEngine();e.setRequiredSides(['A','B']);e.setPublisher(true);e.setDelaySeconds(15);
 e.tUs.value=100e6;e.sync.state='playing';
 for(const side of ['A','B']){e.presented[side]=true;e.sync.presentedRt[side]=100e6;e.lastPictureAt[side]=0;}
 const a={queue:new FrameQueue(),coverage:()=>({from:0,to:130e6}),canSeek:()=>true,seek(){},advance(t){this.queue.add({rtUs:t,isKey:false,handle:{}});}};
 const b=stream();b.queue.add({rtUs:100e6,isKey:false,handle:{}});
 b.raw=Array.from({length:30},(_,i)=>({rtUs:100.5e6+i*40000,isKey:false,payload:new Uint8Array(1),epoch:0,codec:'h264',description:null}));b.rawBytes=30;
 e.streams.set('A',a);e.streams.set('B',b);
 for(let now=16;now<=1000;now+=16)e.tickLoop(now);
 assert(b.decPos>0,'the shared T must not wait for a frame that pump refuses to decode');
 assert.equal(e.sync.state,'playing',e.sync.reason);
 assert(e.sync.presentedRt.B>100e6);assert.equal(e.sync.seekCount,0);
});
test('recovery decode stays inside the existing 3-second bound and memory budget',()=>{
 for(const blockedBy of ['time','memory']) {
  const s=stream();s.raw=[{rtUs:blockedBy==='time'?104e6:100.5e6,isKey:false,payload:new Uint8Array(1),epoch:0,codec:'h264',description:null}];s.rawBytes=1;
  if(blockedBy==='memory')s.frameBytes=200*1024*1024;
  s.advance(100e6,10e6);assert.equal(s.decPos,0);
 }
});
