const {test}=require('node:test');const assert=require('node:assert/strict');
const {createPage}=require('./helpers/director-page.cjs');
const snap=(version,hlsA='')=>({match_id:'match',version,hlsA,hlsB:'',embedA:'',embedB:'',updated_at_ms:null,updated_by:null});
const auth={type:'auth_ok',account_id:'a',match_id:'match',seat:'DIRECTOR',display_name:'a'};
test('director/stage actual socket consumes canonical WS; older GET and legacy config cannot override',async()=>{
 const p=createPage({id:'stage'});p.deliver(auth);p.deliver({type:'stream_links_update',payload:snap(3,'https://x.test/a')});
 p.deliver({type:'director_cmd',action:'config_update',payload:{config:{hlsA:'https://old.test/a',decoupled:true}}});
 await new Promise(r=>setImmediate(r)); assert.equal(p.links.version,3);assert.equal(p.links.values.hlsA,'https://x.test/a');
 assert.equal(p.store.remoteConfig.hlsA,undefined);assert.equal(p.store.remoteConfig.decoupled,true);p.close();
});
test('new frontend never sends link fields over legacy WS, retains other config controls',()=>{
 const p=createPage({id:'console',kind:'console'});p.deliver(auth);p.drain();
 p.store.sendDirectorCommand('config_update',{config:{hlsA:'https://x.test/a',refreshA:2,alignA:true}});
 const command=p.drain().find(m=>m.action==='config_update');assert.deepEqual(command.payload.config,{refreshA:2,alignA:true});p.close();
});
