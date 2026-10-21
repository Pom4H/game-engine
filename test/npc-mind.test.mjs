import test from 'node:test';
import assert from 'node:assert/strict';
import {Scene} from '../dist/scene/scene.js';
import {ConversationFaceRig,conversationFaceEntities,sampleConversationArticulation} from '../dist/animation/conversation-face.js';
import {
 NPC_NEEDS,NPC_MIND_LIMITS,ACTING_ACTIONS,ActingRig,createNpcMind,setNpcNeed,
 stepNpcMind,perceiveNpcOutcome,validateNpcMind,makeActingCue,
} from '../dist/acting/index.js';

const needs=(values={},growth=0)=>NPC_NEEDS.map(id=>({id,urgency:values[id]??0,growthPerS:growth,importance:1}));
const create=()=>createNpcMind('anna',needs({company:.9}));
const talk=(patch={})=>({id:'talk',need:'company',subject:'conversation',partnerId:'ilya',available:true,distanceM:1,expectedRelief:1,confidence:1,position:[1,1.6,0],...patch});
const receipt=(patch={})=>({sequence:1,id:'result:1',goalId:'company',subject:'conversation',otherId:'ilya',atS:1,progress:1,expectedProgress:1,certainty:1,attribution:'help',confirmedResolution:true,...patch});
const urgency=(m,key='company')=>m.needs.find(n=>n.id===key).urgency;

test('NPC chooses a perceived opportunity and connects its need, intention, attention and greeting',()=>{
 const original=create(),before=JSON.stringify(original),{mind,cue,request}=stepNpcMind(original,0,[talk()]);
 assert.equal(request.need,'company');assert.equal(request.status,'active');assert.equal(mind.acting.intention.action,'ask');
 assert.equal(cue.action,'greet');assert.deepEqual(cue.gazeTarget,[1,1.6,0]);assert.equal(mind.attention.subject,'conversation');
 assert.equal(mind.thoughts[0].kind,'intend');assert.equal(JSON.stringify(original),before);validateNpcMind(mind);
});

test('highest unmet need, expected relief, uncertainty and distance affect deliberation',()=>{
 const m=createNpcMind('anna',needs({energy:.95,company:.8,understanding:.9}));
 const rest=talk({id:'rest',need:'energy',partnerId:undefined,subject:'bench'});
 assert.equal(stepNpcMind(m,0,[talk(),rest]).request.need,'energy');
 assert.equal(stepNpcMind(m,0,[talk(),{...rest,confidence:.1}]).request.need,'company');
 assert.equal(stepNpcMind(m,0,[talk(),{...rest,distanceM:100}]).request.need,'company');
 assert.equal(stepNpcMind(m,0,[talk(),{...rest,expectedRelief:.1}]).request.need,'company');
});

test('unavailable or unknown opportunities cannot become actions and ties are stable',()=>{
 assert.equal(stepNpcMind(create(),0,[]).request,null);
 assert.equal(stepNpcMind(create(),0,[talk({available:false})]).request,null);
 assert.equal(stepNpcMind(create(),0,[talk({confidence:0})]).request,null);
 assert.equal(stepNpcMind(create(),0,[talk({id:'z'}),talk({id:'a'})]).request.affordanceId,'a');
 assert.equal(stepNpcMind(create(),0,[talk({id:'a'}),talk({id:'z'})]).request.affordanceId,'a');
});

test('a live decision persists and requests are emitted only when a decision begins',()=>{
 const first=stepNpcMind(create(),0,[talk()]);
 const second=stepNpcMind(first.mind,.1,[talk({id:'closer',distanceM:0})]);
 assert.equal(second.request,null);assert.equal(second.cue,null);assert.deepEqual(second.mind.decision,first.request);
 assert.equal(second.mind.attention,null);assert.equal(urgency(second.mind),.9);
});

test('gaze refreshes from current observation and never follows a hidden target',()=>{
 const first=stepNpcMind(create(),0,[talk()]).mind;
 const moved=stepNpcMind(first,1,[talk({position:[2,1.5,0]})]).mind;
 assert.deepEqual(moved.attention.position,[2,1.5,0]);
 const lost=stepNpcMind(moved,2,[]).mind;assert.equal(lost.attention,null);
 assert.equal(lost.decision.status,'active');
});

test('waiting for a response listens after greeting and retains a clarification tactic',()=>{
 let m=stepNpcMind(create(),0,[talk()]).mind;
 let next=stepNpcMind(m,2.4,[talk()]);assert.equal(next.cue.action,'listen');m=next.mind;
 m=perceiveNpcOutcome(m,receipt({atS:3,progress:0,attribution:'unable',confirmedResolution:false}));
 next=stepNpcMind(m,3,[talk()]);assert.equal(next.cue.action,'clarify');
 assert.equal(stepNpcMind(next.mind,5.5,[talk()]).cue.action,'clarify');
});

