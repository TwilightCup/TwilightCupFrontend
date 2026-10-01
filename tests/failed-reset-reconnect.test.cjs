const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createPage}=require('./helpers/director-page.cjs');
function auth(p,id=p.id){p.deliver({type:'auth_ok',seat:'DIRECTOR',match_id:'match',account_id:'account',connection_id:id,
 align_authority_src:id,authority_epoch:id===p.id?1:3,align_role:'publisher',align_lease_required:false});}
function authority(p,owner,epoch,record,required=false){p.deliver({type:'director_cmd',action:'align_authority',payload:{connection_id:owner,
 src:owner,role:'publisher',epoch,timeline_version:1,lease_required:required,t_floor_us:100e6,reset:record}});}
function failed(p){return {request_id:'failed-reset',status:'failed',code:'PREPARE_TIMEOUT',owner_id:p.id,authority_epoch:2,
 timeline_version:1,target_t_us:100e6,account_id:'account',match_id:'match'};}
test('failed own reset reconnects the latest console without faking ack or reloading media',async()=>{
 const p=createPage({id:'failed-console',kind:'console'});
 try {
  auth(p);for(let now=0;now<=1000;now+=25)p.tick(now);p.drain();
  const streams=[...p.engine.streams.values()],r=failed(p);
  authority(p,p.id,2,r);await Promise.resolve();
  assert.equal(p.socket.connectCalls,2);assert.equal(p.store.resetPending,false);
  assert.deepEqual([...p.engine.streams.values()],streams);
  assert(!p.drain().some(m=>m.action==='frame_align_reset_ack'||m.action==='frame_align_reset'));
  auth(p,'new-connection');authority(p,'new-connection',3,r);
  for(let now=1025;now<=1800;now+=25)p.tick(now);
  assert.equal(p.engine.sync.state,'playing');
  assert(p.drain().some(m=>m.action==='frame_align'));
  assert.equal(p.socket.args[4],'console');
  const second={...r,request_id:'second-failure',owner_id:'new-connection',authority_epoch:4,timeline_version:2};
  p.deliver({type:'director_cmd',action:'align_authority',payload:{connection_id:'new-connection',src:'new-connection',role:'publisher',epoch:4,
   timeline_version:2,lease_required:false,t_floor_us:100e6,reset:second}});
  await Promise.resolve();assert.equal(p.socket.connectCalls,2,'30s cooldown prevents repeated registration');
  p.heartbeat(90000);assert.equal(p.socket.connectCalls,3,'recovery resumes after cooldown, without another reset request');
 } finally {p.close();}
});
test('a failed reset cannot reconnect after authority was lost before the queued recovery',async()=>{
 const p=createPage({id:'old-console',kind:'console'});
 try {
  auth(p);const r=failed(p);authority(p,p.id,2,r);
  p.deliver({type:'director_cmd',action:'align_authority',payload:{connection_id:p.id,src:'other',role:'follower',epoch:3,timeline_version:1,lease_required:false,t_floor_us:100e6}});
  await Promise.resolve();assert.equal(p.socket.connectCalls,1);
 } finally {p.close();}
});
test('legacy lease mode and unavailable media never trigger automatic publisher registration',async()=>{
 for(const required of [true,false]) {
  const p=createPage({id:`blocked-${required}`,kind:'console'});
  try {
   auth(p);if(!required)p.engine.streams.get('B').coverage=()=>null;
   authority(p,p.id,2,failed(p),required);await Promise.resolve();
   assert.equal(p.socket.connectCalls,1);
   if(!required) {
    p.engine.streams.get('B').coverage=()=>({from:0,to:110e6});
    p.heartbeat(1000);
    assert.equal(p.socket.connectCalls,2,'late media readiness can recover without any presented frames');
   }
  } finally {p.close();}
 }
});
