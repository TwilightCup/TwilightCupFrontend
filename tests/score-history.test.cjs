const {test}=require('node:test');
const assert=require('node:assert/strict');
const load=require('./load-ts.cjs')();
const {ScoreHistory}=load('src/scenes/align/scoreHistory.ts');
const {RoundVerdict:V}=load('src/api/types.ts');
const round=(verdict,time,extra={})=>({counted:true,verdict,ended_at:new Date(time).toISOString(),...extra});
test('refresh restores both wins, while delayed T reveals each verdict only at its event time',()=>{
 const h=new ScoreHistory();
 assert.deepEqual(h.restore([round(V.A_WIN,1000),round(V.B_DISCONNECT_LOSS,2000),round(V.B_WIN,3000),round(V.TIE_REMATCH,4000,{counted:false})],5000),{winsA:2,winsB:1});
 assert.deepEqual(h.at(2500),{winsA:2,winsB:0});
 assert.deepEqual(h.at(3000),{winsA:2,winsB:1});
});
test('late REST response cannot replace newer WS scores; corrections may decrease wins',()=>{
 const h=new ScoreHistory();h.add(4000,{winsA:1,winsB:2});
 assert.deepEqual(h.restore([round(V.A_WIN,1000),round(V.A_WIN,2000)],5000,3500),{winsA:1,winsB:2});
 assert.deepEqual(h.at(3000),{winsA:2,winsB:0});
 assert.deepEqual(h.at(4000),{winsA:1,winsB:2});
 h.clear();assert.deepEqual(h.at(5000),{winsA:0,winsB:0});
});
test('uncounted/superseded rounds do not count; legacy local timestamp is not interpreted as UTC',()=>{
 const h=new ScoreHistory();h.restore([round(V.A_WIN,1000,{counted:false}),round(V.B_WIN,1000,{superseded_by:'new'}),round(V.A_DISCONNECT_LOSS,2000,{ended_at:'2026-01-01T00:00:00'})],5000);
 assert.deepEqual(h.at(4999),{winsA:0,winsB:0});assert.deepEqual(h.at(5000),{winsA:0,winsB:1});
});

test('reconnect REST restores verdicts missed while disconnected instead of keeping stale live totals',()=>{
 const h=new ScoreHistory();h.add(1000,{winsA:1,winsB:0});
 assert.deepEqual(h.restore([round(V.A_WIN,1000),round(V.B_WIN,2000)],5000,4000),{winsA:1,winsB:1});
 assert.deepEqual(h.at(3000),{winsA:1,winsB:1});
});
