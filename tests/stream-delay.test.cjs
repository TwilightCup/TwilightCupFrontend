const {test}=require('node:test');
const assert=require('node:assert/strict');
const load=require('./load-ts.cjs')();
const {AlignEngine}=load('src/scenes/align/useFrameAlign.ts');
const {publisherTarget}=load('src/scenes/align/rateControl.ts');
const {planCatchup,CATCHUP}=load('src/scenes/align/rateControl.ts');
const {createPage}=require('./helpers/director-page.cjs');
test('publisher target uses configured delay from the slow frontier, preserving the floor',()=>{
 assert.equal(publisherTarget(0,100e6,null,15),85e6);
 assert.equal(publisherTarget(0,100e6,null,20),80e6);
 assert.equal(publisherTarget(0,100e6,90e6,15),90e6);
 assert.equal(publisherTarget(90e6,100e6,null,15),null);
});
test('common frontier requires every active side; one missing stream cannot substitute wall time',()=>{
 const e=new AlignEngine();e.setRequiredSides(['A','B']);
 e.streams.set('A',{coverage:()=>({from:0,to:120e6})});
 assert.equal(e.slowestFrontierUs(),null);
 e.streams.set('B',{coverage:()=>({from:0,to:100e6})});
 assert.equal(e.slowestFrontierUs(),100e6);
 assert.equal(e.delayTargetUs(15),85e6);
 e.setRequiredSides([]);assert.equal(e.delayTargetUs(15),null);
});
test('manual resync uses slower stream even with a wildly wrong browser clock',()=>{
 const p=createPage({id:'delay-console',kind:'console'});
 try {
  p.deliver({type:'auth_ok',seat:'DIRECTOR',match_id:'match',account_id:'account',connection_id:p.id,
   align_authority_src:p.id,authority_epoch:1,align_role:'publisher'});
  p.engine.streams.get('A').coverage=()=>({from:0,to:120e6});
  p.engine.streams.get('B').coverage=()=>({from:0,to:100e6});
  assert(p.adjust(15,9e12));
  assert.equal(p.drain().find(m=>m.action==='frame_align_reset').payload.target_t_us,85e6);
 } finally {p.close();}
});
test('resync without common coverage fails clearly and sends no invented reset',()=>{
 const p=createPage({id:'no-media',kind:'console'});
 try {
  p.deliver({type:'auth_ok',seat:'DIRECTOR',match_id:'match',account_id:'account',connection_id:p.id,
   align_authority_src:p.id,authority_epoch:1,align_role:'publisher'});
  p.engine.streams.get('B').coverage=()=>null;
  assert(!p.adjust(15,9e12));
  assert(!p.drain().some(m=>m.action==='frame_align_reset'));
  assert.match(p.store.anchorAdjustment,/双路/);
 } finally {p.close();}
});
test('configured delay includes segment cadence reserve, with smooth monotonic playback',()=>{
 for(const delta of [5,10,15,20,35]) {
  let current=publisherTarget(0,100e6,null,delta),mode='normal';
  assert.equal(current,100e6-delta*1e6);
  for(let now=16;now<=120000;now+=16) {
   const slow=100e6+Math.floor(now/2000)*2e6;
   const authority=publisherTarget(0,slow,current,delta,false);
   const plan=planCatchup({current,authority,from:0,safeTo:slow,elapsedMs:16,mode,
    reserveUs:Math.min(CATCHUP.publisherReserveUs,delta*1e6)});
   assert.equal(plan.rate,1);assert(plan.t>current);
   assert(Math.abs((slow-plan.t)/1e6-delta)<5);
   current=plan.t;mode=plan.mode;
  }
 }
});
test('cold startup chooses the slower side minus configured delay for both decoders',()=>{
 for(const delta of [10,15,20]) {
  const p=createPage({id:`startup-${delta}`,kind:'console'});
  try {
   p.engine.setDelaySeconds(delta);
   p.engine.streams.get('A').coverage=()=>({from:0,to:120e6});
   p.engine.streams.get('B').coverage=()=>({from:0,to:100e6});
   p.deliver({type:'auth_ok',seat:'DIRECTOR',match_id:'match',account_id:'account',connection_id:p.id,
    align_authority_src:p.id,authority_epoch:1,align_role:'publisher'});
   p.tick(0);
   for(const stream of p.engine.streams.values()) assert.equal(stream.cursor,100e6-delta*1e6);
   p.tick(100);p.tick(200);p.tick(300);
   assert.equal(p.engine.sync.state,'playing');
   assert.equal(p.engine.tUs.value,100e6-delta*1e6);
  } finally {p.close();}
 }
});
test('an extreme wall clock cannot trigger catchup when media-relative delay is healthy',()=>{
 const p=createPage({id:'clock-skew',kind:'console'}),saved=Date.now;
 try {
  Date.now=()=>9e12;
  p.deliver({type:'auth_ok',seat:'DIRECTOR',match_id:'match',account_id:'account',connection_id:p.id,
   align_authority_src:p.id,authority_epoch:1,align_role:'publisher'});
  for(let now=0;now<=1000;now+=25)p.tick(now);
  assert.equal(p.engine.sync.state,'playing');
  assert(!p.drain().some(m=>m.action==='frame_align_reset'));
 } finally {Date.now=saved;p.close();}
});
