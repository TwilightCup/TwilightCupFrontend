const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const ts=require('typescript');
const load=require('./load-ts.cjs')();const {StreamLinkDraft}=load('src/utils/streamLinkDraft.ts');
// Execute the real SFC action functions with transport/dialog ports; no template imitation.
const script=fs.readFileSync('src/views/DirectorView.vue','utf8').split('<script setup lang="ts">')[1].split('</script>')[0];
const ast=ts.createSourceFile('actions.ts',script,ts.ScriptTarget.Latest,true);
const actions=ast.statements.filter(n=>ts.isFunctionDeclaration(n)&&['saveConfig','reloadLinkDraft','importLegacyLinks'].includes(n.name?.text)).map(n=>n.getText(ast)).join('\n');
const js=ts.transpileModule(actions,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
const empty={hlsA:'',hlsB:'',embedA:'',embedB:''};
function fixture(save,confirm=async()=>true){
 const messages=[],draft=new StreamLinkDraft();draft.load({...empty,hlsA:'draft'},0,true);draft.dirty=true;
 const ports={director:{matchId:'m'},readOnly:{value:false},streamDraft:draft,streamLinks:{save,values:{...empty,hlsA:'canonical'},version:1,error:'offline',conflict:false},
 t:k=>k,ElMessage:{success:m=>messages.push(['success',m]),error:m=>messages.push(['error',m])},
 ElMessageBox:{confirm},canImportLinks:{value:true},legacyLinks:{value:{...empty,hlsA:'legacy'}}};
 const f=new Function(...Object.keys(ports),js+'; return {saveConfig,reloadLinkDraft,importLegacyLinks};')(...Object.values(ports));
 return {...f,ports,messages,draft};
}
test('actual director action keeps failed draft and emits no success before server acceptance',async()=>{
 let resolve;const pending=new Promise(r=>resolve=r);const f=fixture(()=>pending);
 const action=f.saveConfig();assert.deepEqual(f.messages,[]);assert.equal(f.draft.values.hlsA,'draft');resolve(false);await action;
 assert.equal(f.draft.values.hlsA,'draft');assert.deepEqual(f.messages,[['error','offline']]);
 const g=fixture(async()=>true);await g.saveConfig();assert.equal(g.draft.values.hlsA,'canonical');assert.deepEqual(g.messages,[['success','streamLinks.saved']]);
});
test('legacy import requires explicit confirmation; cancellation and match changes cannot save',async()=>{
 let writes=0,confirm;const dialog=new Promise(r=>confirm=r);const f=fixture(async()=>{writes++;return true;},()=>dialog);
 const action=f.importLegacyLinks();assert.equal(writes,0);confirm(true);await action;assert.equal(writes,1);
 const cancelled=fixture(async()=>{writes++;return true;},async()=>{throw new Error('cancel');});await cancelled.importLegacyLinks();assert.equal(writes,1);
 let accept;const changed=fixture(async()=>{writes++;return true;},()=>new Promise(r=>accept=r));const importing=changed.importLegacyLinks();changed.ports.director.matchId='other';accept(true);await importing;assert.equal(writes,1);
});
