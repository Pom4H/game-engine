/**
 * Offline literary-scene boundary.
 *
 * A language model may propose interpretations, but it cannot mutate physics
 * through an image or a metaphor. Explicit measurable claims are checked
 * against exact source excerpts; guesses are render-only projections.
 *
 * The World compiler / Scene remains the only physical state owner.
 */
import {validateScene} from '../scene/validate.js';
import type {CameraSpec,EntitySpec,SceneSpec} from '../scene/types.js';
import type {Snowfall} from '../environment/types.js';

export const LITERARY_DRAFT_VERSION=1 as const;
export type LiteraryReading='literal'|'figurative'|'uncertain';
export interface LiteraryClaim {
  readonly id:string;
  readonly quote:string;
  readonly reading:LiteraryReading;
  /** UTF-16 offset; required for repeated quotations in longer texts. */
  readonly offset?:number;
}
export type LiteraryFact =
  |{readonly claimId:string;readonly kind:'temperatureC';readonly value:number}
  |{readonly claimId:string;readonly kind:'snowfall';readonly value:Snowfall}
  |{readonly claimId:string;readonly kind:'massKg'|'velocityX';readonly entityId:string;readonly value:number};
export interface LiteraryVisual {
  readonly claimId:string;
  readonly entity:EntitySpec;
}
export interface LiteraryShot {
  readonly id:string;
  readonly camera:CameraSpec;
}
export interface LiteraryDraft {
  readonly version:1;
  readonly source:string;
  readonly claims:readonly LiteraryClaim[];
  readonly facts:readonly LiteraryFact[];
  readonly visuals:readonly LiteraryVisual[];
  readonly shots:readonly LiteraryShot[];
}
export interface LiteraryCompilation {
  readonly scene:SceneSpec;
  readonly shots:readonly LiteraryShot[];
  readonly provenance:{
    readonly claims:readonly (LiteraryClaim&{readonly resolvedOffset:number})[];
    readonly facts:readonly LiteraryFact[];
    readonly visualEntities:readonly {readonly id:string;readonly claimId:string}[];
    readonly ungrounded:readonly string[];
  };
}
const ident=/^[a-z][a-z0-9-]{0,79}$/;
const norm=(text:string)=>text.normalize('NFC').replaceAll('−','-').replaceAll('–','-').replaceAll(',','.');
const number=(value:unknown,description:string):number=>{
  if(typeof value!=='number'||!Number.isFinite(value))throw new TypeError(description+' must be finite');
  return value;
};
function fail(message:string):never{throw new TypeError('Literature: '+message);}
function record(value:unknown,where:string):Record<string,unknown>{
  if(value===null||typeof value!=='object'||Array.isArray(value))fail(where+' must be an object');
  return value as Record<string,unknown>;
}
function list(value:unknown,where:string,max:number):readonly unknown[]{
  if(!Array.isArray(value)||value.length>max)fail(where+' must be an array with at most '+max+' items');
  return value;
}
function id(value:unknown,where:string):string{
  if(typeof value!=='string'||!ident.test(value))fail(where+' must be a stable lowercase ID');
  return value;
}
function exactNumericEvidence(quote:string,unit:RegExp,value:number,description:string):void{
  const normalized=norm(quote);
  const matches=[...normalized.matchAll(unit)];
  if(!matches.some(match=>Math.abs(Number(match[1])-value)<=Math.max(1e-8,Math.abs(value)*1e-9)))
    fail(description+' requires an explicit matching number and unit in its quotation');
}
function validateFactEvidence(claim:LiteraryClaim,fact:LiteraryFact):void{
  if(claim.reading!=='literal')fail('only literal claims can change physical state: '+claim.id);
  const quote=norm(claim.quote).toLowerCase();
  if(fact.kind==='temperatureC'){
    number(fact.value,'temperatureC');
    exactNumericEvidence(quote,/([+-]?\d+(?:\.\d+)?)\s*°?\s*[cс](?![a-zа-яё])/giu,fact.value,'temperatureC');
  }else if(fact.kind==='snowfall'){
    if(!['none','light','moderate','heavy'].includes(fact.value))fail('unsupported snowfall');
    const quality:Record<Snowfall,RegExp>={
      none:/без снега|снег (?:прекратил|кончил)|no snow/u,
      light:/слаб|лёгк|легк|light/iu,
      moderate:/умерен|средн|moderate/iu,
      heavy:/сильн|обильн|heavy/iu,
    };
    if(!/(снег|snow)/iu.test(quote)||!quality[fact.value].test(quote))
      fail('snowfall needs explicit intensity in quotation; a blizzard is not necessarily precipitation');
  }else if(fact.kind==='massKg'){
    number(fact.value,'massKg');
    if(!(fact.value>0))fail('massKg must be positive');
    exactNumericEvidence(quote,/([+-]?\d+(?:\.\d+)?)\s*(?:кг|kg)(?![a-zа-яё])/giu,fact.value,'massKg');
  }else if(fact.kind==='velocityX'){
    number(fact.value,'velocityX');
    const matches=[...quote.matchAll(/([+-]?\d+(?:\.\d+)?)\s*(км\/ч|km\/h|м\/с|m\/s)(?![a-zа-яё])/giu)];
    const directed=/(?:на восток|к востоку|east)/iu.test(quote)?1:
      /(?:на запад|к западу|west)/iu.test(quote)?-1:0;
    if(!directed||!matches.some(match=>{
      const magnitude=Number(match[1])*(/км\/ч|km\/h/iu.test(match[2]!)?1/3.6:1);
      return Math.abs(magnitude*directed-fact.value)<1e-7;
    }))fail('velocityX requires a matching explicit speed and east/west direction (+X east)');
  }
}

