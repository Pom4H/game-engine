import test from 'node:test';
import assert from 'node:assert/strict';
import {AnimationSystem,sampleWalker,bindHumanoid} from '../dist/animation/locomotion.js';
import {compose,multiply4} from '../dist/math.js';
import {ACTING_ACTIONS,ACTING_LIMITS,createActingMind,validateActingMind,beginActingIntention,cancelActingIntention,
 appraiseActingOutcome,actingAffectAt,chooseActingPartner,makeActingCue,sampleActingPerformance,validateActingCue,ActingRig} from '../dist/acting/index.js';
const mind=(importance=1)=>createActingMind('anna',[{id:'understand',importance}]);
const outcome=(patch={})=>({sequence:1,id:'receipt:1',goalId:'understand',subject:'pump',atS:1,progress:-.5,expectedProgress:.5,certainty:1,attribution:'unable',otherId:'ilya',...patch});
const cue=(action='ask',patch={})=>({version:1,serial:1,action,startS:0,durationS:2.4,intensity:.8,smile:.2,browLift:.3,browTilt:.1,squint:.1,...patch});
const dist=(a,b)=>Math.hypot(...a.map((v,i)=>v-b[i]));
const close=(a,b,tol=1e-8)=>assert.ok(Math.abs(a-b)<tol,`${a} != ${b}`);
const rig=(heading=0,heightScale=1,bindings=[])=>{const a=new AnimationSystem();a.addWalker({id:'anna',root:[0,0,0],heading,heightScale,speed:0,bindings});return {a,r:new ActingRig(a,'anna')};};
const entity=id=>({id,position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]});

