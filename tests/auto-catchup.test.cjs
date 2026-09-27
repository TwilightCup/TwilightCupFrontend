const {test}=require('node:test');
const assert=require('node:assert/strict');
const {AutoCatchup}=require('./load-ts.cjs')()('src/scenes/align/autoCatchup.ts');
test('15 seconds triggers once, recovery rearms with a monotonic cooldown',()=>{
 const g=new AutoCatchup();
 assert(!g.check(100e6,114999,0,true));
 assert(g.check(100e6,115000,1,true));
 assert(!g.check(100e6,130000,20000,true));
 assert(!g.check(120e6,130000,20001,true));
 assert(g.check(120e6,135000,20002,true));
 assert(!g.check(130e6,140000,20003,true));
 assert(!g.check(130e6,145000,20004,true));
 assert(g.check(130e6,145000,35002,true));
});
test('followers, reset preparation and frozen playback cannot trigger or rearm',()=>{
 const g=new AutoCatchup();
 assert(!g.check(100e6,115000,0,false));
 assert(g.check(100e6,115000,1,true));
 assert(!g.check(110e6,120000,20000,false));
 assert(!g.check(110e6,130000,30000,true));
});
test('automatic target requires seekable coverage on both streams',()=>{
 const {AlignEngine}=require('./load-ts.cjs')()('src/scenes/align/useFrameAlign.ts');
 const e=new AlignEngine();e.setRequiredSides(['A','B']);
 e.streams.set('A',{coverage:()=>({from:80e6,to:100e6}),canSeek:()=>true});
 e.streams.set('B',{coverage:()=>({from:80e6,to:94e6}),canSeek:()=>true});
 assert(!e.canAutoSeek(95e6));assert(e.canAutoSeek(90e6));
 e.streams.get('B').canSeek=()=>false;assert(!e.canAutoSeek(90e6));
});
test('explicit long delay stays held until latency recovers',()=>{
 const g=new AutoCatchup();g.hold();
 assert(!g.check(100e6,120000,0,true));
 assert(!g.check(100e6,112000,1,true));
 assert(g.check(100e6,115000,2,true));
});
