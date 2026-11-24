const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createPinia, disposePinia } = require('pinia');
const loader = require('./load-ts.cjs');
const empty = { hlsA: '', hlsB: '', embedA: '', embedB: '' };
const snapshot = (version, values = {}, match_id = 'm') => ({ ...empty, match_id, version, updated_at_ms: version ? 1790000000000 : null, updated_by: version ? 'a' : null, ...values });
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return { promise, resolve, reject }; };
function fixture(api = {}) {
  class ApiError extends Error { constructor(code, message, errorCode) { super(message); Object.assign(this,{code,errorCode}); } }
  const load = loader({ [path.resolve('src/api/client.ts')]: { api, ApiError } });
  const pinia = createPinia();
  const store = load('src/stores/streamLinks.ts').useStreamLinksStore(pinia);
  return { store, ApiError, close: () => disposePinia(pinia) };
}
test('cold page uses server canonical links; version0 cannot auto-import local or URL links', async () => {
  const f = fixture({ getStreamLinks: async () => snapshot(0) });
  await f.store.activate('token','m','a');
  assert.deepEqual(f.store.linksFor('m', { hlsA: 'https://old.test/a' }),empty);
  assert.equal(f.store.version,0); assert.equal(f.store.loaded,true); f.close();
});
test('save uses edit version, applies canonical trimming only after PUT success, no optimistic playback', async () => {
  const pending = deferred(); let request;
  const f=fixture({ getStreamLinks: async()=>snapshot(1,{hlsA:'https://old.test/a'}), putStreamLinks: async(...args)=>{request=args; return pending.promise;} });
  await f.store.activate('t','m','a');
  const draft={...empty,hlsA:' https://new.test/a '};
  const saving=f.store.save(draft,1);
  assert.equal(f.store.values.hlsA,'https://old.test/a'); assert.equal(f.store.saving,true);
  pending.resolve(snapshot(2,{hlsA:'https://new.test/a'})); assert.equal(await saving,true);
  assert.deepEqual(request,['m',{expected_version:1,...draft},'t']);
  assert.equal(f.store.values.hlsA,'https://new.test/a'); assert.equal(draft.hlsA,' https://new.test/a '); f.close();
});
test('conflict reloads canonical without overwriting draft or auto retrying PUT', async()=>{
  let reads=0,writes=0; const f=fixture({getStreamLinks:async()=>snapshot(++reads),putStreamLinks:async()=>{writes++;throw new f.ApiError(409,'Reload','stream_links_version_conflict');}});
  await f.store.activate('t','m','a'); const draft={...empty,embedB:'123'};
  assert.equal(await f.store.save(draft,1),false); assert.equal(writes,1); assert.equal(f.store.version,2);
  assert.equal(f.store.conflict,true); assert.equal(draft.embedB,'123'); assert.equal(f.store.errorCode,'stream_links_version_conflict'); f.close();
});
test('WS/GET race and duplicate versions cannot roll back fields or metadata',async()=>{
  const d=deferred(),f=fixture({getStreamLinks:()=>d.promise}); const loading=f.store.activate('t','m','a');
  f.store.receive(snapshot(5,{embedB:'55'})); d.resolve(snapshot(2)); await loading;
  assert.equal(f.store.version,5); assert.equal(f.store.values.embedB,'55');
  assert.equal(f.store.receive(snapshot(5,{embedB:'bad'})),false);
  assert.equal(f.store.receive(snapshot(6,{},'other')),false);
  assert.equal(f.store.receive({...snapshot(6),version:NaN}),false); f.close();
});
test('clear saved links remains authoritative over old URL/cache; no-op PUT retains version',async()=>{
  const f=fixture({getStreamLinks:async()=>snapshot(4,{hlsA:'https://x.test/a'}),putStreamLinks:async()=>snapshot(5)});
  await f.store.activate('t','m','a'); await f.store.save(empty,4);
  assert.deepEqual(f.store.linksFor('m',{hlsA:'https://old.test/a'}),empty);
  assert.equal(f.store.receive(snapshot(4)),false); assert.equal(f.store.version,5); f.close();
});
test('account/match switch invalidates in-flight GET/PUT, clears old links and does not leak another match',async()=>{
  const d=deferred(),p=deferred();const f=fixture({getStreamLinks:(m)=>m==='m'?d.promise:Promise.resolve(snapshot(1,{},m)),putStreamLinks:()=>p.promise});
  const old=f.store.activate('t','m','a'); f.store.receive(snapshot(1,{embedA:'88'})); const saving=f.store.save(empty,1);
  await f.store.activate('u','n','b'); d.resolve(snapshot(9,{embedA:'99'})); p.resolve(snapshot(10,{embedA:'100'})); await old;
  assert.equal(await saving,false); assert.deepEqual(f.store.values,empty); assert.equal(f.store.matchId,'n');
  f.store.clear(); assert.equal(f.store.matchId,''); assert.deepEqual(f.store.values,empty); f.close();
});
test('permission denial clears canonical and never falls back to cached links',async()=>{
  const f=fixture({getStreamLinks:async()=>{throw new f.ApiError(403,'Forbidden','stream_links_forbidden');}});
  await f.store.activate('t','m','a'); assert.deepEqual(f.store.linksFor('m',{embedA:'123'}),empty);
  assert.equal(f.store.unsupported,false); assert.equal(f.store.errorCode,'stream_links_forbidden'); f.close();
});
test('route missing compatibility differs from match missing and cannot report cloud save',async()=>{
  const f=fixture({getStreamLinks:async()=>{throw new f.ApiError(404,'Not Found');}});
  await f.store.activate('t','m','a'); assert.equal(f.store.unsupported,true);
  assert.equal(f.store.linksFor('m',{...empty,embedA:'123'}).embedA,'123'); assert.equal(await f.store.save(empty,0),false); f.close();
  const g=fixture({getStreamLinks:async()=>{throw new g.ApiError(404,'Match not found','match_not_found');}});
  await g.store.activate('t','m','a'); assert.equal(g.store.unsupported,false); assert.deepEqual(g.store.linksFor('m',{embedA:'123'}),empty); g.close();
});
test('temporary GET failure preserves last authorized mapping; foreground refresh obtains changes',async()=>{
  let fail=false; const f=fixture({getStreamLinks:async()=>{if(fail)throw new Error('offline');return snapshot(3,{embedA:'123'});}});
  await f.store.activate('t','m','a'); fail=true; await f.store.refresh();
  assert.equal(f.store.values.embedA,'123'); assert.match(f.store.error,/offline/); f.close();
});
test('newer metadata with identical URLs never causes per-side URL watcher or refresh change',async()=>{
 const {watch}=require('vue');const f=fixture({getStreamLinks:async()=>snapshot(1,{hlsA:'https://x.test/a'})});
 await f.store.activate('t','m','a');let restarts=0;
 const stop=watch(()=>f.store.linksFor('m').hlsA,()=>restarts++,{flush:'sync'});
 f.store.receive(snapshot(2,{hlsA:'https://x.test/a'}));assert.equal(restarts,0);
 f.store.receive(snapshot(3,{hlsA:'https://new.test/a'}));assert.equal(restarts,1);
 f.store.receive(snapshot(3,{hlsA:'https://other.test/a'}));assert.equal(restarts,1);stop();f.close();
});
test('foreground/focus refresh uses GET and clear/disposal does not retain credentials',async()=>{
 const saved={window:global.window,document:global.document},events=new Map();let reads=0;
 global.window={addEventListener:(k,f)=>events.set(k,f),removeEventListener:k=>events.delete(k)};
 global.document={hidden:false,addEventListener:(k,f)=>events.set(k,f),removeEventListener:k=>events.delete(k)};
 const f=fixture({getStreamLinks:async()=>snapshot(++reads)});
 try {
  await f.store.activate('t','m','a');events.get('focus')();await new Promise(r=>setImmediate(r));assert.equal(f.store.version,2);
  global.document.hidden=true;events.get('visibilitychange')();assert.equal(reads,2);
  global.document.hidden=false;events.get('visibilitychange')();await new Promise(r=>setImmediate(r));assert.equal(reads,3);
  f.store.clear();events.get('focus')();assert.equal(reads,3);
 }finally{f.close();Object.assign(global,saved);} assert.equal(events.size,0);
});
test('failed PUT preserves previously playable links and never reports successful save',async()=>{
 const f=fixture({getStreamLinks:async()=>snapshot(2,{embedA:'123'}),putStreamLinks:async()=>{throw new f.ApiError(503,'Storage unavailable','stream_links_unavailable');}});
 await f.store.activate('t','m','a'); assert.equal(await f.store.save({...empty,embedA:'999'},2),false);
 assert.equal(f.store.values.embedA,'123');assert.equal(f.store.errorCode,'stream_links_unavailable');assert.equal(f.store.saving,false);f.close();
});
test('rolling backend route failure retains already authorized canonical links; same-version GET restores support',async()=>{
 let fail=false;const f=fixture({getStreamLinks:async()=>{if(fail)throw new f.ApiError(404,'Not Found');return snapshot(2,{embedA:'123'});}});
 await f.store.activate('t','m','a');fail=true;await f.store.refresh();assert.equal(f.store.linksFor('m',{embedA:'old'}).embedA,'123');
 fail=false;await f.store.refresh();assert.equal(f.store.unsupported,false);assert.equal(f.store.error,'');f.close();
});
