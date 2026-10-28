import test from 'node:test';
import assert from 'node:assert/strict';
import {
 createActingMind,appraiseActingOutcome,reappraiseActingOutcome,actingAffectAt,actingEmotionsAt,
 evaluateActingInterpretation,validateActingMind,validateActingOutcome,migrateActingMind,
 beginActingIntention,cancelActingIntention,chooseActingAction,chooseActingPartner,ACTING_LIMITS,
} from '../dist/acting/motivation.js';
const fresh=(importance=1)=>createActingMind('anna',[{id:'understand',importance}]);
const ev=(p={})=>({id:'refusal',sequence:1,goalId:'understand',subject:'pump',atS:1,progress:-.5,expectedProgress:.5,certainty:1,attribution:'unwilling',otherId:'ilya',...p});
const interp=(p={})=>({progress:-.5,expectedProgress:.5,certainty:1,attribution:'unwilling',otherId:'ilya',...p});
const revise=(m,p={})=>reappraiseActingOutcome(m,{eventId:'refusal',revision:1,basisId:'heard-explanation',atS:2,interpretation:interp({attribution:'unable'}),...p});
const relation=(m,id='ilya')=>m.sentiments.find(s=>s.subject===id);
const active=()=>beginActingIntention(fresh(),{id:'request',goalId:'understand',subject:'pump',partnerId:'ilya'},0);
function near(a,b,t=1e-10){assert.ok(Math.abs(a-b)<t,`${a} vs ${b}`);}
function emotionsEqual(a,b){for(const k of Object.keys(a))near(a[k],b[k]);}
const clone=x=>JSON.parse(JSON.stringify(x));
const legacy=()=>({version:1,actorId:'anna',goals:[{id:'understand',importance:1}],sentiments:[],memories:[ev()],affect:{valence:-.5,arousal:.7,uncertainty:.3,atS:1},intention:null,lastSequence:1,atS:3});