test('unmet needs grow in simulation seconds independently of tick rate',()=>{
 const initial=createNpcMind('anna',needs({},.0001));
 const one=stepNpcMind(initial,100,[]).mind;
 let many=initial;for(let i=1;i<=1000;i++)many=stepNpcMind(many,i/10,[]).mind;
 for(const n of NPC_NEEDS)assert.ok(Math.abs(urgency(one,n)-urgency(many,n))<1e-12);
 assert.equal(many.thoughts.length,1);
});

test('elapsed animation time alone never confirms or satisfies an action',()=>{
 let m=stepNpcMind(create(),0,[talk()]).mind;
 for(let i=1;i<=8;i++)m=stepNpcMind(m,i,[talk()]).mind;
 assert.equal(m.decision.status,'active');assert.equal(urgency(m),.9);assert.equal(m.acting.memories.length,0);
});

test('a confirmed observed result updates need, emotion, memory and celebratory performance',()=>{
 let m=stepNpcMind(create(),0,[talk()]).mind;
 m=perceiveNpcOutcome(m,receipt());assert.equal(m.decision.status,'succeeded');assert.equal(urgency(m),.25);
 assert.ok(m.acting.affect.valence>0);assert.equal(m.thoughts[0].kind,'succeeded');
 const next=stepNpcMind(m,1,[talk()]);assert.equal(next.request,null);assert.equal(next.cue.action,'celebrate');
 assert.ok(next.cue.smile>.8);validateNpcMind(next.mind);
});

test('inability prompts clarification without treating the partner as malicious',()=>{
 let m=stepNpcMind(create(),0,[talk()]).mind;
 m=perceiveNpcOutcome(m,receipt({progress:0,attribution:'unable',confirmedResolution:false}));
 assert.equal(m.decision.status,'active');assert.equal(m.acting.intention.action,'clarify');
 assert.equal(m.acting.sentiments.find(s=>s.subject==='ilya').benevolence,.5);
 assert.equal(stepNpcMind(m,1,[talk()]).cue.action,'clarify');
});

test('refusal stops retries and another available partner can be chosen',()=>{
 let m=stepNpcMind(create(),0,[talk()]).mind;
 m=perceiveNpcOutcome(m,receipt({progress:0,attribution:'unwilling',confirmedResolution:false}));
 const next=stepNpcMind(m,1,[talk(),talk({id:'pavel',partnerId:'pavel'})]);
 assert.equal(next.request.partnerId,'pavel');assert.equal(next.cue.action,'withdraw');
 assert.equal(next.mind.acting.intention.partnerId,'pavel');
});

test('replayed evidence never double rewards a need, including a new sequence',()=>{
 const m=perceiveNpcOutcome(stepNpcMind(create(),0,[talk()]).mind,receipt());
 assert.equal(perceiveNpcOutcome(m,receipt()),m);
 const next=perceiveNpcOutcome(m,receipt({sequence:2,atS:2}));
 assert.equal(urgency(next),urgency(m));assert.deepEqual(next.acting.affect,m.acting.affect);
 assert.equal(next.thoughts.length,m.thoughts.length);assert.equal(next.acting.lastSequence,2);
});

test('duplicate receipts still account for elapsed need growth',()=>{
 let m=createNpcMind('anna',needs({company:.9},.01));m=stepNpcMind(m,0,[talk()]).mind;
 m=perceiveNpcOutcome(m,receipt());const prior=urgency(m);
 m=perceiveNpcOutcome(m,receipt({sequence:2,atS:3}));assert.ok(Math.abs(urgency(m)-prior-.02)<1e-12);
});

test('another subject or partner cannot resolve the current decision',()=>{
 for(const patch of [{subject:'other-topic'},{otherId:'pavel'}]){
  const m=perceiveNpcOutcome(stepNpcMind(create(),0,[talk()]).mind,receipt(patch));
  assert.equal(m.decision.status,'active');
 }
});

test('a timeout waits before retrying and never fabricates a failed world result',()=>{
 const initial=stepNpcMind(create(),0,[talk()]).mind;
 const timeout=stepNpcMind(initial,10,[talk()]);assert.equal(timeout.request,null);assert.equal(timeout.mind.decision.status,'blocked');
 assert.ok(timeout.mind.thoughts.some(t=>t.kind==='timeout'));assert.equal(timeout.mind.acting.memories.length,0);
 assert.equal(stepNpcMind(timeout.mind,19,[talk()]).request,null);
 assert.equal(stepNpcMind(timeout.mind,20,[talk()]).request.affordanceId,'talk');
});

test('critical safety interrupts a social intention and drives a protective gesture',()=>{
 let m=stepNpcMind(create(),0,[talk()]).mind;m=setNpcNeed(m,'safety',1,1);
 const escape={id:'escape',need:'safety',subject:'exit',available:true,distanceM:1,expectedRelief:1,confidence:1};
 const next=stepNpcMind(m,1,[talk(),escape]);
 assert.equal(next.request.need,'safety');assert.equal(next.mind.acting.intention,null);assert.equal(next.cue.action,'startle');
 assert.ok(next.cue.browLift>=.85);assert.ok(next.mind.thoughts.some(t=>t.kind==='interrupted'));
 const partial=perceiveNpcOutcome(next.mind,{...receipt(),id:'escape:1',goalId:'safety',subject:'exit',otherId:undefined,atS:2,progress:.2,confirmedResolution:false});
 assert.equal(partial.decision.status,'active');
});

