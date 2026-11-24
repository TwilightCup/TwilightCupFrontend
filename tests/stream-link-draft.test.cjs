const {test}=require('node:test'); const assert=require('node:assert/strict'); const load=require('./load-ts.cjs')();
test('remote snapshots and conflict refresh never overwrite dirty editor or edit version',()=>{
 const {StreamLinkDraft}=load('src/utils/streamLinkDraft.ts'); const d=new StreamLinkDraft();
 d.load({hlsA:'old',hlsB:'',embedA:'',embedB:''},1); d.edit('hlsA','draft');
 d.load({hlsA:'remote',hlsB:'',embedA:'',embedB:''},2);
 assert.equal(d.values.hlsA,'draft');assert.equal(d.version,1);
 d.load({hlsA:'remote',hlsB:'',embedA:'',embedB:''},2,true);assert.equal(d.values.hlsA,'remote');assert.equal(d.dirty,false);
});
