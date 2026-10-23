import {finiteVec3,type Vec3} from '../math.js';
import {
 ACTING_ACTIONS,advanceActingMind,actingTime,appraiseActingOutcome,beginActingIntention,
 cancelActingIntention,clampActing,createActingMind,migrateActingMind,validateActingMind,
 type ActingAction,type ActingMind,type ActingOutcome,type LegacyActingMind,
} from './motivation.js';
import {makeActingCue,type ActingCue} from './performance.js';

/** A simulated inner life: needs, attention, remembered evidence and deliberation.
 * Only perceived affordances enter this reducer. It cannot inspect other minds,
 * move a body, manufacture an outcome, or establish subjective consciousness. */
export const NPC_NEEDS=['energy','company','understanding','safety'] as const;
export type NpcNeed=typeof NPC_NEEDS[number];
export const NPC_MIND_LIMITS=Object.freeze({thoughts:32,affordances:32,decisionS:10,retryS:10,cueS:2.4});
export interface NpcNeedState {
 readonly id:NpcNeed;readonly urgency:number;readonly growthPerS:number;readonly importance:number;
}
export interface NpcAffordance {
 readonly id:string;readonly need:NpcNeed;readonly subject:string;readonly partnerId?:string;
 readonly available:boolean;readonly distanceM:number;readonly expectedRelief:number;readonly confidence:number;
 readonly position?:Vec3;
}
export interface NpcDecision {
 readonly serial:number;readonly affordanceId:string;readonly need:NpcNeed;readonly subject:string;
 readonly partnerId?:string;readonly startedAtS:number;readonly expiresAtS:number;
 readonly score:number;readonly status:'active'|'succeeded'|'blocked';
}
export interface NpcThought {
 readonly atS:number;readonly kind:'intend'|'wait'|'succeeded'|'blocked'|'timeout'|'interrupted';
 readonly need:NpcNeed|null;readonly subject:string|null;readonly affordanceId:string|null;
 readonly confidence:number;
}
export interface NpcMind {
 readonly version:1;readonly acting:ActingMind;readonly needs:readonly NpcNeedState[];
 readonly decision:NpcDecision|null;readonly thoughts:readonly NpcThought[];
 readonly attention:{readonly subject:string;readonly confidence:number;readonly position?:Vec3}|null;
 readonly decisionSerial:number;readonly cueSerial:number;readonly lastCueS:number|null;
 readonly pendingAction:ActingAction|null;
}
/** Existing NPC snapshots keep their outer schema; only their acting state migrates. */
export interface LegacyNpcMind extends Omit<NpcMind,'acting'> {readonly acting:LegacyActingMind}
export interface NpcMindStep {
 readonly mind:NpcMind;readonly cue:ActingCue|null;
 /** A request for the simulation owner to execute; never an accomplished fact. */
 readonly request:NpcDecision|null;
}
const defaults:Readonly<Record<NpcNeed,number>>={energy:.0008,company:.0005,understanding:.0003,safety:0};
function unit(n:number):void {if(!Number.isFinite(n)||n<0||n>1)throw new RangeError('Invalid NPC mind value');}
function id(s:string):void {if(typeof s!=='string'||!s||s.length>160)throw new TypeError('Invalid NPC mind ID');}
function need(s:string):asserts s is NpcNeed {if(!(NPC_NEEDS as readonly string[]).includes(s))throw new TypeError('Unknown NPC need');}
function serial(n:number):void {if(!Number.isSafeInteger(n)||n<0)throw new RangeError('Invalid NPC serial');}
function remember(m:NpcMind,thought:NpcThought):NpcMind {
 return {...m,thoughts:[thought,...m.thoughts].slice(0,NPC_MIND_LIMITS.thoughts)};
}
function thought(d:NpcDecision,kind:NpcThought['kind'],atS:number,confidence:number):NpcThought {
 return {atS,kind,need:d.need,subject:d.subject,affordanceId:d.affordanceId,confidence};
}
export function createNpcMind(actorId:string,needs:readonly NpcNeedState[]=NPC_NEEDS.map(id=>({id,urgency:.2,growthPerS:defaults[id],importance:1})),atS=0):NpcMind {
 const acting=createActingMind(actorId,needs.map(n=>({id:n.id,importance:n.importance})),atS);
 const m:NpcMind={version:1,acting,needs:needs.map(n=>({...n})),decision:null,thoughts:[],attention:null,
  decisionSerial:0,cueSerial:0,lastCueS:null,pendingAction:null};
 validateNpcMind(m);return m;
}
/** Set an observed bodily or environmental need at simulation time. */
export function setNpcNeed(m:NpcMind,key:NpcNeed,urgency:number,atS:number):NpcMind {
 validateNpcMind(m);need(key);unit(urgency);
 const next=advance(m,atS);
 return {...next,needs:next.needs.map(n=>n.id===key?{...n,urgency}:n)};
}
function advance(m:NpcMind,atS:number):NpcMind {
 const acting=advanceActingMind(m.acting,atS),dt=atS-m.acting.atS;
 return {...m,acting,needs:m.needs.map(n=>({...n,urgency:clampActing(n.urgency+n.growthPerS*dt)}))};
}
/** An authority receipt updates emotion and memory. Replays cannot satisfy a need twice. */
export function perceiveNpcOutcome(m:NpcMind,event:ActingOutcome):NpcMind {
 validateNpcMind(m);
 const acting=appraiseActingOutcome(m.acting,event);
 if(acting===m.acting)return m;
 if(m.acting.memories.some(e=>e.id===event.id))return {...advance(m,event.atS),acting};
 let next=advance(m,event.atS);
 // Predicted help/refusal changes appraisal, not an actual need or action receipt.
 if(event.phase==='prospect')return {...next,acting};
 next={...next,acting,needs:next.needs.map(n=>n.id===event.goalId?{
  ...n,urgency:clampActing(n.urgency-event.progress*event.certainty*.65),
 }:n)};
 const d=m.decision;
 if(!d||d.status!=='active'||d.need!==event.goalId||d.subject!==event.subject||d.partnerId!==event.otherId)return next;
 const done=event.confirmedResolution===true,blocked=event.attribution==='unwilling'||acting.intention?.status==='blocked';
 if(!done&&!blocked)return {...next,pendingAction:'clarify'};
 const status=done?'succeeded':'blocked';
 return remember({...next,decision:{...d,status},pendingAction:done?'celebrate':'withdraw'},thought(d,status,event.atS,event.certainty));
}
function validateAffordances(items:readonly NpcAffordance[],actorId:string):void {
 if(items.length>NPC_MIND_LIMITS.affordances)throw new RangeError('NPC affordance budget exceeded');
 const ids=new Set<string>();
 for(const a of items){
  id(a.id);id(a.subject);need(a.need);unit(a.expectedRelief);unit(a.confidence);
  if(a.partnerId!==undefined){id(a.partnerId);if(a.partnerId===actorId)throw new TypeError('NPC cannot address itself');}
  if(typeof a.available!=='boolean'||!Number.isFinite(a.distanceM)||a.distanceM<0||a.distanceM>1e6||ids.has(a.id))throw new TypeError('Invalid NPC affordance');
  if(a.position!==undefined)finiteVec3(a.position,'NPC attention');ids.add(a.id);
 }
}
const gesture:Readonly<Record<NpcNeed,ActingAction>>={energy:'tired',company:'greet',understanding:'think',safety:'startle'};
/** Call on the authority's simulation clock, then submit cue to ActingRig before
 * AnimationSystem.step. Requests must be executed and acknowledged separately. */
