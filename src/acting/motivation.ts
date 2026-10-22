/** Bounded subjective appraisal. Seconds are simulation time, not wall-clock time.
 * Numeric weights are authored behavior parameters, not psychological measurements.
 * Authority commits observations/minds; neither animation nor prose creates facts. */
export const ACTING_LIMITS=Object.freeze({goals:8,sentiments:24,memories:32,attempts:3,candidates:32});
export const ACTING_ACTIONS=['listen','ask','explain','decline','acknowledge','clarify','withdraw'] as const;
export type ActingAction=typeof ACTING_ACTIONS[number];
export interface ActingGoal {readonly id:string;readonly importance:number}
export interface ActingSentiment {
 readonly subject:string;readonly affinity:number;readonly benevolence:number;
 readonly reliability:number;readonly competence:number;readonly confidence:number;readonly atS:number;
}
export interface ActingAffect {readonly valence:number;readonly arousal:number;readonly uncertainty:number;readonly atS:number}
/** Coexisting activations; valence is only their lossy presentation projection. */
export interface ActingEmotions {
 readonly positive:number;readonly negative:number;readonly arousal:number;readonly uncertainty:number;
 readonly fear:number;readonly anger:number;readonly gratitude:number;readonly atS:number;
}
export interface ActingIntention {
 readonly id:string;readonly goalId:string;readonly subject:string;readonly partnerId:string;
 readonly action:ActingAction;readonly attempts:number;readonly status:'active'|'succeeded'|'blocked';
}
/** All fields are the observer's estimates. Likelihood of a future outcome is
 * distinct from certainty about evidence. Omitting phase means an actual outcome. */
export interface ActingInterpretation {
 readonly progress:number;readonly expectedProgress:number;readonly certainty:number;
 readonly attribution:'help'|'unable'|'unwilling'|'unknown';readonly otherId?:string;
 readonly reliabilityEvidence?:number;readonly competenceEvidence?:number;
 readonly phase?:'outcome'|'prospect';readonly likelihood?:number;readonly controllability?:number;
}
export interface ActingOutcome extends ActingInterpretation {
 readonly sequence:number;readonly id:string;readonly goalId:string;readonly subject:string;readonly atS:number;
 readonly confirmedResolution?:boolean;
}
export interface ActingAssessment {
 readonly revision:number;readonly basisId:string;readonly revisedAtS:number;
 readonly importance:number;readonly interpretation:ActingInterpretation;
}
/** Original perceived outcome is immutable; only assessment may be revised.
 * Missing assessment marks migrated history already included in the baseline. */
