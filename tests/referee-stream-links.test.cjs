const {test}=require('node:test');const assert=require('node:assert/strict');const path=require('node:path');
const {createPinia,disposePinia}=require('pinia');const loader=require('./load-ts.cjs');
test('actual referee socket receives shared links and refresh remains local without a config write',async()=>{
 let socket;const sent=[];class Socket{constructor(){socket=this;}connect(){}disconnect(){}send(m){sent.push(m);return true;}}
 const load=loader({
 [path.resolve('src/ws/socket.ts')]:{MatchSocket:Socket},
 [path.resolve('src/api/client.ts')]:{api:{getStreamLinks:async()=>({match_id:'m',version:0,hlsA:'',hlsB:'',embedA:'',embedB:'',updated_at_ms:null,updated_by:null})}},
 [path.resolve('src/stores/auth.ts')]:{useAuthStore:()=>({token:'referee-token'})},
 [path.resolve('src/locales.ts')]:{t:key=>key}
 });
 const pinia=createPinia();const match=load('src/stores/match.ts').useMatchStore(pinia);match.connect('m');
 socket.onMessage({type:'auth_ok',match_id:'m',account_id:'referee',seat:'REFEREE',display_name:'R'});
 socket.onMessage({type:'stream_links_update',payload:{match_id:'m',version:2,hlsA:'https://x.test/a',hlsB:'',embedA:'',embedB:'123',updated_at_ms:1790000000000,updated_by:'director'}});
 const config=load('src/composables/useRefereeStreamConfig.ts').useRefereeStreamConfig();await new Promise(r=>setImmediate(r));
 assert.equal(config.config.value.hlsA,'https://x.test/a');config.refreshStream('B');
 assert.equal(config.config.value.refreshB,1);assert.equal(config.config.value.refreshA,0);assert.deepEqual(sent,[]);
 assert.equal(config.save,undefined,'referee has no link editing method');match.disconnect();disposePinia(pinia);
});
