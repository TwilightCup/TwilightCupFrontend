const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const load=require('./load-ts.cjs');
function harness(fn){
 const saved={WebSocket:global.WebSocket,setTimeout:global.setTimeout,clearTimeout:global.clearTimeout,setInterval:global.setInterval,clearInterval:global.clearInterval};
 const sockets=[],timers=new Map();let seq=0;
 class WS{static OPEN=1;readyState=1;constructor(url){this.url=url;sockets.push(this);}send(){}close(){}}
 Object.assign(global,{WebSocket:WS,setTimeout:f=>{timers.set(++seq,f);return seq;},clearTimeout:id=>timers.delete(id),setInterval:()=>1,clearInterval(){}});
 const {MatchSocket}=load({[path.resolve('src/api/config.ts')]:{wsUrl:(...args)=>args},[path.resolve('src/api/client.ts')]:{notifySessionExpired(){}},[path.resolve('src/utils/jwt.ts')]:{isTokenExpired:()=>false}})('src/ws/socket.ts');
 const socket=new MatchSocket();
 try{fn({socket,sockets,timers});}finally{socket.disconnect();Object.assign(global,saved);}
}
test('console entry requests exclusivity; stage entry never does',()=>{
 const {createPage}=require('./helpers/director-page.cjs');
 for(const kind of ['console','stage']){
  const p=createPage({id:kind,kind});
  try{assert.equal(p.socket.args[3],kind==='console');assert.equal(p.socket.args[4],kind);}finally{p.close();}
 }
});
for(const message of [true,false]){
 test(`displaced console stops permanently, notification=${message}`,()=>harness(({socket,sockets,timers})=>{
  socket.connect('fixture','DIRECTOR','match',true,'console');
  const ws=sockets[0];ws.onopen();
  if(message)ws.onmessage({data:JSON.stringify({type:'displaced'})});
  ws.onclose({code:4001});
  assert.equal(socket.status,'displaced');assert.equal(timers.size,0);
 }));
 test(`stage rejoins after console takeover without displacing anyone, notification=${message}`,()=>harness(({socket,sockets,timers})=>{
  const messages=[];socket.onMessage=m=>messages.push(m);
  socket.connect('fixture','DIRECTOR','match',false,'stage');
  const ws=sockets[0];ws.onopen();
  if(message)ws.onmessage({data:JSON.stringify({type:'displaced'})});
  ws.onclose({code:4001});
  assert.equal(socket.status,'reconnecting');assert.equal(timers.size,1);assert.equal(messages.length,0);
  [...timers.values()][0]();
  assert.equal(sockets.length,2);assert.equal(sockets[1].url[3],false);assert.equal(sockets[1].url[4],'stage');
  sockets[1].onopen();assert.equal(socket.status,'open');
 }));
}