export interface ActingMemory extends ActingOutcome {readonly assessment?:ActingAssessment}
export interface ActingBaseline {readonly emotions:ActingEmotions;readonly sentiments:readonly ActingSentiment[]}
export interface ActingMind {
 readonly version:2;readonly actorId:string;readonly goals:readonly ActingGoal[];
 /** Baseline + bounded memories are the only sources. These three fields are
  * checked derived publications, not independently writable emotion stores. */
 readonly sentiments:readonly ActingSentiment[];readonly emotions:ActingEmotions;readonly affect:ActingAffect;
 readonly baseline:ActingBaseline;readonly memories:readonly ActingMemory[];
 readonly intention:ActingIntention|null;readonly lastSequence:number;readonly atS:number;
}
export interface LegacyActingMind extends Omit<ActingMind,'version'|'baseline'|'emotions'|'memories'> {
 readonly version:1;readonly memories:readonly ActingOutcome[];
}
export const clampActing=(n:number,min=0,max=1):number=>Math.max(min,Math.min(max,n));
export function actingTime(n:number):void {if(!Number.isFinite(n)||n<0)throw new RangeError('Invalid acting time');}
function id(s:string):void {if(typeof s!=='string'||!s||s.length>160)throw new TypeError('Invalid acting ID');}
function range(n:number,min=0,max=1):void {if(!Number.isFinite(n)||n<min||n>max)throw new RangeError('Acting value out of range');}
function sequence(n:number):void {if(!Number.isSafeInteger(n)||n<1)throw new RangeError('Invalid sequence');}
const channels=['positive','negative','arousal','uncertainty','fear','anger','gratitude'] as const;
const compare=(a:string,b:string):number=>a<b?-1:a>b?1:0;
const neutral=(atS:number):ActingEmotions=>({positive:0,negative:0,arousal:0,uncertainty:0,fear:0,anger:0,gratitude:0,atS});
function interpretation(e:ActingInterpretation):ActingInterpretation {
 return {progress:e.progress,expectedProgress:e.expectedProgress,certainty:e.certainty,attribution:e.attribution,
  ...(e.otherId!==undefined?{otherId:e.otherId}:{}),...(e.reliabilityEvidence!==undefined?{reliabilityEvidence:e.reliabilityEvidence}:{}),
  ...(e.competenceEvidence!==undefined?{competenceEvidence:e.competenceEvidence}:{}),...(e.phase!==undefined?{phase:e.phase}:{}),
  ...(e.likelihood!==undefined?{likelihood:e.likelihood}:{}),...(e.controllability!==undefined?{controllability:e.controllability}:{})};
}
function validateInterpretation(e:ActingInterpretation):void {
 range(e.progress,-1);range(e.expectedProgress,-1);range(e.certainty);
 if(!['help','unable','unwilling','unknown'].includes(e.attribution))throw new TypeError('Invalid attribution');
 if(e.otherId!==undefined)id(e.otherId);
 if(e.phase!==undefined&&!['outcome','prospect'].includes(e.phase))throw new TypeError('Invalid appraisal phase');
 for(const v of [e.likelihood,e.controllability])if(v!==undefined)range(v);
 for(const v of [e.reliabilityEvidence,e.competenceEvidence])if(v!==undefined)range(v,-1);
 if(e.phase==='prospect'&&e.likelihood===undefined)throw new TypeError('Prospect requires a likelihood');
 if(e.phase!=='prospect'&&e.likelihood!==undefined&&e.likelihood!==1)throw new TypeError('Actual outcome has likelihood one');
}
export function validateActingOutcome(e:ActingOutcome):void {
 id(e.id);id(e.goalId);id(e.subject);actingTime(e.atS);sequence(e.sequence);validateInterpretation(e);
 if(e.confirmedResolution!==undefined&&typeof e.confirmedResolution!=='boolean')throw new TypeError('Invalid resolution');
 if(e.confirmedResolution&&(e.progress!==1||e.phase==='prospect'))throw new TypeError('Resolution requires confirmed actual full progress');
}
function fade(e:ActingEmotions,atS:number):ActingEmotions {
 actingTime(atS);if(atS<e.atS)throw new RangeError('Emotion clock moved backwards');
 const k=Math.exp(-(atS-e.atS)/12);
 return {positive:e.positive*k,negative:e.negative*k,arousal:e.arousal*k,uncertainty:e.uncertainty*k,
  fear:e.fear*k,anger:e.anger*k,gratitude:e.gratitude*k,atS};
}
const projection=(e:ActingEmotions):ActingAffect=>({valence:e.positive-e.negative,arousal:e.arousal,uncertainty:e.uncertainty,atS:e.atS});
/** Explainable, game-authored appraisal, not an implementation of the full EMA/OCC taxonomy. */
export function evaluateActingInterpretation(e:ActingInterpretation,importance:number):Omit<ActingEmotions,'atS'> {
 validateInterpretation(e);range(importance);
 const chance=e.phase==='prospect'?e.likelihood!:1,impact=e.progress*chance,expected=e.expectedProgress;
 const surprise=Math.abs(impact-expected)/2,relevance=Math.max(Math.abs(impact),surprise);
 const value=importance*e.certainty*(.65*impact+.35*(impact-expected)/2),control=e.controllability??.5;
 return {positive:Math.max(0,value),negative:Math.max(0,-value),
  arousal:importance*(Math.abs(impact)*.45+surprise*.55),uncertainty:relevance>0?importance*(1-e.certainty):0,
  fear:e.phase==='prospect'?importance*e.certainty*Math.max(0,-impact)*(1-control):0,
  anger:e.phase!=='prospect'&&e.otherId&&e.attribution==='unwilling'?importance*e.certainty*Math.max(0,-impact)*(.5+.5*control):0,
  gratitude:e.phase!=='prospect'&&e.otherId&&e.attribution==='help'?importance*e.certainty*Math.max(0,impact):0};
}
function learn(prior:readonly ActingSentiment[],m:ActingMemory):readonly ActingSentiment[] {
 const a=m.assessment;if(!a||a.interpretation.phase==='prospect')return prior;
 const e=a.interpretation,learning=.06*a.importance*e.certainty;
 if(e.progress===0&&e.expectedProgress===0&&e.attribution==='unknown'&&!e.reliabilityEvidence&&!e.competenceEvidence)return prior;
 let out=[...prior];
 const update=(subject:string,personal:boolean)=>{
  const old=out.find(s=>s.subject===subject)??{subject,affinity:0,benevolence:.5,reliability:.5,competence:.5,confidence:0,atS:m.atS};
  const social=e.attribution==='help'?1:e.attribution==='unwilling'?-1:0;
  const informative=personal?social!==0||!!e.reliabilityEvidence||!!e.competenceEvidence:e.progress!==0;
  const next={...old,atS:m.atS,affinity:clampActing(old.affinity+learning*(personal?social*.35:e.progress),-1,1),
   benevolence:clampActing(old.benevolence+(personal?learning*social:0)),
   reliability:clampActing(old.reliability+(personal?learning*(e.reliabilityEvidence??0):0)),
   competence:clampActing(old.competence+(personal?learning*(e.competenceEvidence??0):0)),confidence:clampActing(old.confidence+(informative?learning:0))};
  out=out.filter(s=>s.subject!==subject);out.push(next);
 };
 if(m.subject!==e.otherId)update(m.subject,false);if(e.otherId)update(e.otherId,true);
 return out.sort((a,b)=>b.atS-a.atS||compare(a.subject,b.subject)).slice(0,ACTING_LIMITS.sentiments);
}
function fold(base:ActingBaseline,m:ActingMemory):ActingBaseline {
 if(!m.assessment)return base;
 const old=fade(base.emotions,m.atS),v=evaluateActingInterpretation(m.assessment.interpretation,m.assessment.importance);
 return {emotions:{positive:clampActing(old.positive+v.positive),negative:clampActing(old.negative+v.negative),
  arousal:clampActing(old.arousal+v.arousal),uncertainty:clampActing(old.uncertainty+v.uncertainty),
  fear:clampActing(old.fear+v.fear),anger:clampActing(old.anger+v.anger),gratitude:clampActing(old.gratitude+v.gratitude),atS:m.atS},sentiments:learn(base.sentiments,m)};
}
function derive(mind:ActingMind,atS:number):ActingBaseline {
 let out=mind.baseline;
 // Chronological replay matters for saturated learning. At most 32 episodes.
 for(let i=mind.memories.length-1;i>=0;i--)out=fold(out,mind.memories[i]!);
 return {...out,emotions:fade(out.emotions,atS)};
}
function publish(mind:ActingMind,atS:number):ActingMind {
 const d=derive(mind,atS);return {...mind,atS,emotions:d.emotions,affect:projection(d.emotions),sentiments:d.sentiments};
}
export function createActingMind(actorId:string,goals:readonly ActingGoal[],atS=0):ActingMind {
 id(actorId);actingTime(atS);if(!Array.isArray(goals)||!goals.length||goals.length>ACTING_LIMITS.goals)throw new RangeError('Invalid goal budget');
 const ids=new Set<string>();for(const g of goals){id(g.id);range(g.importance);if(ids.has(g.id))throw new TypeError('Duplicate goal');ids.add(g.id);}
 const emotions=neutral(atS);
 return {version:2,actorId,goals:goals.map(g=>({...g})),sentiments:[],emotions,affect:projection(emotions),baseline:{emotions,sentiments:[]},memories:[],intention:null,lastSequence:0,atS};
}
export function actingEmotionsAt(mind:ActingMind,atS:number):ActingEmotions {
 actingTime(atS);if(mind.version!==2||atS<mind.atS)throw new RangeError('Migrate mind or advance acting clock');return fade(mind.emotions,atS);
}
export function actingAffectAt(mind:ActingMind,atS:number):ActingAffect{return projection(actingEmotionsAt(mind,atS));}
export function beginActingIntention(mind:ActingMind,input:Pick<ActingIntention,'id'|'goalId'|'subject'|'partnerId'>,atS:number):ActingMind {
 actingAffectAt(mind,atS);for(const k of ['id','goalId','subject','partnerId'] as const)id(input[k]);
 if(input.partnerId===mind.actorId||!mind.goals.some(g=>g.id===input.goalId))throw new TypeError('Invalid intention partner or goal');
 if(mind.intention?.status==='active')throw new Error('Resolve or cancel the active intention first');
 return publish({...mind,intention:{...input,action:'ask',attempts:0,status:'active'}},atS);
}
export function cancelActingIntention(mind:ActingMind,atS:number):ActingMind {
 actingAffectAt(mind,atS);return publish({...mind,intention:mind.intention?{...mind.intention,status:'blocked',action:'withdraw'}:null},atS);
}
/** Idempotent observation. Baseline absorbs the evicted episode, so filling memory
 * with neutral events cannot erase emotion or unlearn durable relationships. */