test('neutral event does not attenuate previous emotion by event count',()=>{
 const a=appraiseActingOutcome(fresh(),ev());let b=a;
 for(let i=2;i<=100;i++)b=appraiseActingOutcome(b,ev({id:`neutral${i}`,sequence:i,atS:2,progress:0,expectedProgress:0,attribution:'unknown',otherId:undefined}));
 emotionsEqual(actingEmotionsAt(a,2),actingEmotionsAt(b,2));validateActingMind(b);
});
test('lazy time decay is independent of polling rate',()=>{
 const a=appraiseActingOutcome(fresh(),ev());const snapshot=clone(a);
 for(let t=1;t<100;t+=.01)actingEmotionsAt(a,t);
 assert.deepEqual(a,snapshot);near(actingAffectAt(a,25).valence,a.affect.valence*Math.exp(-2));
});
test('mixed good and bad feelings coexist even when their valence cancels',()=>{
 let a=appraiseActingOutcome(fresh(),ev({progress:1,expectedProgress:0,attribution:'help'}));
 a=appraiseActingOutcome(a,ev({sequence:2,id:'loss',progress:-1,expectedProgress:0}));
 near(a.affect.valence,0);assert.ok(a.emotions.positive>.5&&a.emotions.negative>.5);assert.ok(a.emotions.gratitude>0&&a.emotions.anger>0);
});
test('goal importance and expectation affect appraisal',()=>{
 const a=appraiseActingOutcome(fresh(),ev()),b=appraiseActingOutcome(fresh(.1),ev());assert.ok(Math.abs(a.affect.valence)>Math.abs(b.affect.valence));
 const x=evaluateActingInterpretation(interp({progress:0,expectedProgress:1}),1),y=evaluateActingInterpretation(interp({progress:0,expectedProgress:0}),1);assert.ok(x.negative>y.negative);
});
test('certainty and likelihood are distinct; control affects fear',()=>{
 const p=interp({phase:'prospect',progress:-1,expectedProgress:0,likelihood:.8,controllability:0});
 const a=evaluateActingInterpretation(p,1),b=evaluateActingInterpretation({...p,controllability:1},1),c=evaluateActingInterpretation({...p,certainty:0},1);
 assert.ok(a.fear>b.fear);assert.equal(c.fear,0);assert.ok(c.uncertainty>0);assert.equal(a.anger,0);
});
test('prediction does not consume a real attempt or teach facts about reliability',()=>{
 const a=appraiseActingOutcome(active(),ev({phase:'prospect',likelihood:.9,reliabilityEvidence:-1}));
 assert.equal(a.intention.attempts,0);assert.equal(a.intention.action,'ask');assert.deepEqual(a.sentiments,[]);
 assert.throws(()=>validateActingOutcome(ev({phase:'prospect',likelihood:1,progress:1,confirmedResolution:true})));
});
test('unable is not unwilling; competence and reliability need separate evidence',()=>{
 const a=appraiseActingOutcome(fresh(),ev({attribution:'unable'})),b=appraiseActingOutcome(fresh(),ev());
 assert.equal(relation(a).benevolence,.5);assert.equal(relation(a).competence,.5);assert.equal(relation(a).reliability,.5);assert.ok(relation(b).benevolence<.5);
 const c=appraiseActingOutcome(fresh(),ev({attribution:'unable',competenceEvidence:1,reliabilityEvidence:-1}));assert.ok(relation(c).competence>.5&&relation(c).reliability<.5);
});
test('uncertain attribution does not condemn the partner',()=>{
 const a=appraiseActingOutcome(fresh(),ev({certainty:0}));assert.equal(relation(a).benevolence,.5);assert.equal(a.affect.uncertainty,1);
});
test('reappraisal corrects anger and relationship without rewriting observation',()=>{
 const a=appraiseActingOutcome(fresh(),ev()),before=clone(a.memories[0]),b=revise(a);
 assert.equal(b.memories[0].attribution,'unwilling');assert.equal(b.memories[0].assessment.interpretation.attribution,'unable');
 assert.equal(b.memories.length,1);assert.equal(b.lastSequence,1);assert.equal(b.memories[0].assessment.revision,1);
 assert.equal(b.emotions.anger,0);assert.equal(relation(b).benevolence,.5);assert.deepEqual(a.memories[0],before);validateActingMind(b);
});
test('reappraisal can correct who was blamed, using the same one source',()=>{
 const a=appraiseActingOutcome(fresh(),ev()),b=revise(a,{interpretation:interp({otherId:'pavel'})});
 assert.equal(relation(b),undefined);assert.ok(relation(b,'pavel').benevolence<.5);assert.equal(b.memories[0].otherId,'ilya');
});
test('reappraisal cannot repeat attempts, award success or reopen a refusal',()=>{
 const a=appraiseActingOutcome(active(),ev()),b=revise(a,{interpretation:interp({progress:1,attribution:'help'})});
 assert.deepEqual(b.intention,a.intention);assert.equal(b.intention.status,'blocked');assert.equal(b.intention.attempts,1);
});
test('repeated and stale revisions are idempotent, gaps are rejected',()=>{
 const a=revise(appraiseActingOutcome(fresh(),ev()));assert.equal(revise(a),a);
 assert.throws(()=>revise(a,{revision:3}));assert.throws(()=>revise(a,{revision:2,atS:1}));
});
test('identical reinterpretation does not refresh a fading cause',()=>{
 const a=appraiseActingOutcome(fresh(),ev());let b=a;
 for(let i=1;i<=20;i++)b=revise(b,{revision:i,atS:i+1,interpretation:interp(),basisId:`evidence${i}`});
 emotionsEqual(actingEmotionsAt(a,21),actingEmotionsAt(b,21));assert.deepEqual(a.sentiments,b.sentiments);
});
test('correction replay matches counterfactual ingestion through saturation',()=>{
 let a=fresh(),expected=fresh();
 for(let i=1;i<=25;i++){const e=ev({id:`e${i}`,sequence:i,atS:i,attribution:i<=15?'help':'unwilling',progress:i<=15?1:-1});
  a=appraiseActingOutcome(a,e);expected=appraiseActingOutcome(expected,i===3?{...e,attribution:'unable'}:e);}
 a=revise(a,{eventId:'e3',atS:25,interpretation:interp({progress:1,attribution:'unable'})});
 assert.deepEqual(a.sentiments,expected.sentiments);emotionsEqual(a.emotions,expected.emotions);
});
test('bounded rolling baseline preserves effects but rejects evicted revisions',()=>{
 let a=fresh();for(let i=1;i<=1000;i++)a=appraiseActingOutcome(a,ev({id:`e${i}`,sequence:i,atS:i,subject:`subject${i}`,otherId:`person${i}`}));
 assert.equal(a.memories.length,ACTING_LIMITS.memories);assert.ok(a.sentiments.length<=24&&a.baseline.sentiments.length<=24);validateActingMind(clone(a));
 assert.throws(()=>revise(a,{eventId:'e1',atS:1001}),/outside/);
 const b=revise(a,{eventId:'e999',atS:1001,interpretation:interp({otherId:'person999',attribution:'unable'})});validateActingMind(b);
});
test('chronological deterministic replay and serialization',()=>{
 const events=Array.from({length:80},(_,i)=>ev({id:`e${i}`,sequence:i+1,atS:i+1,progress:Math.sin(i)}));
 const a=events.reduce(appraiseActingOutcome,fresh()),b=events.reduce(appraiseActingOutcome,fresh());assert.deepEqual(a,b);validateActingMind(clone(a));
 assert.deepEqual(appraiseActingOutcome(clone(a),ev({id:'next',sequence:81,atS:81})),appraiseActingOutcome(a,ev({id:'next',sequence:81,atS:81})));
});
test('replayed observations do not accumulate rewards or restart decay',()=>{
 const a=appraiseActingOutcome(fresh(),ev());assert.equal(appraiseActingOutcome(a,ev()),a);
 const b=appraiseActingOutcome(a,ev({sequence:2,atS:2}));assert.deepEqual(actingAffectAt(b,2),actingAffectAt(a,2));assert.deepEqual(b.affect,a.affect);assert.deepEqual(b.sentiments,a.sentiments);assert.equal(b.memories.length,1);validateActingMind(b);
});
test('migrate v1 without replay, invented causal emotions or lost history',()=>{
 const old=legacy(),m=migrateActingMind(old);assert.equal(m.version,2);near(m.affect.valence,old.affect.valence*Math.exp(-2/12));
 assert.equal(m.emotions.anger,0);assert.equal(m.memories[0].assessment,undefined);assert.deepEqual(m.memories,old.memories);assert.deepEqual(m.sentiments,old.sentiments);
 assert.throws(()=>revise(m,{atS:4}),/outside/);validateActingMind(m);assert.deepEqual(migrateActingMind(m),m);
});
test('migrated baseline survives new events and window eviction',()=>{
 let a=migrateActingMind(legacy());const expected=actingEmotionsAt(a,4);
 for(let i=2;i<80;i++)a=appraiseActingOutcome(a,ev({sequence:i,id:`neutral${i}`,atS:4,progress:0,expectedProgress:0,attribution:'unknown'}));
 emotionsEqual(a.emotions,expected);validateActingMind(a);
});
test('invalid revisions, fabricated cached state, future and malformed data fail validation',()=>{
 const m=appraiseActingOutcome(fresh(),ev());
 for(const mutate of [x=>x.affect.valence=0,x=>x.emotions.fear=NaN,x=>x.baseline.emotions.atS=99,x=>x.memories[0].assessment.importance=2,x=>x.memories[0].assessment.revisedAtS=NaN,x=>x.sentiments[0].confidence=1]){
  const x=clone(m);mutate(x);assert.throws(()=>validateActingMind(x));}
 assert.throws(()=>migrateActingMind({...legacy(),version:9}));assert.throws(()=>validateActingMind(legacy()));
 assert.throws(()=>revise(m,{interpretation:interp({otherId:'anna'})}));assert.throws(()=>revise(m,{interpretation:interp({phase:'prospect',likelihood:.5})}));
});
test('invalid observations and missing intent fields fail before any mutation',()=>{
 const a=fresh(),before=clone(a);for(const e of [ev({atS:NaN}),ev({sequence:0}),ev({progress:2}),ev({confirmedResolution:true}),ev({goalId:'missing'}),ev({phase:'prospect'})])assert.throws(()=>appraiseActingOutcome(a,e));
 assert.throws(()=>beginActingIntention(a,{goalId:'understand',subject:'pump',partnerId:'ilya'},0));assert.deepEqual(a,before);
});
test('uncertainty changes the preferred feasible action toward clarification',()=>{
 const options=[{id:'explain',action:'explain',available:true,expectedProgress:.4,effort:0,risk:0,informationGain:0},{id:'clarify',action:'clarify',available:true,expectedProgress:0,effort:.1,risk:0,informationGain:1}];
 const a=active(),b=appraiseActingOutcome(a,ev({certainty:0,attribution:'unknown',otherId:'pavel'}));
 assert.equal(chooseActingAction(a,options,1).action,'explain');assert.equal(chooseActingAction(b,options,1).action,'clarify');
 const c=chooseActingAction(b,options,1);near(c.score,c.progress+c.information-c.cost);
});
test('threat changes risk preference without a hidden partner state',()=>{
 const options=[{id:'risk',action:'ask',available:true,expectedProgress:.9,effort:0,risk:1,informationGain:0},{id:'safe',action:'clarify',available:true,expectedProgress:.3,effort:0,risk:0,informationGain:0}];
 const a=active(),b=appraiseActingOutcome(a,ev({phase:'prospect',progress:-1,likelihood:1,controllability:0}));
 assert.equal(chooseActingAction(a,options,1).id,'risk');assert.equal(chooseActingAction(b,options,1).id,'safe');
});
test('unavailable actions, exhausted intentions, unknown actions and duplicates are not bypassed',()=>{
 const o={id:'x',action:'ask',available:false,expectedProgress:1,effort:0,risk:0,informationGain:1},a=active();
 assert.equal(chooseActingAction(a,[o],0),null);assert.equal(chooseActingAction(cancelActingIntention(a,0),[{...o,available:true}],0),null);
 assert.throws(()=>chooseActingAction(a,[o,o],0));assert.throws(()=>chooseActingAction(a,[{...o,action:'teleport'}],0));assert.throws(()=>chooseActingAction(a,Array(33).fill(o),0));
});
test('partner expectations remain private and stable tie breaking is order independent',()=>{
 const a=appraiseActingOutcome(fresh(),ev({attribution:'help',progress:1,competenceEvidence:1}));
 assert.equal(chooseActingPartner(a,[{id:'pavel',available:true,distanceM:1},{id:'ilya',available:true,distanceM:1}]),'ilya');
 assert.equal(chooseActingPartner(fresh(),[{id:'z',available:true,distanceM:1},{id:'a',available:true,distanceM:1}]),'a');
});
test('continued request only resolves after actual confirmation; retries stay bounded',()=>{
 let a=active();for(let i=1;i<=10;i++)a=appraiseActingOutcome(a,ev({id:`e${i}`,sequence:i,atS:i,attribution:'unable'}));assert.equal(a.intention.attempts,3);assert.equal(a.intention.status,'blocked');
 const b=appraiseActingOutcome(active(),ev({progress:1,attribution:'help',confirmedResolution:true}));assert.equal(b.intention.status,'succeeded');assert.equal(b.intention.action,'acknowledge');validateActingMind(b);
});
test('same-time neutral events do not create appraisal uncertainty from nothing',()=>{
 const a=appraiseActingOutcome(fresh(),ev({progress:0,expectedProgress:0,certainty:0,attribution:'unknown'}));
 for(const [k,v] of Object.entries(a.emotions))if(k!=='atS')assert.equal(v,0);
});

