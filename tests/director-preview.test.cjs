const {test}=require('node:test');const assert=require('node:assert/strict');
const load=require('./load-ts.cjs')();
const {PreviewMediaSession}=load('src/scenes/align/previewMediaSession.ts');
test('preview starts without media; only its same-origin parent can activate it',()=>{
 const parent={},session=new PreviewMediaSession(parent,'https://example.test');
 const event={source:parent,origin:'https://example.test',data:{type:'director-preview-media',active:true}};
 assert.equal(session.active,false);
 assert.equal(session.receive({...event,source:{}}),false);assert.equal(session.active,false);
 assert.equal(session.receive({...event,origin:'https://other.test'}),false);assert.equal(session.active,false);
 assert.equal(session.receive(event),true);assert.equal(session.active,true);
 assert.equal(session.receive({...event,data:{type:'director-preview-media',active:false}}),true);assert.equal(session.active,false);
 assert.equal(session.receive(event),true);assert.equal(session.active,true);
 assert.equal(session.receive({...event,data:{type:'director-preview-media',active:'true'}}),false);
});
// Run the composable's lifecycle with injected DOM/Vue ports, without a browser or build output.
const fs=require('node:fs'),ts=require('typescript');
function hook(file,extra={}){
 const mounted=[],unmounted=[],watchers=[];
 const vue={ref:value=>({value}),computed:fn=>({get value(){return fn();}}),onMounted:fn=>mounted.push(fn),onUnmounted:fn=>unmounted.push(fn),watch:(ref,fn)=>watchers.push(fn)};
 const mod={exports:{}};
 const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
 new Function('require','module','exports',code)(id=>id==='vue'?vue:extra[id],mod,mod.exports);
 return {...mod.exports,mounted,unmounted,watchers};
}
test('panel visibility suspends pixel work on page hide and viewport exit and cleans observers',()=>{
 const oldDocument=global.document,oldObserver=global.IntersectionObserver;
 let visibility,intersections,disconnects=0;const observed=[];
 global.document={hidden:false,addEventListener(type,cb){visibility=cb;},removeEventListener(type,cb){assert.equal(cb,visibility);}};
 global.IntersectionObserver=class{constructor(cb){intersections=cb;}observe(el){observed.push(el);}unobserve(){}disconnect(){disconnects++;}};
 try{
  const h=hook('src/scenes/composables/usePanelVisibility.ts'),el={},ref={value:el},visible=h.usePanelVisibility(ref);
  h.mounted.forEach(fn=>fn());assert.equal(visible.value,false);assert.deepEqual(observed,[el]);
  intersections([{target:el,isIntersecting:true}]);assert.equal(visible.value,true);
  document.hidden=true;visibility();assert.equal(visible.value,false);
  document.hidden=false;visibility();assert.equal(visible.value,true);
  intersections([{target:el,isIntersecting:false}]);assert.equal(visible.value,false);
  const next={};ref.value=next;h.watchers[0](next,el);intersections([{target:el,isIntersecting:true}]);assert.equal(visible.value,false);
  intersections([{target:next,isIntersecting:true}]);assert.equal(visible.value,true);
  h.unmounted.forEach(fn=>fn());assert.equal(disconnects,1);
 }finally{global.document=oldDocument;global.IntersectionObserver=oldObserver;}
});
test('preview handshake starts cold, toggles media only, and standalone stage remains active',()=>{
 const oldWindow=global.window,oldLocation=global.location;let listener,removed=false;const sent=[];
 const parent={postMessage:(...args)=>sent.push(args)};
 global.location={search:'?director_preview=1',origin:'https://example.test'};
 global.window={parent,addEventListener(type,cb){listener=cb;},removeEventListener(type,cb){removed=cb===listener;}};
 try{
  const h=hook('src/scenes/composables/useDirectorPreviewMedia.ts',{'../align/previewMediaSession':{PreviewMediaSession}});
  const state=h.useDirectorPreviewMedia();assert.equal(state.active.value,false);h.mounted.forEach(fn=>fn());assert.equal(sent[0][0].type,'director-preview-ready');
  const update=active=>listener({source:parent,origin:location.origin,data:{type:'director-preview-media',active}});
  update(true);assert.equal(state.active.value,true);update(false);assert.equal(state.active.value,false);update(true);assert.equal(state.active.value,true);
  h.unmounted.forEach(fn=>fn());assert(removed);
  window.parent=window;const stage=h.useDirectorPreviewMedia();assert.equal(stage.preview,false);assert.equal(stage.active.value,true);
 }finally{global.window=oldWindow;global.location=oldLocation;}
});
