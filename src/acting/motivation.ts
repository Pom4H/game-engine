/** Субъективные оценки, а не объективная психология. Все времена — секунды симуляции.
 * Чистые редьюсеры: authority обязан сохранить новый state вместе с реальным результатом.
 * Текст диалога, анимация и клиент не могут создавать успешные исходы. */
export const ACTING_LIMITS=Object.freeze({goals:8,sentiments:24,memories:32,attempts:3});
export const ACTING_ACTIONS=['listen','ask','explain','decline','acknowledge','clarify','withdraw'] as const;
export type ActingAction=typeof ACTING_ACTIONS[number];
export interface ActingGoal {readonly id:string;readonly importance:number}
export interface ActingSentiment {
 readonly subject:string;readonly affinity:number;readonly benevolence:number;
 readonly reliability:number;readonly competence:number;readonly confidence:number;readonly atS:number;
}
export interface ActingAffect {readonly valence:number;readonly arousal:number;readonly uncertainty:number;readonly atS:number}
export interface ActingIntention {
 readonly id:string;readonly goalId:string;readonly subject:string;readonly partnerId:string;
 readonly action:ActingAction;readonly attempts:number;readonly status:'active'|'succeeded'|'blocked';
}
/** Только воспринятый исход. «Не смог» не доказывает нежелания или некомпетентности.
 * Атрибуция — мнение наблюдателя; обещание/компетенция требуют отдельных свидетельств. */
export interface ActingOutcome {
 readonly sequence:number;readonly id:string;readonly goalId:string;readonly subject:string;readonly atS:number;
 readonly progress:number;readonly expectedProgress:number;readonly certainty:number;
 readonly attribution:'help'|'unable'|'unwilling'|'unknown';readonly otherId?:string;
 readonly confirmedResolution?:boolean;readonly reliabilityEvidence?:number;readonly competenceEvidence?:number;
}
export interface ActingMind {
 readonly version:1;readonly actorId:string;readonly goals:readonly ActingGoal[];
 readonly sentiments:readonly ActingSentiment[];readonly memories:readonly ActingOutcome[];
 readonly affect:ActingAffect;readonly intention:ActingIntention|null;readonly lastSequence:number;readonly atS:number;
}
export const clampActing=(n:number,min=0,max=1):number=>Math.max(min,Math.min(max,n));
export function actingTime(n:number):void {if(!Number.isFinite(n)||n<0)throw new RangeError('Invalid acting time');}
function id(s:string):void {if(typeof s!=='string'||!s||s.length>160)throw new TypeError('Invalid acting ID');}
function range(n:number,min=0,max=1):void {if(!Number.isFinite(n)||n<min||n>max)throw new RangeError('Acting value out of range');}
function sequence(n:number):void {if(!Number.isSafeInteger(n)||n<1)throw new RangeError('Invalid outcome sequence');}
export function validateActingOutcome(e:ActingOutcome):void {
 id(e.id);id(e.goalId);id(e.subject);actingTime(e.atS);sequence(e.sequence);
 range(e.progress,-1);range(e.expectedProgress,-1);range(e.certainty);
 if(!['help','unable','unwilling','unknown'].includes(e.attribution))throw new TypeError('Invalid attribution');
 if(e.otherId!==undefined)id(e.otherId);
 if(e.confirmedResolution!==undefined&&typeof e.confirmedResolution!=='boolean')throw new TypeError('Invalid resolution');
 if(e.confirmedResolution&&e.progress!==1)throw new TypeError('Resolution requires confirmed full progress');
 for(const v of [e.reliabilityEvidence,e.competenceEvidence])if(v!==undefined)range(v,-1);
}
export function createActingMind(actorId:string,goals:readonly ActingGoal[],atS=0):ActingMind {
 id(actorId);actingTime(atS);if(!goals.length||goals.length>ACTING_LIMITS.goals)throw new RangeError('Invalid goal budget');
 const ids=new Set<string>();for(const g of goals){id(g.id);range(g.importance);if(ids.has(g.id))throw new TypeError('Duplicate goal');ids.add(g.id);}
 return {version:1,actorId,goals:goals.map(g=>({...g})),sentiments:[],memories:[],
  affect:{valence:0,arousal:0,uncertainty:0,atS},intention:null,lastSequence:0,atS};
}
/** Эмоция затухает; отношение не обнуляется при успокоении или выгрузке. */
export function actingAffectAt(mind:ActingMind,atS:number):ActingAffect {
 actingTime(atS);if(atS<mind.atS)throw new RangeError('Acting clock moved backwards');
 const k=Math.exp(-(atS-mind.affect.atS)/12);
 return {valence:mind.affect.valence*k,arousal:mind.affect.arousal*k,uncertainty:mind.affect.uncertainty*k,atS};
}
export function beginActingIntention(mind:ActingMind,input:Pick<ActingIntention,'id'|'goalId'|'subject'|'partnerId'>,atS:number):ActingMind {
 actingAffectAt(mind,atS);for(const value of Object.values(input))id(value);
 if(input.partnerId===mind.actorId||!mind.goals.some(g=>g.id===input.goalId))throw new TypeError('Invalid intention partner or goal');
 if(mind.intention?.status==='active')throw new Error('Resolve or cancel the active intention first');
 return {...mind,atS,intention:{...input,action:'ask',attempts:0,status:'active'}};
}
export function cancelActingIntention(mind:ActingMind,atS:number):ActingMind {
 actingAffectAt(mind,atS);return {...mind,atS,intention:mind.intention?{...mind.intention,status:'blocked',action:'withdraw'}:null};
}
/** Один атомарный вход authority. Повтор не усиливает эмоцию и отношения.
 * Вытеснение памяти не отменяет монотонный sequence; повтор с новым sequence и
 * давно вытесненным ID должен отсеиваться владельцем журнала, не этой памятью. */