export function stepNpcMind(m:NpcMind,atS:number,affordances:readonly NpcAffordance[]):NpcMindStep {
 validateNpcMind(m);validateAffordances(affordances,m.acting.actorId);
 let next=advance(m,atS),request:NpcDecision|null=null;
 const safety=next.needs.find(n=>n.id==='safety')!;
 const danger=safety.urgency>=.85&&affordances.some(a=>a.need==='safety'&&a.available&&a.confidence>0&&a.expectedRelief>0);
 const active=next.decision?.status==='active'?next.decision:null;
 if(active&&(atS>=active.expiresAtS||danger&&active.need!=='safety')){
  const kind=atS>=active.expiresAtS?'timeout':'interrupted';
  next=remember({...next,decision:{...active,status:'blocked'},acting:cancelActingIntention(next.acting,atS),pendingAction:'withdraw'},thought(active,kind,atS,0));
 }
 if(next.decision?.status!=='active'){
  let best:NpcAffordance|undefined,bestScore=.12;
  for(const a of affordances){
   if(!a.available||danger&&a.need!=='safety')continue;
   if(next.thoughts.some(t=>t.affordanceId===a.id&&(t.kind==='blocked'||t.kind==='timeout'||t.kind==='succeeded')&&atS-t.atS<NPC_MIND_LIMITS.retryS))continue;
   const n=next.needs.find(n=>n.id===a.need)!,relation=next.acting.sentiments.find(s=>s.subject===a.partnerId);
   const trust=a.partnerId?.length?(.7+(relation?.benevolence??.5)*.15+(relation?.reliability??.5)*.15):1;
   const score=n.urgency*n.importance*a.expectedRelief*a.confidence*trust/(1+a.distanceM*.04);
   if(score>bestScore||score===bestScore&&best!==undefined&&a.id<best.id){best=a;bestScore=score;}
  }
  if(best){
   const d:NpcDecision={serial:next.decisionSerial+1,affordanceId:best.id,need:best.need,subject:best.subject,
    ...(best.partnerId?{partnerId:best.partnerId}:{}),startedAtS:atS,expiresAtS:atS+NPC_MIND_LIMITS.decisionS,score:bestScore,status:'active'};
   serial(d.serial);actingTime(d.expiresAtS);
   let acting:ActingMind={...cancelActingIntention(next.acting,atS),intention:null};
   if(best.partnerId)acting=beginActingIntention(acting,{id:`npc:${d.serial}`,goalId:best.need,subject:best.subject,partnerId:best.partnerId},atS);
   next=remember({...next,acting,decision:d,decisionSerial:d.serial,attention:{subject:best.subject,confidence:best.confidence,
    ...(best.position?{position:[...best.position] as Vec3}:{})},pendingAction:danger?gesture.safety:next.pendingAction??gesture[best.need]},thought(d,'intend',atS,best.confidence));request=d;
  }else if(next.thoughts[0]?.kind!=='wait'){
   next=remember({...next,attention:null},{atS,kind:'wait',need:null,subject:null,affordanceId:null,confidence:0});
  }
 }
 // Refresh or clear attention from current perception; never track an unseen target.
 if(next.decision?.status==='active'){
  const seen=affordances.find(a=>a.id===next.decision!.affordanceId&&a.available);
  next={...next,attention:seen?{subject:seen.subject,confidence:seen.confidence,...(seen.position?{position:[...seen.position] as Vec3}:{})}:null};
 }
 let cue:ActingCue|null=null;
 if(next.lastCueS===null||atS-next.lastCueS>=.22&&(next.pendingAction!==null||atS-next.lastCueS>=NPC_MIND_LIMITS.cueS)){
  const ongoing=next.decision?.status==='active'?
   next.acting.intention?.action==='clarify'?'clarify':next.decision.need==='company'?'listen':gesture[next.decision.need]:'listen';
  const action=next.pendingAction??ongoing;
  cue=makeActingCue(next.acting,next.cueSerial+1,action,atS,NPC_MIND_LIMITS.cueS,next.attention?.position);
  next={...next,cueSerial:cue.serial,lastCueS:atS,pendingAction:null};
 }
 return {mind:next,cue,request};
}
/** Migrate once at restore, preserving NPC identity, needs and decision history.
 * Legacy aggregate emotion becomes an unattributed baseline, not new evidence. */