test('memory and thoughts stay bounded across long simulations and survive JSON restoration',()=>{
 let m=create();
 for(let i=1;i<=200;i++){
  const atS=i*20;m=setNpcNeed(m,'company',.9,atS);m=stepNpcMind(m,atS,[talk()]).mind;
  m=perceiveNpcOutcome(m,receipt({id:`event:${i}`,sequence:i,atS:atS+1}));
 }
 assert.equal(m.thoughts.length,NPC_MIND_LIMITS.thoughts);assert.equal(m.acting.memories.length,32);
 const restored=JSON.parse(JSON.stringify(m));validateNpcMind(restored);
 assert.deepEqual(stepNpcMind(restored,4020,[talk()]),stepNpcMind(m,4020,[talk()]));
});

test('receipt and tick replay is deterministic and observation inputs are copied',()=>{
 const replay=()=>{
  let m=create();m=stepNpcMind(m,0,[talk()]).mind;
  m=perceiveNpcOutcome(m,receipt({progress:0,attribution:'unable',confirmedResolution:false}));
  m=stepNpcMind(m,1,[talk()]).mind;m=perceiveNpcOutcome(m,receipt({id:'ok',sequence:2,atS:2}));
  return stepNpcMind(m,2,[talk()]);
 };
 assert.deepEqual(replay(),replay());
 const opportunity=talk(),next=stepNpcMind(create(),0,[opportunity]);opportunity.position[0]=999;
 assert.equal(next.mind.attention.position[0],1);assert.equal(next.cue.gazeTarget[0],1);
});

test('invalid restored states, backwards clocks, duplicate opportunities and invalid perceptions are rejected atomically',()=>{
 const m=stepNpcMind(create(),1,[talk()]).mind,before=JSON.stringify(m);
 for(const call of [()=>stepNpcMind(m,0,[]),()=>stepNpcMind(m,NaN,[]),()=>stepNpcMind(m,2,[talk(),talk()]),
  ()=>stepNpcMind(m,2,[talk({position:[NaN,0,0]})]),()=>stepNpcMind(m,2,[talk({partnerId:'anna'})]),
  ()=>setNpcNeed(m,'safety',2,2),()=>setNpcNeed(m,'unknown',.5,2),
  ()=>validateNpcMind({...m,cueSerial:-1}),()=>validateNpcMind({...m,lastCueS:3}),
  ()=>validateNpcMind({...m,decision:{...m.decision,expiresAtS:Infinity}}),
  ()=>validateNpcMind({...m,decision:{...m.decision,partnerId:'pavel'}}),
  ()=>validateNpcMind({...m,attention:{subject:'unknown',confidence:1}}),
  ()=>validateNpcMind({...m,thoughts:[{...m.thoughts[0],atS:3}]})])assert.throws(call);
 assert.equal(JSON.stringify(m),before);
});

test('frequent receipts coalesce visual gestures without losing semantic evidence',()=>{
 let {mind:m,cue}=stepNpcMind(create(),0,[talk()]);assert.equal(cue.serial,1);
 for(let i=1;i<=3;i++){
  m=perceiveNpcOutcome(m,receipt({id:`try:${i}`,sequence:i,atS:i*.03,progress:0,confirmedResolution:false}));
  const result=stepNpcMind(m,i*.03,[talk()]);m=result.mind;assert.equal(result.cue,null);
 }
 const next=stepNpcMind(m,.23,[talk()]);assert.equal(next.cue.action,'withdraw');
 assert.equal(next.mind.acting.memories.length,3);assert.equal(next.cue.serial,2);
});

test('all expressive cues run through a real Scene and face rig with the original speech score',()=>{
 const turn={id:'speech',speakerId:'anna',text:'a',startS:0,segments:[{phone:'a',durationS:60}],pitch:[{timeS:0,hz:120}],pressure:[{timeS:0,pa:800}]};
 const scene=new Scene({version:1,gravity:[0,0,0],ground:-100,entities:conversationFaceEntities({id:'anna'}),
  animation:{walkers:[{id:'anna',root:[0,0,0],speed:0}],vehicles:[]}});
 const rig=new ActingRig(scene.animation,'anna'),face=new ConversationFaceRig(scene,{id:'anna',speakerId:'anna',turns:[turn]});
 let serial=0,time=0;
 for(const action of ACTING_ACTIONS){
  rig.submit(makeActingCue(create().acting,++serial,action,time));
  for(let i=0;i<30;i++){
   scene.step(1/60);time=scene.animation.timeSeconds;
   const pose=rig.stepFace(face,time,1/60);
   assert.deepEqual(pose.speech,sampleConversationArticulation([turn],'anna',time));
   for(const e of scene.entities.values())assert.ok([...e.position,...e.rotation,...e.scale].every(Number.isFinite));
  }
 }
 rig.dispose();assert.equal(rig.diagnostics.attached,false);
});
