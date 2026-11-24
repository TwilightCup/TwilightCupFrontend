const {test}=require('node:test'); const assert=require('node:assert/strict'); const path=require('node:path');
const load=require('./load-ts.cjs')({[path.resolve('src/api/config.ts')]:{restBase:'/api'}});
const {api,ApiError}=load('src/api/client.ts');
test('actual REST client sends Bearer and full PUT fields, parses nested stable conflict code',async()=>{
 const prior=global.fetch;const calls=[];
 global.fetch=async(url,init)=>{calls.push({url,init});return {ok:false,status:409,text:async()=>JSON.stringify({detail:{code:'stream_links_version_conflict',message:'Reload stream links',current_version:3}})};};
 try {
  await assert.rejects(api.putStreamLinks('match/id',{expected_version:2,hlsA:'',hlsB:'',embedA:'',embedB:''},'own-token'),e=>e instanceof ApiError&&e.code===409&&e.errorCode==='stream_links_version_conflict'&&e.message==='Reload stream links');
  assert.equal(calls[0].url,'/api/me/matches/match%2Fid/stream-links');assert.equal(calls[0].init.headers.Authorization,'Bearer own-token');
  assert.equal(JSON.parse(calls[0].init.body).expected_version,2);
 }finally{global.fetch=prior;}
});
test('actual REST client distinguishes missing route from missing match',async()=>{
 const prior=global.fetch;
 try {
  global.fetch=async()=>({ok:false,status:404,text:async()=>JSON.stringify({detail:'Not Found'})});
  await assert.rejects(api.getStreamLinks('m','t'),e=>e.errorCode===undefined&&e.message==='Not Found');
  global.fetch=async()=>({ok:false,status:404,text:async()=>JSON.stringify({detail:{code:'match_not_found',message:'Match not found'}})});
  await assert.rejects(api.getStreamLinks('m','t'),e=>e.errorCode==='match_not_found');
 }finally{global.fetch=prior;}
});
