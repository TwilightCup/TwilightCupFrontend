const {test}=require('node:test');const assert=require('node:assert/strict');const load=require('./load-ts.cjs')();
const {AlignEngine}=load('src/scenes/align/useFrameAlign.ts');const {FrameQueue}=load('src/scenes/align/frameQueue.ts');
function follower(){const e=new AlignEngine();e.setRequiredSides(['A','B']);for(const side of ['A','B'])e.streams.set(side,{queue:new FrameQueue(),cursor:null,seeks:[],coverage:()=>({from:0,to:110e6}),canSeek:()=>true,
 seek(t){this.cursor=t;this.seeks.push(t);this.queue.clear();return true;},advance(t){if(Math.abs(t-this.cursor)<300000){this.cursor=t;this.queue.add({rtUs:t,isKey:true,handle:{}});}}});return e;}
test('lease sampling cannot hijack startup decoding after a follower has a valid anchor',()=>{
 const e=follower();e.external.accept({t_us:70e6,epoch:1,seq:1,rate:1,src:'master'},0);
 for(let now=0;now<=500;now+=25){e.tickLoop(now);e.leaseSample(now);}
 assert.equal(e.sync.state,'playing');assert(e.tUs.value>=70e6);
 for(const s of e.streams.values())assert.equal(s.seeks.length,1);
});
test('paused authority also owns startup decoding; a frozen anchor is not permission to prewarm elsewhere',()=>{
 const e=follower();e.external.accept({t_us:70e6,epoch:1,seq:1,rate:0,frozen:true,src:'master'},0);
 for(let now=0;now<=500;now+=25){e.tickLoop(now);e.leaseSample(now);}
 assert.equal(e.tUs.value,70e6);for(const s of e.streams.values())assert.equal(s.seeks.length,1);
});
test('a fresh anchor reclaims a stale private probe and resets its decoder cursor once',()=>{
 const e=follower();e.tUs.value=69e6;e.selectAuthority(null,1);e.leaseSample(0);
 for(const s of e.streams.values())assert.equal(s.cursor,75e6);
 e.selectAuthority('master',2);assert(e.setExternalTUs(70e6,{epoch:2,seq:1,rate:1,src:'master'}));
 const at=performance.now();for(let dt=0;dt<=500;dt+=25){e.tickLoop(at+dt);e.leaseSample(at+dt);}
 assert.equal(e.sync.state,'playing');assert(e.tUs.value>=70e6);assert.equal(e.candidateProbe,null);
 for(const s of e.streams.values())assert.equal(s.seeks.length,2);
});
test('either opening order lets the elected page and both followers play while all sample leases',()=>{
 for(const ownerName of ['director','stage']){
  const main=follower(),followers=[follower(),follower()];main.setPublisher(true);let seq=0;
  for(let now=0;now<=1400;now+=25){main.tickLoop(now);main.leaseSample(now);
   if(now%400===0&&main.tUs.value!=null)for(const e of followers)e.external.accept({t_us:Math.floor(main.tUs.value),epoch:1,seq:++seq,rate:main.playback.speed,src:ownerName},now);
   for(const e of followers){e.tickLoop(now);e.leaseSample(now);}
  }
  assert.equal(main.sync.state,'playing');for(const e of followers){assert.equal(e.sync.state,'playing');assert(e.tUs.value>0);assert.equal(e.sync.role,'follower');}
 }
});
