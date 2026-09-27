const {test}=require('node:test');
const assert=require('node:assert/strict');
const load=require('./load-ts.cjs')();

test('server receive-time estimate survives local wall jumps and rejects isolated server steps',()=>{
 const {ServerClock}=load('src/utils/epochClock.ts');
 const c=new ServerClock();
 assert(c.observe(100000,10));
 assert.equal(c.read(1010,900000).epochMs,101000);
 assert.equal(c.read(1010,900000).source,'server-estimate');
 assert(!c.observe(200000,1010));
 assert.equal(c.read(2010,1).epochMs,102000);
 assert.equal(c.read(40010,80000).source,'local-fallback');
});
test('anchor monotonic age wins over jumping server wall fields, legacy remains compatible',()=>{
 const {ExternalClock}=load('src/scenes/align/externalClock.ts');
 const c=new ExternalClock();
 assert(c.accept({t_us:60e6,epoch:1,seq:1,rate:1,anchor_age_ms:100,server_now_ms:999999,effective_at_ms:1},0));
 assert(!c.read(0).stale);assert.equal(c.read(0).t,60.1e6);
});
test('formatter defaults Shanghai and DST changes only rendered text',()=>{
 const {formatEpoch}=load('src/utils/displayTime.ts');
 const ms=Date.UTC(2026,0,1,0,0,0);
 assert.match(formatEpoch(ms,{hour:'2-digit',minute:'2-digit'},'en-GB'),/08:00/);
 assert.match(formatEpoch(ms,{hour:'2-digit',minute:'2-digit'},'en-GB','UTC'),/00:00/);
 const before=Date.UTC(2026,2,8,6,59),after=before+60000;
 assert.match(formatEpoch(before,{hour:'2-digit',minute:'2-digit'},'en-GB','America/New_York'),/01:59/);
 assert.match(formatEpoch(after,{hour:'2-digit',minute:'2-digit'},'en-GB','America/New_York'),/03:00/);
 assert.equal(after-before,60000);
});
test('SEI holdover uses media PTS, preserves B-frame order and survives false NTP',()=>{
 const {MediaEpochClock}=load('src/scenes/align/mediaEpochClock.ts');
 const c=new MediaEpochClock();
 assert.equal(c.map(100e6,0),100e6);
 assert.equal(c.map(100.1e6,100000),100.1e6);
 assert.equal(c.map(100.05e6,50000),100.05e6);
 assert.equal(c.map(105.15e6,150000),100.15e6);
 assert.equal(c.map(100.2e6,200000),100.2e6);
 assert.equal(c.map(NaN,250000),100.25e6);
});
test('SEI holdover is bounded, discontinuity resets mapping and missing media clock is not fabricated',()=>{
 const {MediaEpochClock}=load('src/scenes/align/mediaEpochClock.ts');
 const c=new MediaEpochClock();c.map(100e6,0);
 assert.equal(c.map(120e6,1e6),101e6);
 assert.equal(c.map(131e6,12e6),131e6);
 assert.equal(c.status,'unverified');
 c.reset();assert.equal(c.map(90e6,0),90e6);
 assert.equal(c.map(91e6,null),91e6);
});
test('follower small error advances gradually with one shared A/B target',()=>{
 const {AlignEngine}=load('src/scenes/align/useFrameAlign.ts');
 const {FrameQueue}=load('src/scenes/align/frameQueue.ts');
 const e=new AlignEngine();e.setRequiredSides(['A','B']);e.tUs.value=70e6;
 e.sync.presentedRt.A=e.sync.presentedRt.B=70e6;
 for(const side of ['A','B'])e.streams.set(side,{queue:new FrameQueue(),coverage:()=>({from:0,to:100e6}),canSeek:()=>true,seek(){assert.fail('small error must not seek');},advance(t){this.queue.add({rtUs:t,isKey:true,handle:{}});}});
 e.external.accept({t_us:71e6,epoch:1,seq:1,rate:1},0);e.tickLoop(16);
 assert(e.tUs.value>70e6&&e.tUs.value<70.02e6);
 assert(e.playback.speed>1&&e.playback.speed<=1.08);
 assert.equal(e.sync.presentedRt.A,e.sync.presentedRt.B);
});
test('HLS retry measures elapsed time independently of wall clock',async()=>{
 const {HlsHarvester}=load('src/scenes/align/hlsPoller.ts');
 const originalFetch=global.fetch,originalNow=Date.now;let attempts=0;
 global.fetch=async url=>url.endsWith('m3u8')?{ok:true,text:async()=> '#EXTM3U\n#EXT-X-MEDIA-SEQUENCE:1\n#EXTINF:2,\na.mp4\n'}:(attempts++,{ok:false,status:503});
 const h=new HlsHarvester('https://fixture.invalid/x.m3u8',()=>{});
 try{await h.poll();assert.equal(attempts,1);Date.now=()=>1;h.retry.at=performance.now()-1600;await h.poll();assert.equal(attempts,2);}
 finally{Date.now=originalNow;global.fetch=originalFetch;h.stop();}
});

