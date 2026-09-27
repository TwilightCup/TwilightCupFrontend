const {test}=require('node:test');
const assert=require('node:assert/strict');
const {loadScoreRounds}=require('./load-ts.cjs')()('src/scenes/align/loadScoreRounds.ts');
const round=(n,id,extra={})=>({match_id:'m',round_no:n,id,...extra});
test('restores omitted rematches and non-contiguous log round numbers',async()=>{
 const records=[round(1,'a',{superseded_by:'b'}),round(2,'b'),round(3,'c',{superseded_by:'d'}),round(4,'d')];
 assert.deepEqual(await loadScoreRounds('m',['a','c'],async n=>records[n-1]),records);
});
test('does not restore partial or wrong-match history',async()=>{
 await assert.rejects(loadScoreRounds('m',['a','c'],async n=>n===1?round(1,'a'):Promise.reject(new Error('404'))));
 await assert.rejects(loadScoreRounds('m',['a'],async()=>({...round(1,'a'),match_id:'other'})));
});
test('empty pre-match history does not request nonexistent rounds',async()=>{
 assert.deepEqual(await loadScoreRounds('m',[],async()=>assert.fail()),[]);
});
test('stage with no video T retains restored wins rather than showing zero',async()=>{
 const {createPage}=require('./helpers/director-page.cjs');
 const p=createPage({id:'stage',api:{getMatchLog:async()=>({initial_info:{},round_ids:['a']}),
  getRoundDetail:async()=>({...round(1,'a'),match_id:'match',counted:true,verdict:1,ended_at:'2026-09-01T00:00:00Z'})}});
 try {
  p.deliver({type:'auth_ok',seat:'DIRECTOR',account_id:'account',match_id:'match'});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(p.engine.tUs.value,null);
  assert.deepEqual(p.store.presentedScore,{winsA:1,winsB:0});
 }finally{p.close();}
});
