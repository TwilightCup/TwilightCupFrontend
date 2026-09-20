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
