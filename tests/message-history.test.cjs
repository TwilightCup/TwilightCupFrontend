const {test}=require('node:test');
const assert=require('node:assert/strict');
const {mergeMessageHistory:merge}=require('./load-ts.cjs')()('src/utils/mergeMessageHistory.ts');
const row=(id,ms,text='hello')=>({id,ts:new Date(ms).toISOString(),text});
const key=r=>r.text;
test('history merges with overlapping realtime messages chronologically and idempotently',()=>{
 const history=[row('db1',1000),row('db2',2000,'next')];
 const live=[row('live-1',2010,'next'),row('live-2',3000,'new')];
 const merged=merge(live,history,key);
 assert.deepEqual(merged.map(r=>r.id),['db1','db2','live-2']);
 assert.deepEqual(merge(merged,history,key),merged);
});
test('identical repeated messages retain multiplicity; unrelated live events survive',()=>{
 const history=[row('db1',1000),row('db2',1020)];
 const live=[row('live-1',1001),row('live-2',1021),row('live-3',1041),row('live-4',2000,'error')];
 const merged=merge(live,history,key);assert.equal(merged.length,4);
 assert.deepEqual(merge(merged,history,key),merged);
 assert.equal(merge([],history,key).length,2);
});