export function appraiseActingOutcome(mind:ActingMind,event:ActingOutcome):ActingMind {
 validateActingOutcome(event);
 if(event.sequence<=mind.lastSequence)return mind;
 if(event.atS<mind.atS)throw new RangeError('Outcome clock moved backwards');
 const goal=mind.goals.find(g=>g.id===event.goalId);if(!goal)throw new TypeError('Unknown outcome goal');
 if(event.otherId===mind.actorId)throw new TypeError('Other actor cannot be self');
 if(mind.memories.some(e=>e.id===event.id))return {...mind,lastSequence:event.sequence,atS:event.atS};
 const prior=actingAffectAt(mind,event.atS),surprise=Math.abs(event.progress-event.expectedProgress)/2;
 const appraisal=goal.importance*event.certainty*(.65*event.progress+.35*(event.progress-event.expectedProgress)/2);
 const affect:ActingAffect={valence:clampActing(prior.valence*.35+appraisal,-1,1),
  arousal:clampActing(prior.arousal*.35+goal.importance*(Math.abs(event.progress)*.45+surprise*.55)),
  uncertainty:clampActing((1-event.certainty)*goal.importance),atS:event.atS};
 let sentiments=[...mind.sentiments];
 const update=(subject:string,personal:boolean)=>{
  const old=sentiments.find(s=>s.subject===subject)??{subject,affinity:0,benevolence:.5,reliability:.5,competence:.5,confidence:0,atS:event.atS};
  const learning=.06*goal.importance*event.certainty;
  // Невозможность помочь не снижает доброжелательность или привязанность.
  const social=event.attribution==='help'?1:event.attribution==='unwilling'?-1:0;
  const next:ActingSentiment={...old,atS:event.atS,
   affinity:clampActing(old.affinity+learning*(personal?social*.35:event.progress),-1,1),
   benevolence:clampActing(old.benevolence+(personal?learning*social:0)),
   reliability:clampActing(old.reliability+(personal?learning*(event.reliabilityEvidence??0):0)),
   competence:clampActing(old.competence+(personal?learning*(event.competenceEvidence??0):0)),
   confidence:clampActing(old.confidence+learning)};
  sentiments=sentiments.filter(s=>s.subject!==subject);sentiments.push(next);
 };
 if(event.subject!==event.otherId)update(event.subject,false);
 if(event.otherId)update(event.otherId,true);
 sentiments.sort((a,b)=>b.atS-a.atS||(a.subject<b.subject?-1:a.subject>b.subject?1:0));
 let intention=mind.intention;
 if(intention?.status==='active'&&intention.goalId===event.goalId&&intention.subject===event.subject&&event.otherId===intention.partnerId){
  const attempts=intention.attempts+1,done=event.confirmedResolution===true;
  const stop=!done&&(event.attribution==='unwilling'||attempts>=ACTING_LIMITS.attempts);
  intention={...intention,attempts,status:done?'succeeded':stop?'blocked':'active',action:done?'acknowledge':stop?'withdraw':'clarify'};
 }
 return {...mind,atS:event.atS,lastSequence:event.sequence,affect,intention,
  sentiments:sentiments.slice(0,ACTING_LIMITS.sentiments),memories:[structuredClone(event),...mind.memories].slice(0,ACTING_LIMITS.memories)};
}
/** Выбор по собственным отношениям и публичной доступности кандидата.
 * Здесь нет параметра с настоящими знаниями/целями другого NPC. */
