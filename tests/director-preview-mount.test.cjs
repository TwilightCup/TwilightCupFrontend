const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');
const {parse}=require('@vue/compiler-sfc');const {parse:parseDom,compile}=require('@vue/compiler-dom');const vue=require('vue');
const source=fs.readFileSync('src/views/DirectorView.vue','utf8');
const ast=parseDom(parse(source).descriptor.template.content);
function find(node,predicate){if(predicate(node))return node;for(const child of node.children??[]){const found=find(child,predicate);if(found)return found;}}
const panel=find(ast,n=>n.type===1&&n.props.some(p=>p.name==='ref'&&p.value?.content==='previewWrapEl'));
const render=new Function('Vue',compile(panel.loc.source,{mode:'function'}).code)({...vue,withDirectives:vnode=>vnode});
function frames(vnode){return (vnode.type==='iframe'?[vnode]:[]).concat(...(Array.isArray(vnode.children)?vnode.children.filter(n=>n&&typeof n==='object').map(frames):[]));}
function context(){return {previewVisible:true,previewEnabled:true,previewScene:'match',previewScale:0.18,syncPreviewMedia(){},$t:x=>x,
 MANUAL_PREVIEW_SCENES:['mappool','categoryinfo','match','bracket'],previewUrlMap:{mappool:'/mappool',categoryinfo:'/categoryinfo',match:'/match',bracket:'/bracket'}};}
test('actual director template mounts only selected preview, with no hidden scene documents',()=>{
 const ctx=context();let mounted=frames(render(ctx,[]));assert.equal(mounted.length,1);assert.equal(mounted[0].props.src,'/match');
 const oldKey=mounted[0].key;ctx.previewScene='mappool';mounted=frames(render(ctx,[]));assert.equal(mounted.length,1);assert.equal(mounted[0].props.src,'/mappool');assert.notEqual(mounted[0].key,oldKey);
});
test('paused, offscreen or unauthenticated preview mounts no iframe',()=>{
 for(const patch of [{previewEnabled:false},{previewVisible:false},{previewUrlMap:{}}])assert.equal(frames(render({...context(),...patch},[])).length,0);
});
test('director and match preview no longer pass reduced resolution budgets',()=>{
 for(const file of ['src/views/DirectorView.vue','src/scenes/match/MatchScene.vue']){
  const template=parse(fs.readFileSync(file,'utf8')).descriptor.template.content;
  assert(!template.includes(':preview-width='));assert(!template.includes(':preview-height='));assert(template.includes('director-output'));
 }
});