function box(type,...parts){const body=Buffer.concat(parts),b=Buffer.alloc(8);b.writeUInt32BE(body.length+8);b.write(type,4);return Buffer.concat([b,body]);}
function words(...ns){const b=Buffer.alloc(ns.length*4);ns.forEach((n,i)=>b.writeUInt32BE(n>>>0,i*4));return b;}
function fragment(){
 const tfhd=box('tfhd',words(0x020038,1,100,1,0));
 const tfdt=box('tfdt',words(0,1000));
 const make=off=>box('moof',box('traf',tfhd,tfdt,box('trun',words(0x01000801,2,off,100,-100))));
 const moof=make(0);return Buffer.concat([make(moof.length+8),box('mdat',Buffer.from([11,22]))]);
}
test('fMP4 exposes presentation timestamps including signed B-frame composition offsets',()=>{
 const {extractFmp4Samples}=load('src/scenes/align/fmp4.ts');
 const r=extractFmp4Samples(fragment());
 assert.deepEqual(r.samples.map(s=>s.pts),[1100,1000]);
 assert.deepEqual(r.samples.map(s=>s.payload[0]),[11,22]);
});
test('reset prefers server epoch estimate despite a wrong client wall clock',()=>{
 const {createPage}=require('./helpers/director-page.cjs');
 const p=createPage({id:'console',kind:'console'});
 try{
 p.deliver({type:'auth_ok',seat:'DIRECTOR',match_id:'match',account_id:'account',connection_id:p.id,align_authority_src:p.id,authority_epoch:1,align_role:'publisher',align_lease_required:true});
 p.deliver({type:'director_cmd',action:'frame_align',payload:{t_us:70e6,server_now_ms:110000,anchor_age_ms:0,epoch:1,seq:1,src:p.id}},1000);
 p.drain();assert(p.adjust(30,900000));
 assert.equal(p.drain().find(m=>m.action==='frame_align_reset').payload.target_t_us,80e6);
 }finally{p.close();}
});

