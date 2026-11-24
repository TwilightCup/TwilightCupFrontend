const {test}=require('node:test');const assert=require('node:assert/strict');const load=require('./load-ts.cjs')();
const {AuthorityRole}=load('src/scenes/align/authorityRole.ts');
const {FrameLeaseClient}=load('src/scenes/align/frameLeaseClient.ts');
function role(){const r=new AuthorityRole();r.connect('c');r.assign({connection_id:'c',src:'c',epoch:1,role:'publisher'});return r;}
const ready={capability:true,media_ready:true,decode_ready:true,progress_t_us:100,active_sides:['A'],waiting_sides:['B'],state:'running'};
test('null source revokes publisher and old epoch cannot restore it',()=>{const r=role();assert(r.assign({connection_id:'c',src:null,epoch:2,role:'follower',lease_required:true}));assert(!r.publisher);assert(!r.assign({connection_id:'c',src:'c',epoch:1,role:'publisher'}));});
test('status sequence survives epochs; takeover is confirmed before publishing and only at floor',()=>{
 const r=role(),l=new FrameLeaseClient();l.observe({lease_required:true,t_floor_us:200},r,0);
 assert(!l.canPublish(r));let p=l.report(r,'a','m',ready,'visible',0);assert.equal(p.seq,1);assert(!l.canPublish(r));
 p=l.report(r,'a','m',{...ready,progress_t_us:200},'visible',100);assert(p);assert(l.canPublish(r));
 r.assign({connection_id:'c',src:'c',epoch:2,role:'publisher'});l.observe({lease_required:true,t_floor_us:200},r,200);
 p=l.report(r,'a','m',{...ready,progress_t_us:200},'visible',200);assert.equal(p.seq,3);assert(l.canPublish(r));
});
test('takeover that cannot reach floor relinquishes; status never invents progress',()=>{
 const r=role(),l=new FrameLeaseClient();l.observe({lease_required:true,t_floor_us:200,takeover_timeout_ms:3000},r,0);
 const p=l.report(r,'a','m',ready,'hidden',2800);assert.equal(p.state,'relinquish');assert.equal(p.progress_t_us,100);assert(!l.canPublish(r));
});
test('old backend without lease fields remains compatible',()=>{const r=role(),l=new FrameLeaseClient();l.observe({},r,0);assert.equal(l.report(r,'a','m',ready,'visible',0),null);assert(l.canPublish(r));});
const {AlignEngine}=load('src/scenes/align/useFrameAlign.ts');const {FrameQueue}=load('src/scenes/align/frameQueue.ts');
function page(sides=['A','B']){const e=new AlignEngine();e.setRequiredSides(sides);
 for(const side of sides)e.streams.set(side,{queue:new FrameQueue(),seeks:0,coverage:()=>({from:0,to:100e6}),canSeek:()=>true,
  seek(){this.seeks++;this.queue.clear();return true;},advance(t){this.queue.add({rtUs:t,isKey:true,handle:{}});}});return e;}
