const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createPage } = require('./helpers/director-page.cjs');
const auth = id => ({type:'auth_ok',seat:'DIRECTOR',match_id:'match',account_id:'account',connection_id:id,
 align_authority_src:id,authority_epoch:1,align_role:'publisher',align_lease_required:true});
function authority(p, version=0, reset, src=p.id, epoch=version+1) {
 p.deliver({type:'director_cmd',action:'align_authority',payload:{connection_id:p.id,src,epoch,
  role:src===p.id?'publisher':'follower',timeline_version:version,lease_required:true,t_floor_us:reset?.target_t_us ?? null,reset}});
}
function result(p,r){p.deliver({type:'director_cmd',action:'frame_align_reset_result',payload:r});}
function boot(){const p=createPage({id:'console',kind:'console'});p.deliver(auth(p.id));authority(p);for(let n=0;n<=1000;n+=25)p.tick(n);p.drain();return p;}
function reset(p,target,status='preparing') {return {request_id:'request1',status,code:'PREPARING',timeline_version:1,authority_epoch:2,owner_id:p.id,target_t_us:target,account_id:'account',match_id:'match'};}
test('only publisher may apply once; target uses click wall time and delta',()=>{
 const p=boot(),s=createPage({id:'stage'});
 try{assert(p.store.canAdjustAnchor);assert(!s.adjust(30,110000));assert(!p.adjust(NaN,110000));
  assert(p.adjust(30,110000));assert(!p.adjust(30,110000));
  const out=p.drain();assert.equal(out.length,1);assert.equal(out[0].action,'frame_align_reset');
  assert.equal(out[0].payload.target_t_us,80e6);assert.equal(out[0].payload.timeline_version,0);
  result(p,{request_id:out[0].payload.request_id,status:'rejected',code:'INVALID_REQUEST',timeline_version:0});
  assert(p.store.canAdjustAnchor);
 }finally{p.close();s.close();}
});
test('new timeline prepares actual frames, sends versioned status before ack, waits for completion',()=>{
 const p=boot();try{
 const r=reset(p,85e6);authority(p,1,r);p.tick(1025);
 const sent=p.drain();const ack=sent.findIndex(m=>m.action==='frame_align_reset_ack');
 assert(ack>0,JSON.stringify(sent));assert(sent.slice(0,ack).some(m=>m.action==='frame_align_status'&&m.payload.timeline_version===1&&m.payload.decode_ready));
 assert.equal(sent[ack].payload.presented_t_us,85e6);assert(!sent.some(m=>m.action==='frame_align'));
 assert(p.store.resetPending);const seeks=p.snapshot().seeks;
 authority(p,1,r);result(p,r);p.tick(1050);assert.deepEqual(p.snapshot().seeks,seeks);assert.equal(p.drain().length,0);
 result(p,{...r,status:'completed',code:'OK'});p.tick(1075);
 assert(!p.store.resetPending);assert(p.drain().some(m=>m.action==='frame_align'&&m.payload.timeline_version===1));
 const t=p.engine.tUs.value;
 p.deliver({type:'director_cmd',action:'frame_align',payload:{t_us:100e6,src:p.id,epoch:1,seq:999,timeline_version:0}});
 assert.equal(p.engine.tUs.value,t);assert.equal(p.store.timelineVersion,1);
 }finally{p.close();}
});
test('backward reset keeps pixels and real frame floor; no false ack or deadline relinquish',()=>{
 const p=boot();try{
 const shown=p.engine.sync.presentedRt.A;const r=reset(p,shown-5e6);authority(p,1,r);
 for(let now=1025;now<=12000;now+=25)p.tick(now);
 assert.equal(p.engine.sync.presentedRt.A,shown);assert(p.canvases.every(c=>p.engine.hasCanvasImage(c)));
 assert(p.engine.pictureExpired.value);
 const sent=p.drain();assert(!sent.some(m=>m.action==='frame_align_reset_ack'));
 assert(!sent.some(m=>m.action==='frame_align_status'&&m.payload.state==='relinquish'));
 result(p,{...r,status:'failed',code:'PREPARE_TIMEOUT'});assert(!p.store.resetPending);assert(p.store.canAdjustAnchor);
 }finally{p.close();}
});
test('ownership loss disables editing and new owner does not replay historical reset',()=>{
 const p=boot();try{
 const r=reset(p,85e6);authority(p,1,r);p.tick(1025);p.drain();
 authority(p,1,{...r,status:'failed'},'other',3);assert(!p.store.canAdjustAnchor);
 p.tick(1050);assert(!p.drain().some(m=>m.action==='frame_align_reset_ack'));
 }finally{p.close();}
});
test('resync reload runs once only after own reset acceptance, never on rejection',()=>{
 const p=boot();let calls=0;
 try {
  assert(p.store.applyAnchorDelay(30,()=>{calls++;return true;}));
  const request=p.drain().find(m=>m.action==='frame_align_reset').payload;
  assert.equal(calls,0);
  const r={...reset(p,request.target_t_us),request_id:request.request_id};
  authority(p,1,r);assert.equal(calls,1);
  authority(p,1,r);result(p,r);assert.equal(calls,1);
  result(p,{...r,status:'completed'});
  assert(p.store.applyAnchorDelay(30,()=>{calls++;return true;}));
  const next=p.drain().find(m=>m.action==='frame_align_reset').payload;
  result(p,{request_id:next.request_id,status:'rejected',code:'NO',timeline_version:1});
  assert.equal(calls,1);
 } finally {p.close();}
});
test('lost authority cancels pending resync; failed reload is not reported as plain success',()=>{
 const p=boot();let calls=0;
 try {
  p.store.applyAnchorDelay(30,()=>{calls++;return false;});
  let request=p.drain().find(m=>m.action==='frame_align_reset').payload;
  let r={...reset(p,request.target_t_us),request_id:request.request_id};
  authority(p,1,r);result(p,{...r,status:'completed'});
  assert.equal(calls,1);assert.match(p.store.anchorAdjustment,/双路重拉未发送/);
  p.store.applyAnchorDelay(30,()=>{calls++;return true;});
  request=p.drain().find(m=>m.action==='frame_align_reset').payload;
  r={...reset(p,request.target_t_us),request_id:request.request_id,timeline_version:2,authority_epoch:3};
  authority(p,2,{...r,owner_id:'other'},'other',3);
  assert.equal(calls,1);assert(!p.store.canAdjustAnchor);
 } finally {p.close();}
});
test('10 second resync retries once at 20 seconds after preparation timeout',()=>{
 const p=boot();let reloads=0,fallbacks=0;const realNow=Date.now;Date.now=()=>110000;
 try {
  assert(p.store.applyAnchorDelay(10,()=>{reloads++;return true;},()=>fallbacks++));
  let req=p.drain().find(m=>m.action==='frame_align_reset').payload;
  assert.equal(req.target_t_us,100e6);
  let r={...reset(p,req.target_t_us),request_id:req.request_id};
  authority(p,1,r);assert.equal(reloads,1);
  Date.now=()=>120000;
  result(p,{...r,status:'failed',code:'PREPARE_TIMEOUT'});
  assert.equal(fallbacks,1);assert(p.store.resetPending);
  req=p.drain().find(m=>m.action==='frame_align_reset').payload;
  assert.equal(req.target_t_us,100e6);assert.equal(req.timeline_version,1);
  result(p,{...r,status:'failed',code:'PREPARE_TIMEOUT'});
  assert.equal(p.drain().filter(m=>m.action==='frame_align_reset').length,0);assert(p.store.resetPending);
  r={...reset(p,req.target_t_us),request_id:req.request_id,timeline_version:2,authority_epoch:3};
  authority(p,2,r);assert.equal(reloads,2);
  result(p,{...r,status:'failed',code:'PREPARE_TIMEOUT'});
  assert.equal(p.drain().filter(m=>m.action==='frame_align_reset').length,0);assert.equal(fallbacks,1);
 } finally {Date.now=realNow;p.close();}
});
test('manual delay and successful resync do not trigger automatic fallback',()=>{
 for(const delta of [10,15,20]) {
  const p=boot();let fallback=0;
  try {
   p.store.applyAnchorDelay(delta,()=>true,()=>fallback++);
   const req=p.drain().find(m=>m.action==='frame_align_reset').payload;
   const r={...reset(p,req.target_t_us),request_id:req.request_id};authority(p,1,r);
   result(p,{...r,status:delta===10?'completed':'failed',code:'PREPARE_TIMEOUT'});
   assert.equal(fallback,0);assert(!p.drain().some(m=>m.action==='frame_align_reset'));
  } finally {p.close();}
 }
});
test('publisher resets to initial delta plus 5s only above initial delta plus 15s',()=>{
 const p=boot(),realNow=Date.now;
 try {
  const t=p.engine.tUs.value;
  Date.now=()=>t/1000+25000;p.heartbeat(1600);
  assert(!p.drain().some(m=>m.action==='frame_align_reset'));
  Date.now=()=>t/1000+25001;p.heartbeat(2000);
  const req=p.drain().find(m=>m.action==='frame_align_reset');
  assert(req);assert.equal(req.payload.target_t_us,Math.round(t+10001000));
  p.heartbeat(2400);assert(!p.drain().some(m=>m.action==='frame_align_reset'));
 } finally {Date.now=realNow;p.close();}
});
test('manual delta 20 becomes the baseline; automatic target remains 25 across resets',()=>{
 const p=boot(),realNow=Date.now;
 try {
  assert(p.adjust(20,105000));
  let req=p.drain().find(m=>m.action==='frame_align_reset').payload;
  let r={...reset(p,req.target_t_us),request_id:req.request_id};
  authority(p,1,r);p.tick(1025);result(p,{...r,status:'completed'});p.tick(1050);p.drain();
  for(let version=2;version<=3;version++) {
   const t=p.engine.tUs.value,at=version*20000;
   Date.now=()=>t/1000+25000;p.heartbeat(at);p.drain();
   Date.now=()=>t/1000+35000;p.heartbeat(at+400);
   assert(!p.drain().some(m=>m.action==='frame_align_reset'));
   Date.now=()=>t/1000+35001;p.heartbeat(at+800);
   req=p.drain().find(m=>m.action==='frame_align_reset').payload;
   assert.equal(req.target_t_us,Math.round(t+10001000));
   r={...reset(p,req.target_t_us),request_id:req.request_id,timeline_version:version,authority_epoch:version+1};
   authority(p,version,r);p.tick(at+825);result(p,{...r,status:'completed'});p.tick(at+850);p.drain();
  }
 } finally {Date.now=realNow;p.close();}
});