import {makeActingCue,sampleActingPerformance,validateActingCue} from '../dist/acting/performance.js';
test('mixed affect does not project to a completely neutral face',()=>{
 let a=appraiseActingOutcome(fresh(),ev({progress:1,expectedProgress:0,attribution:'help'}));
 a=appraiseActingOutcome(a,ev({sequence:2,id:'loss',progress:-1,expectedProgress:0}));
 const cue=makeActingCue(a,1,'listen',1);near(a.affect.valence,0);assert.ok(cue.smile>0&&cue.browTilt>0);validateActingCue(cue);
});
test('distinct threat and anger affect presentation without altering the wire shape',()=>{
 const fear=appraiseActingOutcome(fresh(),ev({phase:'prospect',progress:-1,likelihood:1,controllability:0}));
 const anger=appraiseActingOutcome(fresh(),ev({progress:-1}));
 const a=makeActingCue(fear,1,'listen',1),b=makeActingCue(anger,1,'listen',1);assert.ok(a.browLift>b.browLift);assert.ok(b.browTilt>a.browTilt);
 assert.deepEqual(Object.keys(a).sort(),['version','serial','action','startS','durationS','intensity','smile','browLift','browTilt','squint'].sort());
 assert.equal(sampleActingPerformance(a,5).weight,0);
});
test('irrelevant neutral observations cannot evict established relationships',()=>{
 let a=appraiseActingOutcome(fresh(),ev({attribution:'help',progress:1}));const learned=clone(a.sentiments);
 for(let i=2;i<100;i++)a=appraiseActingOutcome(a,ev({id:`noise${i}`,sequence:i,atS:2,subject:`object${i}`,otherId:`stranger${i}`,progress:0,expectedProgress:0,attribution:'unknown'}));
 assert.deepEqual(a.sentiments,learned);validateActingMind(a);
});