export function chooseActingPartner(mind:ActingMind,candidates:readonly {readonly id:string;readonly available:boolean;readonly distanceM:number}[]):string|null {
 if(candidates.length>32)throw new RangeError('Acting candidate budget exceeded');
 const seen=new Set<string>();let best:string|null=null,score=-Infinity;
 for(const c of candidates){id(c.id);range(c.distanceM,0,1e6);if(typeof c.available!=='boolean'||seen.has(c.id))throw new TypeError('Invalid or duplicate candidate');seen.add(c.id);
  if(!c.available||c.id===mind.actorId)continue;
  const s=mind.sentiments.find(s=>s.subject===c.id);
  const value=(s?.benevolence??.5)*.35+(s?.reliability??.5)*.25+(s?.competence??.5)*.3+(s?.affinity??0)*.1-c.distanceM*.01;
  if(value>score||value===score&&(best===null||c.id<best)){best=c.id;score=value;}
 }return best;
}
/** Проверка восстановленного JSON до принятия его authority. */
export function validateActingMind(mind:ActingMind):void {
 if(!mind||mind.version!==1)throw new TypeError('Unsupported acting mind');
 createActingMind(mind.actorId,mind.goals,mind.atS);
 if(!Number.isSafeInteger(mind.lastSequence)||mind.lastSequence<0)throw new RangeError('Invalid saved sequence');
 actingTime(mind.affect.atS);if(mind.affect.atS>mind.atS)throw new RangeError('Future affect');
 range(mind.affect.valence,-1);range(mind.affect.arousal);range(mind.affect.uncertainty);
 if(mind.sentiments.length>ACTING_LIMITS.sentiments||mind.memories.length>ACTING_LIMITS.memories)throw new RangeError('Saved mind exceeds budget');
 const subjects=new Set<string>();for(const s of mind.sentiments){id(s.subject);actingTime(s.atS);if(s.atS>mind.atS||subjects.has(s.subject))throw new TypeError('Invalid saved sentiment');subjects.add(s.subject);
  range(s.affinity,-1);for(const v of [s.benevolence,s.reliability,s.competence,s.confidence])range(v);}
 const ids=new Set<string>(),seqs=new Set<number>();for(const e of mind.memories){validateActingOutcome(e);if(e.atS>mind.atS||e.sequence>mind.lastSequence||ids.has(e.id)||seqs.has(e.sequence)||!mind.goals.some(g=>g.id===e.goalId))throw new TypeError('Invalid saved memory');ids.add(e.id);seqs.add(e.sequence);}
 if(mind.intention){const i=mind.intention;for(const s of [i.id,i.subject,i.partnerId,i.goalId])id(s);
  if(i.partnerId===mind.actorId||!mind.goals.some(g=>g.id===i.goalId)||!ACTING_ACTIONS.includes(i.action)||!['active','succeeded','blocked'].includes(i.status)||!Number.isInteger(i.attempts)||i.attempts<0||i.attempts>ACTING_LIMITS.attempts)throw new TypeError('Invalid saved intention');}
}