test('cold candidates predecode without advancing public T, then elected owner confirms before frame publication',()=>{
 const pages=[page(),page(),page()];for(const p of pages){p.selectAuthority(null,2);p.tickLoop(0);const sample=p.leaseSample(0);assert(sample.decode_ready);assert.equal(sample.progress_t_us,0);assert.equal(p.tUs.value,null);assert.equal(p.presented.A,false);p.leaseSample(6000);assert.equal(p.streams.get('A').seeks,1);}
 const e=pages[0],r=role(),l=new FrameLeaseClient();r.assign({connection_id:'c',src:'c',epoch:3,role:'publisher'});l.observe({lease_required:true,t_floor_us:null},r,0);e.selectAuthority('c',3);e.setPublisher(true);
 for(let t=0;t<=300;t+=25)e.tickLoop(t);
 assert(e.tUs.value>0);assert(!l.canPublish(r));const status=l.report(r,'a','m',e.leaseSample(301),'visible',301);
 assert(status.decode_ready);assert(l.canPublish(r));assert(pages.slice(1).every(p=>p.tUs.value===null));
});
test('single configured side produces the strict A/B partition and absence of streams is incapable',()=>{
 const e=page(['A']),s=e.leaseSample(0);assert.deepEqual(s.active_sides,['A']);assert.deepEqual(s.waiting_sides,['B']);
 const empty=new AlignEngine().leaseSample(0);assert(!empty.capability);assert.deepEqual(empty.waiting_sides,['A','B']);
});
test('revocation freezes local T and rejects old-source and old-epoch anchors',()=>{
 const e=page();e.setPublisher(true);for(let t=0;t<=300;t+=25)e.tickLoop(t);const before=e.tUs.value;
 e.selectAuthority(null,2);e.tickLoop(400);assert.equal(e.tUs.value,before);assert.equal(e.sync.role,'follower');
 assert(!e.setExternalTUs(70e6,{epoch:1,seq:1,src:'old'}));assert(!e.setExternalTUs(70e6,{epoch:2,seq:1,src:'old'}));
 assert(e.setExternalTUs(70e6,{epoch:2,seq:0,src:null,source_id:null,frozen:true,rate:0}));
 assert.equal(e.tUs.value,before);
 e.selectAuthority('next',3);assert(e.setExternalTUs(70e6,{epoch:3,seq:0,src:'next',source_id:'next',frozen:true}));
});
test('takeover waits for explicit floor metadata and state changes bypass the one-second cadence',()=>{
 const r=role(),l=new FrameLeaseClient();l.observe({lease_required:true},r,0);l.report(r,'a','m',ready,'visible',0);assert(!l.canPublish(r));
 l.observe({t_floor_us:null},r,10);assert(l.report(r,'a','m',ready,'visible',10));assert(l.canPublish(r));
 assert(l.report(r,'a','m',{...ready,decode_ready:false,state:'media_wait'},'hidden',20));
 assert.equal(l.report(r,'a','m',{...ready,decode_ready:false,state:'media_wait'},'hidden',21),null);
});
test('failed status send cannot authorize a T, retry has a fresh sequence',()=>{
 const r=role(),l=new FrameLeaseClient();l.observe({lease_required:true,t_floor_us:0},r,0);
 const first=l.report(r,'a','m',ready,'visible',0);l.deliveryFailed();assert(!l.canPublish(r));
 const next=l.report(r,'a','m',ready,'visible',1);assert(next.seq>first.seq);assert(l.canPublish(r));
});
test('same-epoch frozen keepalive cannot revoke a confirmed owner after the takeover deadline',()=>{
 const r=role(),l=new FrameLeaseClient();l.observe({lease_required:true,t_floor_us:0},r,0);
 l.report(r,'a','m',ready,'visible',0);assert(l.canPublish(r));
 l.observe({t_floor_us:1000},r,6000);
 const held=l.report(r,'a','m',{...ready,progress_t_us:1000,decode_ready:false,state:'media_wait'},'visible',6000);
 assert.equal(held.state,'media_wait');assert(l.canPublish(r));
 const resumed=l.report(r,'a','m',{...ready,progress_t_us:1100},'visible',6500);
 assert.equal(resumed.state,'running');assert(l.canPublish(r));
});
test('invalid takeover floor cannot poison role or timeline',()=>{
 const r=role();assert(!r.assign({connection_id:'c',src:'c',epoch:2,role:'publisher',t_floor_us:NaN}));assert.equal(r.epoch,1);
});
test('candidate diagnostics do not claim decoding has not started',()=>{
 const {streamWaitingText}=load('src/scenes/align/streamStatus.ts');
 const text=streamWaitingText({frames:8400,authorityUs:null,state:'waiting',aligned:true,candidate:'ready'});
 assert.match(text,/候选解码已就绪/);assert(!text.includes('尚未启动解码'));
});
test('takeover immediately resets a private probe cursor instead of waiting for missing-frame timeout',()=>{
 const e=page();e.tUs.value=50e6;e.selectAuthority(null,2);assert(e.leaseSample(0).decode_ready);
 const prior=e.streams.get('A').seeks;e.setAuthorityFloor(55e6);e.selectAuthority('c',3);e.setPublisher(true);e.tickLoop(25);
 assert.equal(e.streams.get('A').seeks,prior+1);assert(e.sync.targetUs>=55e6);assert.equal(e.tUs.value,50e6);
});
