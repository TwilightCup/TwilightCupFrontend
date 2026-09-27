const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {createPinia,disposePinia}=require('pinia');
const createLoader=require('./load-ts.cjs');
test('referee refresh retrieves messages while round loading is still pending, merging live overlap',async()=>{
 let socket,resolveRounds,resolveChat;
 const rounds=new Promise(resolve=>resolveRounds=resolve),chat=new Promise(resolve=>resolveChat=resolve);
 class Socket {constructor(){socket=this;}connect(){}disconnect(){} }
 const overrides=Object.fromEntries(Object.entries({
  'src/ws/socket.ts':{MatchSocket:Socket},
  'src/stores/auth.ts':{useAuthStore:()=>({token:'test-token'})},
  'src/locales.ts':{t:key=>key},
  'src/api/client.ts':{api:{getMyMatch:async()=>({}),getMatchLog:()=>rounds,getChatLog:()=>chat}},
 }).map(([file,value])=>[path.resolve(file),value]));
 const {useMatchStore}=createLoader(overrides)('src/stores/match.ts');
 const pinia=createPinia(),s=useMatchStore(pinia);
 try {
  s.connect('match');socket.onMessage({type:'auth_ok',match_id:'match',seat:'REFEREE'});
  socket.onMessage({type:'chat',seat:'REFEREE',sender_name:'Ref',text:'new',ts:new Date(2010).toISOString()});
  resolveChat([{id:'old',match_id:'match',sender_name:'Ref',text:'old',ts:new Date(1000).toISOString()},
   {id:'new',match_id:'match',sender_name:'Ref',text:'new',ts:new Date(2000).toISOString()}]);
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(s.messages.map(r=>r.id),['old','new']);
  assert.equal(s.messages[1].seat,'REFEREE');
  assert(s.historyLoading,'round load is still pending, but chat already visible');
  resolveRounds({initial_info:{},round_ids:[]});await new Promise(resolve=>setImmediate(resolve));
 } finally {s.disconnect();disposePinia(pinia);}
});
