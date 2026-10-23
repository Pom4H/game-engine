import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
 ACTING_ACTIONS,NPC_NEEDS,createNpcMind,validateNpcMind,migrateNpcMind,setNpcNeed,
 stepNpcMind,perceiveNpcOutcome,advanceActingMind,actingEmotionsAt,actingAffectAt,
 reappraiseActingOutcome,validateActingMind,
 makeActingCue,sampleActingPerformance,
} from '../dist/acting/index.js';

// Produced by the unmodified 5b33 modules, including a duplicate receipt whose
// mind clock is newer than its cached legacy affect. Provenance is in the JSON.
const fixtures=JSON.parse(readFileSync(new URL('./fixtures/npc-mind-v1-5b33.json',import.meta.url),'utf8'));
const gestures=JSON.parse(readFileSync(new URL('./fixtures/acting-gestures-5b33.json',import.meta.url),'utf8'));
const clone=value=>JSON.parse(JSON.stringify(value));
const talk={id:'talk',need:'company',subject:'conversation',partnerId:'ilya',available:true,distanceM:1,expectedRelief:1,confidence:1,position:[1,1.6,0]};
const outcome=patch=>({id:'positive',sequence:1,goalId:'company',subject:'conversation',otherId:'ilya',atS:1,
 progress:1,expectedProgress:0,certainty:1,attribution:'help',...patch});
const mixed=()=>{
 let mind=createNpcMind('anna');
 mind=perceiveNpcOutcome(mind,outcome({}));
 return perceiveNpcOutcome(mind,outcome({id:'negative',sequence:2,progress:-1,attribution:'unwilling'}));
};
function near(a,b){assert.ok(Math.abs(a-b)<1e-12,`${a} != ${b}`);}
function valid(mind){validateNpcMind(mind);validateActingMind(mind.acting);}
function sameOuter(a,b){const {acting:ignoredA,...outerA}=a,{acting:ignoredB,...outerB}=b;assert.deepEqual(outerA,outerB);}

test('frozen v1 NPC saves migrate only nested acting and preserve every outer field',()=>{
 assert.equal(fixtures.provenance.engineCommit,'5b33e4aa816eac6658974587cad5022c9b54b71e');
 for(const old of [fixtures.active,fixtures.completed]){
  const before=clone(old),mind=migrateNpcMind(old),a=mind.acting;
  valid(mind);sameOuter(mind,old);assert.equal(mind.version,1);assert.equal(a.version,2);
  for(const key of ['actorId','goals','memories','sentiments','intention','lastSequence','atS'])assert.deepEqual(a[key],old.acting[key]);
  const decay=Math.exp(-(old.acting.atS-old.acting.affect.atS)/12);
  near(a.affect.valence,old.acting.affect.valence*decay);near(a.affect.arousal,old.acting.affect.arousal*decay);
  near(a.affect.uncertainty,old.acting.affect.uncertainty*decay);
  assert.equal(a.emotions.atS,a.atS);assert.equal(a.affect.atS,a.atS);
  for(const channel of ['fear','anger','gratitude'])assert.equal(a.emotions[channel],0);
  assert.ok(a.memories.every(memory=>memory.assessment===undefined));
  assert.throws(()=>reappraiseActingOutcome(a,{eventId:a.memories[0].id,revision:1,basisId:'new-evidence',atS:a.atS,
   interpretation:{progress:0,expectedProgress:0,certainty:1,attribution:'unknown'}}),/outside/);
  a.goals[0].importance=.123;mind.needs[0].urgency=.456;if(mind.attention?.position)mind.attention.position[0]=999;
  assert.deepEqual(old,before);
 }
 assert.ok(fixtures.completed.acting.atS>fixtures.completed.acting.affect.atS);
 assert.equal(fixtures.completed.pendingAction,'celebrate');
});

test('current NPC migration is an owned, value-idempotent restoration including mixed emotion',()=>{
 const original=mixed(),before=clone(original),restored=migrateNpcMind(clone(original));
 valid(restored);assert.deepEqual(restored,original);assert.deepEqual(migrateNpcMind(restored),restored);
 assert.notEqual(restored.acting.memories[0],original.acting.memories[0]);
 restored.acting.memories[0].assessment.interpretation.progress=0;restored.acting.baseline.emotions.positive=.25;
 assert.deepEqual(original,before);
});