export function appraiseActingOutcome(mind:ActingMind,event:ActingOutcome):ActingMind {
 validateActingOutcome(event);if(mind.version!==2)throw new TypeError('Migrate acting mind before use');
 if(event.sequence<=mind.lastSequence)return mind;actingAffectAt(mind,event.atS);
 const goal=mind.goals.find(g=>g.id===event.goalId);if(!goal)throw new TypeError('Unknown outcome goal');
 if(event.otherId===mind.actorId)throw new TypeError('Other actor cannot be self');
 if(mind.memories.some(e=>e.id===event.id))return {...mind,lastSequence:event.sequence,atS:event.atS};
 const memory:ActingMemory={...structuredClone(event),assessment:{revision:0,basisId:event.id,revisedAtS:event.atS,importance:goal.importance,interpretation:interpretation(event)}};
 const memories=[memory,...mind.memories];let baseline=mind.baseline;
 if(memories.length>ACTING_LIMITS.memories)baseline=fold(baseline,memories.pop()!);
 let intention=mind.intention;
 // Prediction is neither a response, a failed attempt, nor a confirmed outcome.
 if(event.phase!=='prospect'&&intention?.status==='active'&&intention.goalId===event.goalId&&intention.subject===event.subject&&event.otherId===intention.partnerId){
  const attempts=intention.attempts+1,done=event.confirmedResolution===true,stop=!done&&(event.attribution==='unwilling'||attempts>=ACTING_LIMITS.attempts);
  intention={...intention,attempts,status:done?'succeeded':stop?'blocked':'active',action:done?'acknowledge':stop?'withdraw':'clarify'};
 }
 return publish({...mind,baseline,memories,intention,lastSequence:event.sequence},event.atS);
}
export interface ActingReappraisal {
 readonly eventId:string;readonly revision:number;readonly basisId:string;readonly atS:number;
 readonly interpretation:ActingInterpretation;
}
/** Reinterpret ONE retained cause, never add another occurrence or award another
 * success. The original time anchors decay; revisiting does not refresh intensity.
 * This bounded revision window is explicit, not an all-history memory claim. */
