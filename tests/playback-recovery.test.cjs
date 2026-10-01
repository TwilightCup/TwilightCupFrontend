const {test}=require('node:test');
const assert=require('node:assert/strict');
const load=require('./load-ts.cjs')();
const {PlaybackRecovery}=load('src/scenes/align/playbackRecovery.ts');
test('one stuck side triggers at 4s with a 30s cooldown',()=>{
 const g=new PlaybackRecovery();
 assert(!g.check(0,[1,1],true));
 assert(!g.check(3999,[2,1],true));
 assert(g.check(4000,[3,1],true));
 assert(!g.check(8000,[4,1],true));
 assert(!g.check(33999,[5,1],true));
 assert(g.check(34000,[6,1],true));
});
test('cold start, real signal loss, pending resets and followers cannot trigger',()=>{
 const g=new PlaybackRecovery();
 assert(!g.check(0,[null,null],true));assert(!g.check(10000,[null,null],true));
 assert(!g.check(20000,[1,1],false));assert(!g.check(30000,[1,1],false));
 assert(!g.check(31000,[1,1],true));assert(g.check(34000,[1,1],true));
});
test('continuous pair progress never triggers recovery',()=>{
 const g=new PlaybackRecovery();for(let t=0;t<60000;t+=500)assert(!g.check(t,[t,t+1],true));
});
test('console watchdog ignores edited, empty and invalid delay drafts',()=>{
 const fs=require('node:fs'),ts=require('typescript');
 const {parse}=require('@vue/compiler-sfc');
 const script=parse(fs.readFileSync('src/views/DirectorView.vue','utf8')).descriptor.scriptSetup.content;
 const source=ts.createSourceFile('DirectorView.ts',script,ts.ScriptTarget.Latest,true);
 let timerStatement;
 for(const statement of source.statements) {
  if(!ts.isExpressionStatement(statement)||!ts.isCallExpression(statement.expression)||statement.expression.expression.getText(source)!=='onMounted')continue;
  const callback=statement.expression.arguments[0];
  if(!ts.isArrowFunction(callback)||!ts.isBlock(callback.body))continue;
  timerStatement=callback.body.statements.find(item=>item.getText(source).startsWith('wallTimer = setInterval('));
  if(timerStatement)break;
 }
 assert(timerStatement);
 const code=ts.transpileModule(timerStatement.getText(source),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
 for(const draft of [120,undefined,NaN]) {
  let tick,now=0,recoveries=0;
  const reloadStreams=()=>true;
  const director={canAdjustAnchor:true,matchId:'match',recoverPlayback(callback){assert.equal(callback,reloadStreams);recoveries++;}};
  const health={arrivalAgeMs:0,frames:10};
  new Function('setInterval','performance','playbackRecovery','alignEngine','director','readOnly','anchorDelta','reloadStreams','resyncStreams',
   'let wallTimer; const wallNow = { value: 0 };\n'+code)(
   callback=>{tick=callback;return 1;},{now:()=>now},new PlaybackRecovery(),
   {health:{A:health,B:health},sync:{presentedRt:{A:1,B:1}},localRecoveryPending:()=>false},director,{value:false},{value:draft},reloadStreams,
   ()=>assert.fail('watchdog must not apply the form draft'));
  tick();now=4000;tick();assert.equal(recoveries,1);
  now=8000;tick();assert.equal(recoveries,1);
 }
});
function stream(times){
 const {FrameLockStream}=load('src/scenes/align/frameLock.ts');
 const s=new FrameLockStream({setOnSegment(){},setOnError(){},harvesterStats(){return {retries:0,gaveUp:0,authFail:0};}});
 s.ready=true;s.encapsulation='avcc';s.decodedEpoch=0;
 s.raw=times.map(rtUs=>({rtUs,isKey:false,epoch:0,codec:'h264',description:null,payload:new Uint8Array(1)}));
 s.rawBytes=times.length;const fed=[];
 s.decoder={queueSize:0,pendingSize:0,decodeSample(t){fed.push(t);return true;}};
 return {s,fed};
}
test('future reference preceding near-target B frames is decoded in encoded order',()=>{
 const {s,fed}=stream([1580000,1045000,1241000,2000000]);s.advance(1000000);
 assert.deepEqual(fed,[1580000,1045000,1241000]);
});
test('forward decoding remains bounded and respects backpressure',()=>{
 for(const times of [[5000000,1045000],[1580000,...Array(64).fill(1600000),1045000]]){
  const {s,fed}=stream(times);s.advance(1000000);assert.deepEqual(fed,[]);
 }
 const {s,fed}=stream([1580000,1045000]);s.decoder.queueSize=12;s.advance(1000000);assert.deepEqual(fed,[]);
});