test('legacy active and completed decisions continue with original identity and clocks',()=>{
 for(const source of [fixtures.active,fixtures.completed]){
  const restored=migrateNpcMind(source),atS=source.acting.atS+.5;
  const updated=setNpcNeed(restored,'energy',.75,atS);valid(updated);
  assert.equal(updated.acting.actorId,source.acting.actorId);assert.equal(updated.decisionSerial,source.decisionSerial);
  const next=stepNpcMind(updated,atS,[talk]);valid(next.mind);
  assert.equal(next.request,null);assert.deepEqual(next.mind.decision,restored.decision);
  if(source.pendingAction==='celebrate')assert.equal(next.cue.action,'celebrate');
 }
});

test('advance and setNpcNeed synchronize both publications from one mixed sample',()=>{
 const original=mixed(),before=clone(original),expectedEmotions=actingEmotionsAt(original.acting,4),expectedAffect=actingAffectAt(original.acting,4);
 assert.ok(expectedEmotions.positive>0&&expectedEmotions.negative>0);assert.equal(expectedAffect.valence,0);
 const acting=advanceActingMind(original.acting,4);validateActingMind(acting);
 assert.deepEqual(acting.emotions,expectedEmotions);assert.deepEqual(acting.affect,expectedAffect);
 for(const key of ['baseline','memories','sentiments','intention'])assert.equal(acting[key],original.acting[key]);
 const next=setNpcNeed(original,'energy',.8,4);valid(next);
 assert.deepEqual(next.acting,acting);assert.equal(next.needs.find(n=>n.id==='energy').urgency,.8);
 assert.deepEqual(original,before);
});

test('idle ticks, active decisions and lazy duplicate receipts always remain mutually valid',()=>{
 let idle=stepNpcMind(mixed(),2,[]).mind;valid(idle);
 idle=stepNpcMind(idle,3,[]).mind;valid(idle);assert.equal(idle.acting.emotions.atS,3);
 let active=migrateNpcMind(fixtures.active);
 active=stepNpcMind(active,4,[talk]).mind;valid(active);
 const duplicate={...active.acting.memories[0],sequence:active.acting.lastSequence+1,atS:5};
 const repeated=perceiveNpcOutcome(active,duplicate);valid(repeated);
 assert.deepEqual(repeated.acting.affect,active.acting.affect);assert.deepEqual(repeated.acting.emotions,active.acting.emotions);
 assert.equal(repeated.acting.atS,5);assert.equal(repeated.acting.affect.atS,repeated.acting.emotions.atS);
 valid(stepNpcMind(repeated,6,[talk]).mind);
});

test('prospective appraisals retain causal emotion without satisfying needs or resolving actions',()=>{
 for(const [progress,attribution] of [[1,'help'],[-1,'unwilling'],[0,'unable']]){
  const original=migrateNpcMind(fixtures.active),before=clone(original),atS=original.acting.atS+1;
  const next=perceiveNpcOutcome(original,outcome({id:'future',sequence:2,atS,progress,attribution,
   phase:'prospect',likelihood:.8,controllability:0}));
  valid(next);assert.equal(next.acting.memories[0].phase,'prospect');assert.equal(next.acting.lastSequence,2);
  for(let i=0;i<next.needs.length;i++)near(next.needs[i].urgency,Math.min(1,original.needs[i].urgency+original.needs[i].growthPerS));
  for(const key of ['decision','thoughts','pendingAction','decisionSerial','cueSerial','lastCueS','attention'])assert.deepEqual(next[key],original[key]);
  assert.deepEqual(next.acting.intention,original.acting.intention);assert.equal(next.acting.atS,atS);
  if(progress<0)assert.ok(next.acting.emotions.fear>0);
  const receipt=perceiveNpcOutcome(next,outcome({id:'actual',sequence:3,atS:atS+1,progress:1,expectedProgress:1,confirmedResolution:true}));
  valid(receipt);assert.equal(receipt.decision.status,'succeeded');assert.equal(receipt.pendingAction,'celebrate');
  assert.ok(receipt.needs.find(n=>n.id==='company').urgency<next.needs.find(n=>n.id==='company').urgency);
  assert.deepEqual(original,before);
 }
});

