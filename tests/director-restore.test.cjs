const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createPage}=require('./helpers/director-page.cjs');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const auth={type:'auth_ok',seat:'DIRECTOR',match_id:'match',account_id:'account',connection_id:'stage',align_role:'follower',authority_epoch:1};
test('fresh stage restores score at delayed T and director message log without needing new verdict',async()=>{
 let resolveChat;const chat=new Promise(resolve=>resolveChat=resolve);
 const p=createPage({id:'stage',api:{
  getMatchLog:async()=>({initial_info:{win_threshold:3},round_ids:['r1','r2']}),
  getRoundDetail:async(_,n)=>({id:`r${n}`,round_no:n,match_id:'match',counted:true,verdict:n===1?1:2,ended_at:new Date(n*1000).toISOString()}),
  getChatLog:()=>chat,
 }});
 try {
  p.deliver(auth);await flush();
  assert.equal(p.store.winsA,1);assert.equal(p.store.winsB,1);
  p.engine.tUs.value=1500000;
  assert.deepEqual(p.store.presentedScore,{winsA:1,winsB:0});
  p.engine.tUs.value=2500000;assert.deepEqual(p.store.presentedScore,{winsA:1,winsB:1});
  p.deliver({type:'chat',seat:'PLAYER_A',sender_name:'A',text:'hello',ts:new Date(3010).toISOString()});
  resolveChat([{id:'msg1',match_id:'match',is_system:false,sender_name:'A',text:'hello',ts:new Date(3000).toISOString()}]);
  await flush();assert.equal(p.store.messages.length,1);assert.equal(p.store.messages[0].id,'msg1');
 } finally {p.close();}
});
test('delayed old-match history cannot overwrite a newly selected match',async()=>{
 let oldChat;const chat=new Promise(resolve=>oldChat=resolve);
 let oldRounds;const rounds=new Promise(resolve=>oldRounds=resolve);
 const p=createPage({id:'stage',api:{getChatLog:mid=>mid==='match'?chat:Promise.resolve([]),
 getMatchLog:async mid=>({initial_info:{},round_ids:mid==='match'?['r1']:[]}),getRoundDetail:()=>rounds}});
 try {
  p.deliver(auth);await flush();p.deliver({...auth,match_id:'next'});await flush();
  oldChat([{id:'old',match_id:'match',is_system:true,text:'old',ts:new Date().toISOString()}]);
  oldRounds({id:'r1',round_no:1,match_id:'match',counted:true,verdict:1,ended_at:new Date(1000).toISOString()});
  await flush();assert.equal(p.store.winsA,0);assert.equal(p.store.messages.length,0);
 } finally {p.close();}
});