export function reappraiseActingOutcome(mind:ActingMind,change:ActingReappraisal):ActingMind {
 id(change.eventId);id(change.basisId);sequence(change.revision);actingTime(change.atS);validateInterpretation(change.interpretation);
 if(mind.version!==2)throw new TypeError('Migrate acting mind before use');
 const old=mind.memories.find(m=>m.id===change.eventId);if(!old?.assessment)throw new RangeError('Cause outside reappraisal window');
 const a=old.assessment;if(change.revision<=a.revision)return mind;
 actingAffectAt(mind,change.atS);
 if(change.revision!==a.revision+1)throw new RangeError('Reappraisal revision gap');
 if(change.interpretation.otherId===mind.actorId)throw new TypeError('Other actor cannot be self');
 if((change.interpretation.phase??'outcome')!==(a.interpretation.phase??'outcome'))throw new TypeError('A prediction becoming fact requires a new observation');
 const next={...old,assessment:{...a,revision:change.revision,basisId:change.basisId,revisedAtS:change.atS,interpretation:interpretation(change.interpretation)}};
 return publish({...mind,memories:mind.memories.map(m=>m.id===old.id?next:m)},change.atS);
}
export interface ActingOption {
 readonly id:string;readonly action:ActingAction;readonly available:boolean;
 readonly expectedProgress:number;readonly effort:number;readonly risk:number;readonly informationGain:number;
}
export interface ActingChoice {readonly id:string;readonly action:ActingAction;readonly score:number;readonly progress:number;readonly information:number;readonly cost:number}
/** Bounded, explainable policy over authority-provided feasible options. No hidden
 * partner state, invented affordance, automatic world action, or learned policy. */
