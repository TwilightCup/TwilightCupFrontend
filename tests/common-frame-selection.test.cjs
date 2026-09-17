const {test}=require('node:test');
const assert=require('node:assert/strict');
const load=require('./load-ts.cjs')();
const {AlignEngine}=load('src/scenes/align/useFrameAlign.ts');
const {FrameQueue}=load('src/scenes/align/frameQueue.ts');
function engine(){const e=new AlignEngine();e.setPublisher(true);e.setRequiredSides(['A','B']);e.tUs.value=65e6;
 for(const side of ['A','B'])e.streams.set(side,{queue:new FrameQueue(),coverage:()=>({from:0,to:100e6}),canSeek:()=>true,seek(){},advance(){}});return e;}
function add(q,t){q.add({rtUs:t,isKey:false,handle:{}});}
test('an available common pair is not rejected because independent nearest frames disagree',()=>{
 const e=engine(),target=65e6+16000;
 add(e.streams.get('A').queue,target-30000);add(e.streams.get('A').queue,target+35000);
 add(e.streams.get('B').queue,target+30000);
 e.tickLoop(16);
 assert.equal(e.sync.state,'playing');assert.equal(e.sync.pairErrorUs,5000);assert.equal(e.tUs.value,target);
});
test('a rebuffer target does not move with requestAnimationFrame jitter',()=>{
 const e=engine();e.tickLoop(16);const target=e.sync.targetUs;
 e.tickLoop(96);assert.equal(e.sync.targetUs,target);
});
const {commonFrames}=load('src/scenes/align/frameQueue.ts');
test('joint selection preserves target and pair limits, per-side monotonicity and single-side playback',()=>{
 const a=new FrameQueue(),b=new FrameQueue();add(a,960000);add(a,1040000);add(b,1000000);
 assert.deepEqual(commonFrames([a,b],1e6,40000,[1000000,null]).map(f=>f.rtUs),[1040000,1000000]);
 assert.equal(commonFrames([a,b],1e6,39999),null);
 assert.equal(commonFrames([a,b],1e6,40000,[1040001,null]),null);
 assert.equal(commonFrames([b],1e6,40000)[0].rtUs,1e6);
 assert.equal(commonFrames([a,new FrameQueue()],1e6,40000),null);
});
test('frame arrival resumes the pinned target after hysteresis without a decoder reset',()=>{
 const e=engine();e.tickLoop(16);const target=e.sync.targetUs;e.tickLoop(96);e.tickLoop(176);
 for(const s of e.streams.values()){add(s.queue,target);s.seek=()=>assert.fail('ordinary recovery must not seek');}
 for(const now of [201,245,300,315,391,460])e.tickLoop(now);
 assert.equal(e.sync.state,'playing');assert.equal(e.tUs.value,target);assert.equal(e.sync.seekCount,0);
 assert.equal(e.waitingT,null);
});
test('joint selector finds every admissible pair across candidate phase combinations',()=>{
 for(let phaseA=-40;phaseA<=40;phaseA+=10)for(let phaseB=-40;phaseB<=40;phaseB+=10){
  const a=new FrameQueue(),b=new FrameQueue();const aa=[phaseA-30,phaseA,phaseA+30],bb=[phaseB-30,phaseB,phaseB+30];
  aa.forEach(x=>add(a,1e6+x*1000));bb.forEach(x=>add(b,1e6+x*1000));
  const possible=aa.some(x=>Math.abs(x)<=40&&bb.some(y=>Math.abs(y)<=40&&Math.abs(x-y)<=40));
  const pair=commonFrames([a,b],1e6,40000);assert.equal(!!pair,possible);
  if(pair){assert(Math.abs(pair[0].rtUs-pair[1].rtUs)<=40000);assert(pair.every(f=>Math.abs(f.rtUs-1e6)<=40000));}
 }
});