/** Validates model output before it can reach the engine. No LLM runs per tick. */
export function compileLiteraryDraft(raw:unknown,world:unknown):LiteraryCompilation{
  const draft=record(raw,'draft');
  if(draft.version!==LITERARY_DRAFT_VERSION)fail('unsupported draft version');
  const text=draft.source;
  if(typeof text!=='string'||text.length===0||text.length>1_000_000)fail('source must contain 1..1,000,000 characters');
  const claims=new Map<string,LiteraryClaim&{resolvedOffset:number}>();
  for(const rawClaim of list(draft.claims,'claims',2048)){
    const c=record(rawClaim,'claim'),key=id(c.id,'claim.id');
    if(claims.has(key))fail('duplicate claim '+key);
    if(typeof c.quote!=='string'||!c.quote.length||c.quote.length>10_000)fail('claim quote is empty or oversized');
    if(!['literal','figurative','uncertain'].includes(String(c.reading)))fail('invalid reading');
    const at=c.offset===undefined?text.indexOf(c.quote):c.offset;
    if(!Number.isSafeInteger(at)||typeof at!=='number'||at<0||text.slice(at,at+c.quote.length)!==c.quote)
      fail('claim '+key+' has no exact source span');
    if(c.offset===undefined&&text.indexOf(c.quote,at+1)!==-1)
      fail('claim '+key+' is repeated; provide an explicit offset');
    claims.set(key,{id:key,quote:c.quote,reading:c.reading as LiteraryReading,
      ...(c.offset===undefined?{}:{offset:at}),resolvedOffset:at});
  }
  const base=validateScene(structuredClone(world));
  const entities:EntitySpec[]=[...base.entities];
  const seenEntities=new Set(entities.map(entity=>entity.id));
  const applied:LiteraryFact[]=[];
  const modified=new Set<string>();
  const environment={...(base.environment??{})};
  for(const rawFact of list(draft.facts,'facts',512)){
    const f=record(rawFact,'fact');
    const claim=claims.get(id(f.claimId,'fact.claimId'));
    if(!claim)fail('fact references unknown claim '+f.claimId);
    if(!['temperatureC','snowfall','massKg','velocityX'].includes(String(f.kind)))
      fail('unsupported physical operation '+f.kind);
    const fact=f as unknown as LiteraryFact;
    validateFactEvidence(claim,fact);
    const target=(fact.kind==='massKg'||fact.kind==='velocityX')?
      id(fact.entityId,'fact.entityId'):'environment';
    const slot=target+'.'+fact.kind;
    if(modified.has(slot))fail('multiple claims target '+slot);
    modified.add(slot);
    if(fact.kind==='temperatureC')environment.temperatureC=fact.value;
    else if(fact.kind==='snowfall')environment.snowfall=fact.value;
    else{
      const index=entities.findIndex(entity=>entity.id===target);
      if(index<0||!entities[index]?.body||entities[index]!.renderOnly)
        fail('fact target must be an existing physical entity: '+target);
      const entity=entities[index]!;
      if(!(entity.body!.mass??0))fail('cannot transform a static entity into a moving body: '+target);
      const body=entity.body!;
      if(fact.kind==='massKg')entities[index]={...entity,body:{...body,mass:fact.value}};
      else entities[index]={...entity,body:{...body,
        velocity:[fact.value,body.velocity?.[1]??0,body.velocity?.[2]??0]}};
    }
    applied.push(fact);
  }
  const visualEntities:{id:string;claimId:string}[]=[];
  for(const rawVisual of list(draft.visuals,'visuals',1024)){
    const visual=record(rawVisual,'visual'),claimId=id(visual.claimId,'visual.claimId');
    if(!claims.has(claimId))fail('visual references unknown claim '+claimId);
    const entity=record(visual.entity,'visual.entity') as unknown as EntitySpec;
    if(entity.renderOnly!==true||entity.body!==undefined||entity.environmental!==undefined)
      fail('visual hypothesis must explicitly be renderOnly with no body/environmental: '+entity.id);
    if(typeof entity.id!=='string'||seenEntities.has(entity.id))
      fail('visual entity has duplicate or missing id: '+entity.id);
    seenEntities.add(entity.id);
    entities.push(structuredClone(entity));
    visualEntities.push({id:entity.id,claimId});
  }
  const shots:LiteraryShot[]=[];
  const shotIds=new Set<string>();
  for(const rawShot of list(draft.shots,'shots',64)){
    const shot=record(rawShot,'shot'),key=id(shot.id,'shot.id');
    if(shotIds.has(key))fail('duplicate shot '+key);
    shotIds.add(key);
    if(!shot.camera)fail('shot needs camera');
    const camera=structuredClone(shot.camera) as CameraSpec;
    validateScene({version:1,entities:[],camera});
    shots.push({id:key,camera});
  }
  const scene=validateScene({...base,environment,entities});
  const ungrounded=[...claims.values()].filter(claim=>claim.reading!=='literal').map(claim=>claim.id);
  return {scene,shots,provenance:{
    claims:[...claims.values()],facts:applied,visualEntities,ungrounded,
  }};
}

/** A second observer never creates a second authoritative physical world. */
export function literaryView(scene:SceneSpec,shot:LiteraryShot):SceneSpec{
  return validateScene({...scene,camera:structuredClone(shot.camera)});
}