export function chooseActingAction(mind:ActingMind,options:readonly ActingOption[],atS:number):ActingChoice|null {
 const e=actingEmotionsAt(mind,atS);if(options.length>ACTING_LIMITS.candidates)throw new RangeError('Action budget exceeded');
 const seen=new Set<string>();let best:ActingChoice|null=null;
 const importance=mind.goals.find(g=>g.id===mind.intention?.goalId)?.importance??0;
 for(const o of options){id(o.id);if(seen.has(o.id)||typeof o.available!=='boolean'||!ACTING_ACTIONS.includes(o.action))throw new TypeError('Invalid action option');seen.add(o.id);
  range(o.expectedProgress,-1);for(const n of [o.effort,o.risk,o.informationGain])range(n);
  if(!o.available||mind.intention?.status!=='active')continue;
  const progress=importance*o.expectedProgress,information=importance*e.uncertainty*o.informationGain,cost=o.effort+o.risk*(.25+.75*e.fear);
  const choice={id:o.id,action:o.action,score:progress+information-cost,progress,information,cost};
  if(!best||choice.score>best.score||choice.score===best.score&&o.id<best.id)best=choice;
 }return best;
}
export function chooseActingPartner(mind:ActingMind,candidates:readonly {readonly id:string;readonly available:boolean;readonly distanceM:number}[]):string|null {
 if(candidates.length>ACTING_LIMITS.candidates)throw new RangeError('Acting candidate budget exceeded');
 const seen=new Set<string>();let best:string|null=null,score=-Infinity;
 for(const c of candidates){id(c.id);range(c.distanceM,0,1e6);if(typeof c.available!=='boolean'||seen.has(c.id))throw new TypeError('Invalid or duplicate candidate');seen.add(c.id);
  if(!c.available||c.id===mind.actorId)continue;const s=mind.sentiments.find(s=>s.subject===c.id);
  const value=(s?.benevolence??.5)*.35+(s?.reliability??.5)*.25+(s?.competence??.5)*.3+(s?.affinity??0)*.1-c.distanceM*.01;
  if(value>score||value===score&&(best===null||c.id<best)){best=c.id;score=value;}
 }return best;
}
function validateSentiments(values:readonly ActingSentiment[],atS:number):void {
 if(!Array.isArray(values)||values.length>ACTING_LIMITS.sentiments)throw new RangeError('Invalid sentiment budget');
 const seen=new Set<string>();for(const s of values){id(s.subject);actingTime(s.atS);if(s.atS>atS||seen.has(s.subject))throw new TypeError('Invalid sentiment');seen.add(s.subject);
  range(s.affinity,-1);for(const n of [s.benevolence,s.reliability,s.competence,s.confidence])range(n);}
}
function validateCommon(m:LegacyActingMind|ActingMind):void {
 createActingMind(m.actorId,m.goals,m.atS);if(!Number.isSafeInteger(m.lastSequence)||m.lastSequence<0)throw new RangeError('Invalid saved sequence');
 validateSentiments(m.sentiments,m.atS);actingTime(m.affect.atS);if(m.affect.atS>m.atS)throw new RangeError('Future affect');
 range(m.affect.valence,-1);range(m.affect.arousal);range(m.affect.uncertainty);
 if(!Array.isArray(m.memories)||m.memories.length>ACTING_LIMITS.memories)throw new RangeError('Invalid memory budget');
 const ids=new Set<string>();let previous=Infinity,lastTime=Infinity;
 for(const e of m.memories){validateActingOutcome(e);if(ids.has(e.id)||e.sequence>=previous||e.sequence>m.lastSequence||e.atS>lastTime||e.atS>m.atS||e.otherId===m.actorId||!m.goals.some(g=>g.id===e.goalId))throw new TypeError('Invalid saved memory order/reference');ids.add(e.id);previous=e.sequence;lastTime=e.atS;}
 if(m.intention){const i=m.intention;for(const s of [i.id,i.subject,i.partnerId,i.goalId])id(s);
  if(i.partnerId===m.actorId||!m.goals.some(g=>g.id===i.goalId)||!ACTING_ACTIONS.includes(i.action)||!['active','succeeded','blocked'].includes(i.status)||!Number.isInteger(i.attempts)||i.attempts<0||i.attempts>ACTING_LIMITS.attempts)throw new TypeError('Invalid saved intention');}
}
/** Reject tampered projections; only baseline and causal window define state. */
export function validateActingMind(m:ActingMind):void {
 if(!m||m.version!==2)throw new TypeError('Unsupported acting mind; use migrateActingMind for v1');validateCommon(m);
 for(const e of [m.baseline.emotions,m.emotions]){actingTime(e.atS);if(e.atS>m.atS)throw new RangeError('Future emotional baseline');for(const k of channels)range(e[k]);}
 validateSentiments(m.baseline.sentiments,m.baseline.emotions.atS);
 for(const memory of m.memories){const a=memory.assessment;if(!a)continue;
  if(memory.atS<m.baseline.emotions.atS||!Number.isSafeInteger(a.revision)||a.revision<0||a.revisedAtS<memory.atS||a.revisedAtS>m.atS)throw new RangeError('Invalid assessment revision/time');
  actingTime(a.revisedAtS);range(a.importance);id(a.basisId);validateInterpretation(a.interpretation);if(a.interpretation.otherId===m.actorId)throw new TypeError('Self attribution');
  if((a.interpretation.phase??'outcome')!==(memory.phase??'outcome'))throw new TypeError('Observation phase changed');
 }
 const d=derive(m,m.atS),cached=fade(m.emotions,m.atS),a=projection(m.emotions);
 for(const k of channels)if(Math.abs(cached[k]-d.emotions[k])>1e-12)throw new TypeError('Emotional projection differs from causes');
 if(m.affect.atS!==m.emotions.atS||['valence','arousal','uncertainty'].some(k=>Math.abs(m.affect[k as keyof Omit<ActingAffect,'atS'>]-a[k as keyof Omit<ActingAffect,'atS'>])>1e-12)||JSON.stringify(m.sentiments)!==JSON.stringify(d.sentiments))throw new TypeError('Published appraisal differs from causes');
}
/** Preserve v1 knowledge, intentions and aggregate affect without replaying old
 * experiences or inventing lost causal contributions. Old history is not revisable. */
export function migrateActingMind(value:LegacyActingMind|ActingMind):ActingMind {
 if(value?.version===2){validateActingMind(value);return structuredClone(value);}
 if(!value||value.version!==1)throw new TypeError('Unsupported acting mind');validateCommon(value);
 const old=structuredClone(value),k=Math.exp(-(old.atS-old.affect.atS)/12);
 const emotions={...neutral(old.atS),positive:Math.max(0,old.affect.valence)*k,negative:Math.max(0,-old.affect.valence)*k,arousal:old.affect.arousal*k,uncertainty:old.affect.uncertainty*k};
 const result:ActingMind={...old,version:2,emotions,affect:projection(emotions),baseline:{emotions,sentiments:old.sentiments},memories:old.memories.map(e=>{const {assessment:ignored,...source}=e as ActingMemory;return source;})};
 validateActingMind(result);return result;
}
