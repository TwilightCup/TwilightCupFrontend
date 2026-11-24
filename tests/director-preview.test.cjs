const {test}=require('node:test');const assert=require('node:assert/strict');
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