export function migrateNpcMind(value:LegacyNpcMind|NpcMind):NpcMind {
 if(!value||value.version!==1)throw new TypeError('Unsupported NPC mind');
 const {acting,...outer}=value;
 const result:NpcMind={...structuredClone(outer),acting:migrateActingMind(acting)};
 validateNpcMind(result);return result;
}
/** Validate current JSON restored from storage; migrate older nested acting first. */
export function validateNpcMind(m:NpcMind):void {
 if(!m||m.version!==1)throw new TypeError('Unsupported NPC mind');validateActingMind(m.acting);
 if(!Array.isArray(m.needs)||m.needs.length!==NPC_NEEDS.length||m.acting.goals.length!==NPC_NEEDS.length)throw new TypeError('NPC requires four needs');
 const seen=new Set<string>();
 for(const n of m.needs){
  need(n.id);unit(n.urgency);unit(n.importance);
  if(!Number.isFinite(n.growthPerS)||n.growthPerS<0||n.growthPerS>1||seen.has(n.id)||!m.acting.goals.some(g=>g.id===n.id&&g.importance===n.importance))throw new TypeError('Invalid NPC need');seen.add(n.id);
 }
 serial(m.decisionSerial);serial(m.cueSerial);
 if(m.lastCueS!==null){actingTime(m.lastCueS);if(m.lastCueS>m.acting.atS||m.cueSerial===0)throw new TypeError('Invalid NPC cue clock');}
 else if(m.cueSerial!==0)throw new TypeError('Missing NPC cue clock');
 if(m.pendingAction!==null&&!ACTING_ACTIONS.includes(m.pendingAction))throw new TypeError('Invalid pending NPC gesture');
 if(m.decision){
  const d=m.decision;serial(d.serial);id(d.affordanceId);id(d.subject);need(d.need);unit(d.score);actingTime(d.startedAtS);actingTime(d.expiresAtS);
  if(d.serial<1||d.serial>m.decisionSerial||d.startedAtS>m.acting.atS||d.expiresAtS!==d.startedAtS+NPC_MIND_LIMITS.decisionS||!['active','succeeded','blocked'].includes(d.status))throw new TypeError('Invalid NPC decision');
  if(d.partnerId!==undefined){id(d.partnerId);if(d.partnerId===m.acting.actorId)throw new TypeError('Invalid NPC partner');}
  if(d.status==='active'){
   const i=m.acting.intention;
   if(d.partnerId?(i?.status!=='active'||i.id!==`npc:${d.serial}`||i.partnerId!==d.partnerId||i.subject!==d.subject||i.goalId!==d.need):i!==null)throw new TypeError('NPC decision and acting intention disagree');
  }
 }
 if(m.attention){id(m.attention.subject);unit(m.attention.confidence);if(m.attention.position!==undefined)finiteVec3(m.attention.position,'NPC attention');
  if(m.decision===null||m.attention.subject!==m.decision.subject)throw new TypeError('NPC attention and decision disagree');}
 if(!Array.isArray(m.thoughts)||m.thoughts.length>NPC_MIND_LIMITS.thoughts)throw new RangeError('NPC thought budget exceeded');
 let previous=m.acting.atS;
 for(const t of m.thoughts){
  actingTime(t.atS);unit(t.confidence);if(t.atS>previous||!['intend','wait','succeeded','blocked','timeout','interrupted'].includes(t.kind))throw new TypeError('Invalid NPC thought');previous=t.atS;
  if(t.need!==null)need(t.need);if(t.subject!==null)id(t.subject);if(t.affordanceId!==null)id(t.affordanceId);
  if(t.kind==='wait'?(t.need!==null||t.subject!==null||t.affordanceId!==null):(t.need===null||t.subject===null||t.affordanceId===null))throw new TypeError('Incomplete NPC thought');
 }
}