test('the same event means more to a more important goal',()=>{
 const a=appraiseActingOutcome(mind(1),outcome()),b=appraiseActingOutcome(mind(.1),outcome());
 assert.ok(Math.abs(a.affect.valence)>Math.abs(b.affect.valence));assert.ok(a.affect.arousal>b.affect.arousal);
});
test('expectation changes appraisal, not the committed event',()=>{
 const a=appraiseActingOutcome(mind(),outcome({progress:0,expectedProgress:1})),b=appraiseActingOutcome(mind(),outcome({progress:0,expectedProgress:0}));
 assert.ok(a.affect.valence<b.affect.valence);assert.ok(a.affect.arousal>b.affect.arousal);assert.equal(a.memories[0].progress,0);
});
test('unable is not unwilling; inability does not prove incompetence',()=>{
 const a=appraiseActingOutcome(mind(),outcome()),b=appraiseActingOutcome(mind(),outcome({attribution:'unwilling'}));
 const x=a.sentiments.find(s=>s.subject==='ilya'),y=b.sentiments.find(s=>s.subject==='ilya');
 assert.equal(x.benevolence,.5);assert.equal(x.competence,.5);assert.equal(x.reliability,.5);assert.ok(y.benevolence<x.benevolence);
});
test('uncertain attribution does not turn into strong condemnation',()=>{
 const a=appraiseActingOutcome(mind(),outcome({certainty:0,attribution:'unwilling'}));
 assert.equal(a.sentiments.find(s=>s.subject==='ilya').benevolence,.5);assert.equal(a.affect.uncertainty,1);
});
test('reliability and competence learn only from their own evidence',()=>{
 const a=appraiseActingOutcome(mind(),outcome({competenceEvidence:1,reliabilityEvidence:-1})).sentiments.find(s=>s.subject==='ilya');
 assert.ok(a.competence>.5);assert.ok(a.reliability<.5);assert.equal(a.benevolence,.5);
});
test('emotion decays while durable sentiment stays',()=>{
 const a=appraiseActingOutcome(mind(),outcome()),before=JSON.stringify(a.sentiments);assert.ok(Math.abs(actingAffectAt(a,120).valence)<.001);assert.equal(JSON.stringify(a.sentiments),before);
});
test('duplicate sequence and duplicate retained evidence do not reward twice',()=>{
 const a=appraiseActingOutcome(mind(),outcome());assert.equal(appraiseActingOutcome(a,outcome()),a);
 const b=appraiseActingOutcome(a,outcome({sequence:2,atS:2}));assert.deepEqual(a.affect,b.affect);assert.deepEqual(a.sentiments,b.sentiments);assert.equal(b.lastSequence,2);
});
test('request changes tactic without declaring the problem solved',()=>{
 const a=beginActingIntention(mind(),{id:'intent1',goalId:'understand',subject:'pump',partnerId:'ilya'},0);
 const b=appraiseActingOutcome(a,outcome());assert.equal(b.intention.action,'clarify');assert.equal(b.intention.status,'active');
 const c=appraiseActingOutcome(b,outcome({sequence:2,id:'receipt2',atS:2,progress:1,attribution:'help'}));assert.equal(c.intention.status,'active');
 const d=appraiseActingOutcome(c,outcome({sequence:3,id:'receipt3',atS:3,progress:1,attribution:'help',confirmedResolution:true}));assert.equal(d.intention.status,'succeeded');assert.equal(d.intention.action,'acknowledge');
});
test('refusal stops pressure and no request hijacks another active intention',()=>{
 const a=beginActingIntention(mind(),{id:'i1',goalId:'understand',subject:'pump',partnerId:'ilya'},0);
 assert.throws(()=>beginActingIntention(a,{id:'i2',goalId:'understand',subject:'pump',partnerId:'ilya'},0));
 assert.equal(appraiseActingOutcome(a,outcome({attribution:'unwilling'})).intention.action,'withdraw');
 assert.equal(cancelActingIntention(a,1).intention.status,'blocked');
});
test('unrelated outcomes cannot complete an intention',()=>{
 const a=beginActingIntention(mind(),{id:'i1',goalId:'understand',subject:'pump',partnerId:'ilya'},0);
 const b=appraiseActingOutcome(a,outcome({otherId:'pavel',progress:1,confirmedResolution:true}));assert.equal(b.intention.attempts,0);
});
test('attempt count remains bounded',()=>{
 let a=beginActingIntention(mind(),{id:'i1',goalId:'understand',subject:'pump',partnerId:'ilya'},0);
 for(let i=1;i<=10;i++)a=appraiseActingOutcome(a,outcome({sequence:i,id:`e${i}`,atS:i}));
 assert.equal(a.intention.attempts,3);assert.equal(a.intention.status,'blocked');validateActingMind(a);
});
test('bounded memory, JSON restore, and deterministic replay',()=>{
 let a=mind();const events=Array.from({length:1000},(_,i)=>outcome({id:`e${i}`,sequence:i+1,atS:i+1,subject:`s${i}`,otherId:`p${i}`}));
 for(const e of events)a=appraiseActingOutcome(a,e);assert.equal(a.memories.length,ACTING_LIMITS.memories);assert.equal(a.sentiments.length,ACTING_LIMITS.sentiments);
 validateActingMind(JSON.parse(JSON.stringify(a)));assert.deepEqual(events.reduce(appraiseActingOutcome,mind()),a);
});
test('partner selection uses learned expectations and stable ties',()=>{
 const a=appraiseActingOutcome(mind(),outcome({progress:1,attribution:'help',competenceEvidence:1}));
 assert.equal(chooseActingPartner(a,[{id:'pavel',available:true,distanceM:1},{id:'ilya',available:true,distanceM:1}]),'ilya');
 assert.equal(chooseActingPartner(mind(),[{id:'z',available:true,distanceM:1},{id:'a',available:true,distanceM:1}]),'a');
 assert.equal(chooseActingPartner(a,[{id:'ilya',available:false,distanceM:0}]),null);
});
test('invalid clocks, sequences, IDs and false resolutions are rejected',()=>{
 for(const e of [outcome({atS:NaN}),outcome({sequence:0}),outcome({progress:2}),outcome({confirmedResolution:true}),outcome({goalId:'not-known'})])assert.throws(()=>appraiseActingOutcome(mind(),e));
 assert.throws(()=>actingAffectAt(mind(),-1));assert.throws(()=>createActingMind('a',[{id:'g',importance:1},{id:'g',importance:1}]));
 assert.throws(()=>validateActingMind({...mind(),lastSequence:-1}));
});
test('cues expose motor values, not subjective memories or intentions',()=>{
 const c=makeActingCue(appraiseActingOutcome(mind(),outcome()),1,'clarify',1,2,[1,2,3]);validateActingCue(c);
 assert.deepEqual(Object.keys(c).sort(),['version','serial','action','startS','durationS','intensity','smile','browLift','browTilt','squint','gazeTarget'].sort());
});
for(const action of ACTING_ACTIONS)test(`${action}: finite, bounded, deterministic envelope; neutral outside its lifetime`,()=>{
 const c=cue(action);for(let t=0;t<3;t+=1/120){const f=sampleActingPerformance(c,t);assert.ok(Object.values(f).flat().every(Number.isFinite));assert.ok(f.weight>=0&&f.weight<=1);assert.deepEqual(f,sampleActingPerformance(c,t));}
 for(const t of [0,2.4,100]){const f=sampleActingPerformance(c,t);assert.equal(f.weight,0);close(Math.hypot(...f.leftHandOffset,...f.rightHandOffset),0);}
});
test('cue validation rejects untrusted non-finite input',()=>{
 for(const c of [cue('ask',{smile:NaN}),cue('ask',{durationS:20}),cue('ask',{gazeTarget:[Infinity,1,2]}),cue('bad'),cue('ask',{serial:0})])assert.throws(()=>validateActingCue(c));
});
test('native layer preserves foot contacts, root, pelvis and all bone lengths',()=>{
 for(const heading of [0,Math.PI/2,Math.PI,-1.2])for(const height of [.6,1,1.8])for(const action of ACTING_ACTIONS){
  const {a,r}=rig(heading,height);r.submit(cue(action));a.step(.8,new Map());const p=a.pose('anna'),b=sampleWalker({id:'anna',root:[0,0,0],heading,heightScale:height,speed:0},.8);
  for(const key of ['root','pelvis','leftFoot','rightFoot','leftKnee','rightKnee','leftHip','rightHip','leftAnkle','rightAnkle'])assert.deepEqual(p.joints[key],b.joints[key]);assert.deepEqual(p.feet,b.feet);
  for(const side of ['left','right']){close(dist(p.joints[`${side}Shoulder`],p.joints[`${side}Elbow`]),.295*height);close(dist(p.joints[`${side}Elbow`],p.joints[`${side}Hand`]),.27*height);}
 }
});
test('zero-arm gestures do not alter elbows; beginning is continuous',()=>{
 const {a,r}=rig();r.submit(cue('listen'));a.step(.5,new Map());const b=sampleWalker({id:'anna',root:[0,0,0],speed:0},.5);assert.deepEqual(a.pose('anna').joints.leftElbow,b.joints.leftElbow);
 const q=rig();q.r.submit(cue('ask'));q.a.step(1e-6,new Map());const rest=sampleWalker({id:'anna',root:[0,0,0],speed:0},1e-6);assert.ok(dist(q.a.pose('anna').joints.leftElbow,rest.joints.leftElbow)<1e-8);
});
test('+X engine convention and heading rotate the gesture, not its feet',()=>{
 const x=rig(0),z=rig(Math.PI/2);x.r.submit(cue());z.r.submit(cue());x.a.step(.5,new Map());z.a.step(.5,new Map());
 const px=x.a.pose('anna').joints.rightHand,pz=z.a.pose('anna').joints.rightHand;close(pz[0],px[2]);close(pz[2],-px[0]);
});
test('occupied channels are not overridden',()=>{
 const {a,r}=rig();r.submit(cue(),{leftArm:false,rightArm:true,head:false});a.step(.5,new Map());const b=sampleWalker({id:'anna',root:[0,0,0],speed:0},.5);
 assert.deepEqual(a.pose('anna').joints.leftElbow,b.joints.leftElbow);assert.deepEqual(a.pose('anna').joints.leftHand,b.joints.leftHand);assert.ok(dist(a.pose('anna').joints.rightHand,b.joints.rightHand)>.1);
 assert.equal(a.pose('anna').headRotation,undefined);assert.equal(r.faceFrame(.5).smile,0);
});
test('head-bound nose and face use exactly the same rigid frame',()=>{
 const bindings=[{entity:'nose',joint:'head',offset:[.1,0,0],rotation:[.2,.1,.3]}],{a,r}=rig(.6,1,bindings),nose=entity('nose');r.submit(cue('acknowledge'));a.step(.35,new Map([['nose',nose]]));
 const p=a.pose('anna'),f=r.faceFrame(.35),m=compose(f.position,f.rotation,[1,1,1]);
 assert.deepEqual(f.rotation,p.headRotation);for(let i=0;i<3;i++)close(nose.position[i],m[i]*.1+m[12+i],1e-7);
 const expected=multiply4(compose([0,0,0],f.rotation,[1,1,1]),compose([0,0,0],[.2,.1,.3],[1,1,1])),actual=compose([0,0,0],nose.rotation,[1,1,1]);for(let i=0;i<16;i++)close(actual[i],expected[i],2e-7);
});
test('face stepping forwards one shared frame, never an invented mouth motor',()=>{
 const {a,r}=rig();r.submit(cue('explain'));a.step(.5,new Map());let seen;
 const face={step(t,dt,frame){seen={t,dt,frame};return {timeS:t,speech:{unchanged:true}};}};
 assert.deepEqual(r.stepFace(face,.5,.1),{timeS:.5,speech:{unchanged:true}});assert.equal(seen.t,.5);assert.equal(seen.dt,.1);assert.ok(!('jaw' in seen.frame));assert.ok(!('speech' in seen.frame));assert.throws(()=>r.faceFrame(.6));
});
test('switching actions crossfades without restarting or snapping the old cue',()=>{
 const {a,r}=rig();r.submit(cue());a.step(.8,new Map());const before=a.pose('anna');r.submit(cue('decline',{serial:2,startS:.8}));a.step(.8,new Map());assert.deepEqual(a.pose('anna'),before);
 assert.equal(r.submit(cue('explain',{serial:1,startS:.2})),false);assert.throws(()=>r.submit(cue('explain',{serial:3,startS:.9})));assert.equal(r.diagnostics.retainedCues,2);
});
test('layer ownership is exclusive and cleanup cannot affect a replacement actor',()=>{
 const {a,r}=rig();assert.throws(()=>new ActingRig(a,'anna'));a.remove('anna');assert.equal(r.diagnostics.attached,false);assert.throws(()=>r.submit(cue()));
 a.addWalker({id:'anna',root:[0,0,0],speed:0});const next=new ActingRig(a,'anna');r.dispose();assert.equal(next.diagnostics.attached,true);next.dispose();assert.throws(()=>next.submit(cue()));
});
test('invalid upper-body results cannot partially write bound entities',()=>{
 const a=new AnimationSystem(),hand=entity('hand');a.addWalker({id:'a',root:[0,0,0],speed:0,bindings:[{entity:'hand',joint:'rightHand'}]});a.setUpperBodyLayer('a',()=>({rightHand:[NaN,0,0]}));
 assert.throws(()=>a.step(.1,new Map([['hand',hand]])));assert.deepEqual(hand.position,[0,0,0]);assert.equal(a.timeSeconds,0);
});
test('dynamic physics authority is preserved by the native animation validation',()=>{
 const hand={...entity('hand'),body:{invMass:1,kinematic:false}},q=rig(0,1,[{entity:'hand',joint:'rightHand'}]);q.r.submit(cue());assert.throws(()=>q.a.step(.5,new Map([['hand',hand]])),/Dynamic body/);assert.deepEqual(hand.position,[0,0,0]);
});
test('without a layer, the original walking pose and bindings are unchanged',()=>{
 const a=new AnimationSystem();const spec={id:'a',root:[1,0,2],speed:.6,heading:.7,bindings:[{entity:'h',joint:'head',offset:[.1,0,0]}]},h=entity('h');a.addWalker(spec);a.step(.8,new Map([['h',h]]));
 const expected=sampleWalker(spec,.8),bound=bindHumanoid(expected,spec.bindings)[0];assert.deepEqual(a.pose('a'),expected);assert.deepEqual(h.position,bound.position);assert.deepEqual(h.rotation,bound.rotation);
});
test('failed layer validation does not advance a driven walker before retry',()=>{
 const a=new AnimationSystem(),reference=new AnimationSystem();for(const x of [a,reference]){x.addWalker({id:'a',root:[0,0,0],speed:0});x.driveWalker('a',1,0);}
 const bad=()=>({rightHand:[NaN,0,0]});a.setUpperBodyLayer('a',bad);assert.throws(()=>a.step(.2,new Map()));a.clearUpperBodyLayer('a',bad);
 a.step(.2,new Map());reference.step(.2,new Map());assert.deepEqual(a.pose('a'),reference.pose('a'));
});
test('current-main body proportions and relaxed stance survive the acting layer',()=>{
 for(const arms of [.7,1.3])for(const shoulders of [.7,1.3])for(const torso of [.7,1.3]){
  const spec={id:'anna',root:[0,0,0],speed:0,stance:'neutral',proportions:{arms,shoulders,torso,legs:1.2,hips:.8}};
  const a=new AnimationSystem();a.addWalker(spec);const r=new ActingRig(a,'anna');r.submit(cue());a.step(.5,new Map());const p=a.pose('anna'),rest=sampleWalker(spec,.5);
  assert.deepEqual(p.feet,rest.feet);assert.deepEqual(p.joints.pelvis,rest.joints.pelvis);
  for(const side of ['left','right']){close(dist(p.joints[`${side}Shoulder`],p.joints[`${side}Elbow`]),.295*arms);close(dist(p.joints[`${side}Elbow`],p.joints[`${side}Hand`]),.27*arms);}
 }
});
test('current-main orientFrom attachments remain aligned with the gesturing forearm',()=>{
 const binding={entity:'hand',joint:'rightHand',orientFrom:'rightElbow',offset:[0,-.04,0],scale:[.06,.08,.03]},q=rig(1.2,1,[binding]),hand=entity('hand');q.r.submit(cue('explain'));q.a.step(.5,new Map([['hand',hand]]));
 const p=q.a.pose('anna'),matrix=compose([0,0,0],hand.rotation,[1,1,1]),direction=p.joints.rightElbow.map((v,i)=>v-p.joints.rightHand[i]),length=Math.hypot(...direction);
 for(let i=0;i<3;i++)close(matrix[4+i],direction[i]/length,1e-7);
});