test('SEI pipeline retains media cadence across a false NTP frame and a single epoch spike',()=>{
 const {buildSeiNal}=load('src/scenes/align/sei.ts');
 const {FrameLockStream}=load('src/scenes/align/frameLock.ts');
 const sample=(seq,rt,ntp)=>{const nal=buildSeiNal('h264',{keyframe:true,clock_ntp:ntp,seq,media_pts:BigInt(seq),realtime_us:BigInt(rt)}).slice(4);return Buffer.concat([words(nal.length),nal]);};
 const samples=[sample(0,100e6,true),sample(1,105.1e6,false),sample(2,100.2e6,true)];
 const make=off=>box('moof',box('traf',box('tfhd',words(0x020028,1,100,0)),box('tfdt',words(0,0)),box('trun',words(0x201,3,off,...samples.map(s=>s.length)))));
 const moof=make(0),data=Buffer.concat([make(moof.length+8),box('mdat',...samples)]);
 const s=new FrameLockStream({setOnSegment(){},setOnError(){},stop(){},harvesterStats(){return {retries:0,gaveUp:0,authFail:0};}});
 s.timescale=1000;s.onSegment({fmt:'fmp4',payload:data,kind:'segment'});
 assert.deepEqual(s.raw.map(s=>s.rtUs),[100e6,100.1e6,100.2e6]);
 assert.equal(s.stats().ntp,2);assert.equal(s.raw.length,3);assert.equal(s.resyncGap,0);
});
test('fMP4 init extracts video timescale, independent of wall time or timezone',()=>{
 const {extractFmp4Samples}=load('src/scenes/align/fmp4.ts');
 const stsd=box('stsd',words(0,1),box('avc1',Buffer.alloc(78)));
 const init=box('moov',box('trak',box('tkhd',words(0,0,0,1)),box('mdia',box('mdhd',words(0,0,0,90000,0)),box('minf',box('stbl',stsd)))));
 assert.equal(extractFmp4Samples(init).timescale,90000);
});
test('legacy anchor fields still work and aged new snapshots remain stale',()=>{
 const {ExternalClock}=load('src/scenes/align/externalClock.ts');
 const a=new ExternalClock();a.accept({t_us:60e6,epoch:1,seq:1,rate:1,effective_at_ms:900,server_now_ms:1000},0);
 assert.equal(a.read(0).t,60.1e6);
 const b=new ExternalClock();b.accept({t_us:60e6,epoch:1,seq:1,rate:1,anchor_age_ms:2000},0);assert(b.read(0).stale);
});
test('stable receive history survives wall rollback and does not interpolate discrete values',()=>{
 const fresh=require('./load-ts.cjs')();
 const {stableEpochNow}=fresh('src/utils/epochClock.ts');
 const {PresentationHistory}=fresh('src/scenes/align/presentationHistory.ts');
 const oldPerf=global.performance,oldNow=Date.now;let mono=0,wall=100000;
 global.performance={now:()=>mono};Date.now=()=>wall;
 try{const h=new PresentationHistory();h.add(stableEpochNow(),{score:1});mono=100;wall=1;h.add(stableEpochNow(),{score:2});
 assert.deepEqual(h.at(100050),{score:1});assert.deepEqual(h.at(100100),{score:2});}
 finally{global.performance=oldPerf;Date.now=oldNow;}
});
test('SEI persistent in-budget offset slews instead of stepping or blocking',()=>{
 const {MediaEpochClock}=load('src/scenes/align/mediaEpochClock.ts');
 const c=new MediaEpochClock();c.map(100e6,0);let prev=100e6;
 for(let media=100000;media<=10e6;media+=100000){
  const rt=c.map(102e6+media,media);
  assert(rt>prev);assert(rt-prev<=105000);prev=rt;
 }
 assert.equal(c.status,'slewing');
});
test('SEI missing timestamps cannot extend holdover forever',()=>{
 const {MediaEpochClock}=load('src/scenes/align/mediaEpochClock.ts');
 const c=new MediaEpochClock();c.map(100e6,0);
 for(let media=1e6;media<=10e6;media+=1e6)assert.equal(c.map(NaN,media),100e6+media);
 assert.equal(c.map(NaN,11e6),null);
});
test('countdown replay converts epoch to local monotonic instants; wall jumps do not change pause duration',()=>{
 const {createPage}=require('./helpers/director-page.cjs');const p=createPage({id:'stage'});
 const saved=Date.now;
 try{
 p.deliver({type:'director_cmd',action:'state_sync',payload:{soon:{target_ms:10000,started_at:99000,now_ms:100000}}},1000);
 assert.equal(p.store.soonCmdState.startedAt,0);
 Date.now=()=>999999999;
 p.deliver({type:'director_cmd',action:'soon_pause'},2000);
 assert.equal(p.store.soonCmdState.pausedAt-p.store.soonCmdState.startedAt,2000);
 Date.now=()=>1;
 p.deliver({type:'director_cmd',action:'soon_start'},3000);
 assert.equal(3000-p.store.soonCmdState.startedAt,2000);
 }finally{Date.now=saved;p.close();}
});
