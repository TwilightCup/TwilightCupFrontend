const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');
const {parse}=require('@vue/compiler-sfc');const {compile}=require('@vue/compiler-dom');const vue=require('vue');
const director=fs.readFileSync('src/views/DirectorView.vue','utf8');
const panel=fs.readFileSync('src/components/DirectorSpeedrunInfo.vue','utf8');
const render=new Function('Vue',compile(parse(panel).descriptor.template.content,{mode:'function'}).code)(vue);
function text(node){if(typeof node==='string')return node;return Array.isArray(node?.children)?node.children.map(text).join(' '):typeof node?.children==='string'?node.children:'';}
function context(patch={}){return {title:'Any%',status:'ok',players:[{side:'A',name:'Alice',binding:'alice',pb:{place:7,timeSec:42}},{side:'B',name:'Bob',binding:null,pb:null}],rows:[{place:1,playerName:'Runner',timeSec:30,highlight:'A'}],updated:'2026-09-21',messages:{idle:'等待选图',loading:'正在拉取',error:'拉取失败',noMapping:'无映射',rateLimit:'限流'},errDetail:'',formatRunTime:t=>`${t}s`,...patch};}
test('director has no scene iframe or preview controller and mounts speedrun info instead',()=>{
 assert(!director.includes('<iframe'));assert(!director.includes('previewUrlMap'));assert(!director.includes('previewReady'));assert(director.includes('<DirectorSpeedrunInfo'));
 assert(director.includes('<SeiStream'));assert(director.includes('switch_scene'));
 assert(!panel.includes('<canvas'));assert(!panel.includes('requestAnimationFrame'));
});
test('speedrun panel renders leaderboard, highlighted side, PB and update time',()=>{
 const result=text(render(context(),[]));for(const value of ['Any%','Alice','42s','Runner','30s','2026-09-21','未绑定 speedrun'])assert(result.includes(value));
});
test('loading/errors never show previous board; empty board and missing PB are explicit',()=>{
 for(const status of ['idle','loading','error','noMapping','rateLimit']){
  const ctx=context({status,errDetail:'HTTP 420'}),result=text(render(ctx,[]));assert(result.includes(ctx.messages[status]));assert(!result.includes('Runner'));
  if(status==='error'||status==='rateLimit')assert(result.includes('HTTP 420'));
 }
 assert(text(render(context({rows:[]}),[])).includes('当前榜单暂无成绩'));
 assert(text(render(context({players:[{side:'A',name:'Alice',binding:'alice',pb:null}]}),[])).includes('暂无 PB'));
 assert(text(render(context({players:[{side:'A',name:'Alice',binding:'alice',pb:undefined}]}),[])).includes('PB 待获取'));
});