test('advancing polling cadence does not add evidence or change causal reappraisal',()=>{
 const initial=mixed(),one=advanceActingMind(initial.acting,101);
 let many=initial.acting;for(let i=1;i<=1000;i++)many=advanceActingMind(many,1+i/10);
 validateActingMind(one);validateActingMind(many);
 for(const key of Object.keys(one.emotions))near(one.emotions[key],many.emotions[key]);
 for(const key of ['baseline','memories','sentiments','lastSequence','intention'])assert.deepEqual(one[key],many[key]);
 const change={eventId:'negative',revision:1,basisId:'heard-explanation',atS:101,
  interpretation:{progress:-1,expectedProgress:0,certainty:1,attribution:'unable',otherId:'ilya'}};
 assert.deepEqual(reappraiseActingOutcome(many,change),reappraiseActingOutcome(one,change));
});

test('reappraisal after NPC time advancement remains canonical and never completes a decision',()=>{
 let mind=migrateNpcMind(fixtures.active);
 mind=perceiveNpcOutcome(mind,outcome({id:'new-observation',sequence:2,atS:4,progress:-.5,attribution:'unwilling'}));
 mind=setNpcNeed(mind,'energy',.5,5);const before=clone(mind);
 const acting=reappraiseActingOutcome(mind.acting,{eventId:'new-observation',revision:1,basisId:'heard-explanation',atS:6,
  interpretation:{progress:1,expectedProgress:0,certainty:1,attribution:'help',otherId:'ilya'}});
 const revised={...mind,acting};valid(revised);
 assert.deepEqual(revised.decision,mind.decision);assert.deepEqual(acting.intention,mind.acting.intention);
 assert.equal(acting.lastSequence,mind.acting.lastSequence);assert.equal(acting.memories.length,mind.acting.memories.length);
 valid(stepNpcMind(revised,6,[talk]).mind);assert.deepEqual(mind,before);
});

test('all thirteen authored gestures retain frozen neutral cues and complete motor samples',()=>{
 assert.deepEqual(ACTING_ACTIONS,gestures.cases.map(row=>row.cue.action));
 const mind=createNpcMind('gesture-oracle');
 for(const row of gestures.cases){
  const cue=makeActingCue(mind.acting,1,row.cue.action,0,2.4,[2,1.6,0]);
  assert.deepEqual(cue,row.cue);assert.deepEqual(sampleActingPerformance(cue,gestures.sampleTimeS),row.performance);
 }
 assert.equal(NPC_NEEDS.length,4);
});

test('legacy/current clock corruption and inconsistent NPC state fail without normalization',()=>{
 for(const source of [fixtures.active,mixed()]){
  for(const mutate of [m=>m.acting.affect.atS=m.acting.atS+1,m=>m.acting.memories[0].atS=m.acting.atS+1,
   m=>m.thoughts=[{atS:m.acting.atS+1,kind:'wait',need:null,subject:null,affordanceId:null,confidence:0}],
   m=>m.needs[0].importance=.123,m=>m.cueSerial=-1,m=>m.version=2]){
   const bad=clone(source);mutate(bad);const before=clone(bad);assert.throws(()=>migrateNpcMind(bad));assert.deepEqual(bad,before);
  }
 }
 const current=mixed(),tampered=clone(current);tampered.acting.affect.atS=0;
 assert.throws(()=>migrateNpcMind(tampered));assert.throws(()=>validateNpcMind(fixtures.active),/migrate/i);
 const before=clone(current);
 for(const time of [0,-1,NaN,Infinity]){
  assert.throws(()=>advanceActingMind(current.acting,time));assert.throws(()=>setNpcNeed(current,'energy',.5,time));
  assert.throws(()=>stepNpcMind(current,time,[]));
 }
 assert.deepEqual(current,before);
});
