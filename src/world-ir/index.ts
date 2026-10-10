/**
 * World Interaction IR v1.
 *
 * Physical laws remain owned by their live simulation domains. This is a
 * bounded, strictly typed, immutable causal observation of commits, not a
 * second simulation or a dispatcher for gameplay/audio/render side effects.
 * Identical observations work for Rust-compiled .wscn and TS-authored scenes.
 */
import type {EnvironmentState} from '../environment/types.js';
import type {SurfaceContactWork,SurfaceEnvironmentState} from '../environment/surface-state.js';
import type {Vec3} from '../math.js';
import type {Contact} from '../physics/world.js';
import type {EngineEvent} from '../scene/events.js';

export const WORLD_INTERACTION_IR_VERSION=1 as const;
/** Stable law names shared by runtime producers and cross-domain observers.
 * These describe causes, not implementation placement (JS, Rust, GPU, NPU). */
export const WORLD_INTERACTION_LAWS=Object.freeze({
  weather:'environment.resolve',
  contact:'physics.contact',
  'surface-work':'surface.contact-work',
  impact:'scene.impact',
  fracture:'scene.fracture',
  mechanism:'scene.mechanism',
} as const);
export type WorldInteractionLaw=typeof WORLD_INTERACTION_LAWS[keyof typeof WORLD_INTERACTION_LAWS];

export type WorldInteractionDomain='body'|'ground'|'surface'|'environment'|'entity';
export interface WorldInteractionRef {
  readonly domain:WorldInteractionDomain;
  readonly id:string;
}
export interface WorldContactEffect {
  readonly kind:'contact';
  readonly pointM:Vec3;
  readonly normal:Vec3;
  readonly penetrationM:number;
  readonly normalImpulseNs:number;
  readonly normalSpeedMps:number;
  readonly normalEnergyJ:number;
  readonly mode:'resolve'|'penetrate';
}
export interface WorldWeatherEffect {
  readonly kind:'weather';
  /** These are resolved authoritative inputs, not a second evolving weather field. */
  readonly temperatureC:number;
  readonly snowfall:EnvironmentState['snowfall'];
  readonly snowfallRateMps:number;
  readonly humidity:number;
  readonly windMps:Vec3;
  readonly sunlight:number;
  readonly groundMoisture:number;
}
export interface WorldSurfaceEffect {
  readonly kind:'surface-work';
  readonly contact:Readonly<SurfaceContactWork>;
  readonly workJ:number;
  readonly affectedCells:number;
  readonly resulting:Readonly<Pick<SurfaceEnvironmentState,
    'temperatureC'|'snowDepthM'|'waterDepthM'|'iceDepthM'|'slush'|
    'frictionScale'|'trafficHeatC'|'dirt'|'trackMelt'>>;
}
export interface WorldEventEffect {
  readonly kind:'event';
  /** Exactly the engine-committed event, shared by synthesis and replay. */
  readonly event:EngineEvent;
}
export type WorldInteractionEffect=
  |WorldContactEffect|WorldWeatherEffect|WorldSurfaceEffect|WorldEventEffect;

export interface WorldInteraction {
  readonly schema:typeof WORLD_INTERACTION_IR_VERSION;
  readonly sequence:number;
  /** Deterministic within the capture session, monotonically increasing. */
  readonly id:string;
  readonly tick:number;
  readonly timeSeconds:number;
  readonly law:WorldInteractionLaw;
  readonly source:WorldInteractionRef;
  readonly target?:WorldInteractionRef;
  /** IDs refer to committed World interactions, never to render pixels. */
  readonly causeId?:string;
  readonly effect:WorldInteractionEffect;
}
export interface WorldInteractionGraph {
  readonly schema:typeof WORLD_INTERACTION_IR_VERSION;
  readonly convention:Readonly<{handedness:'right';up:'+Y';position:'m';time:'s';angle:'rad'}>;
  readonly tick:number;
  readonly timeSeconds:number;
  readonly firstSequence:number;
  /** Exclusive query cursor. Older parents may be omitted by design. */
  readonly afterSequence:number;
  readonly nextSequence:number;
  readonly dropped:number;
  readonly interactions:readonly WorldInteraction[];
}
export interface WorldInteractionStats {
  readonly retained:number;
  readonly capacity:number;
  readonly dropped:number;
  readonly nextSequence:number;
}

function fail(message:string):never{throw new TypeError('World Interaction IR: '+message);}
function finite(value:number,label:string):void{
  if(!Number.isFinite(value))fail(label+' must be finite');
}
function id(value:string,label:string):void{
  if(typeof value!=='string'||value.length===0||value.length>180)fail(label+' needs a bounded stable identity');
}
function vec3(value:readonly number[],label:string):void{
  if(value.length!==3)fail(label+' must be a 3-vector');
  for(const x of value)finite(x,label);
}
function deepFreeze<T>(value:T):T{
  if(value&&typeof value==='object'&&!Object.isFrozen(value)){
    for(const child of Object.values(value as Record<string,unknown>))deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
const convention=Object.freeze({handedness:'right' as const,up:'+Y' as const,position:'m' as const,time:'s' as const,angle:'rad' as const});
const pairKey=(a:string,b:string)=>a<b?a+'\u0000'+b:b+'\u0000'+a;

/** One validation contract for authored observations AND untrusted projections. */
function validateEffect(effect:WorldInteractionEffect):void{
    if(effect.kind==='contact'){
      vec3(effect.pointM,'contact point');
      vec3(effect.normal,'contact normal');
      for(const [name,n] of Object.entries({
        penetrationM:effect.penetrationM,normalImpulseNs:effect.normalImpulseNs,
        normalSpeedMps:effect.normalSpeedMps,normalEnergyJ:effect.normalEnergyJ,
      }))finite(n,name);
      if(effect.penetrationM<0||effect.normalEnergyJ<0)fail('invalid contact energy/depth');
    }else if(effect.kind==='weather'){
      vec3(effect.windMps,'weather wind');
      for(const n of [effect.temperatureC,effect.snowfallRateMps,effect.humidity,effect.sunlight,effect.groundMoisture])finite(n,'weather');
    }else if(effect.kind==='surface-work'){
      for(const n of Object.values(effect.resulting))finite(n,'surface state');
      for(const n of Object.values(effect.contact))if(typeof n==='number')finite(n,'surface contact');
      finite(effect.workJ,'surface mechanical work');
      if(effect.workJ<0||!Number.isSafeInteger(effect.affectedCells)||effect.affectedCells<1)
        fail('invalid surface work');
    }else if(effect.kind==='event'){
      finite(effect.event.time,'event time');
      vec3(effect.event.point,'event point');
      if(effect.event.type!=='mechanism')vec3(effect.event.normal,'event normal');
      finite(effect.event.energy,'event energy');
    }
  else fail('unknown interaction effect');
}

/**
 * A fixed-capacity observational ring. Inserting never grows its storage.
 * Parent identifiers are meaningful even after the older parent is evicted:
 * the graph reports firstSequence and dropped explicitly.
 */
export class WorldInteractionJournal {
  readonly capacity:number;
  private readonly ring:(WorldInteraction|undefined)[];
  private head=0;
  private count=0;
  private dropped=0;
  private next=1;
  private readonly recentContacts=new Map<string,string>();
  private recentTick=-1;

  constructor(capacity=4096){
    if(!Number.isSafeInteger(capacity)||capacity<16||capacity>65_536)
      throw new RangeError('World Interaction IR capacity must be 16..65536');
    this.capacity=capacity;
    this.ring=new Array<WorldInteraction|undefined>(capacity);
  }
  get stats():WorldInteractionStats{
    return Object.freeze({retained:this.count,capacity:this.capacity,dropped:this.dropped,nextSequence:this.next});
  }

  private append(input:Omit<WorldInteraction,'schema'|'id'|'sequence'|'law'>):WorldInteraction{
    if(!Number.isSafeInteger(input.tick)||input.tick<0)fail('tick');
    finite(input.timeSeconds,'timeSeconds');
    id(input.source.id,'source');
    if(!['body','ground','surface','environment','entity'].includes(input.source.domain))
      fail('unknown source domain');
    if(input.target){
      id(input.target.id,'target');
      if(!['body','ground','surface','environment','entity'].includes(input.target.domain))
        fail('unknown target domain');
    }
    if(input.causeId&&!/^wi:1:[1-9][0-9]*$/.test(input.causeId))fail('invalid causal reference');
    // All effects share the same validation as external render/network readers.
    const effect=input.effect;
    validateEffect(effect);
    const sequence=this.next++;
    const law:WorldInteractionLaw=effect.kind==='event'
      ?WORLD_INTERACTION_LAWS[effect.event.type]:WORLD_INTERACTION_LAWS[effect.kind];
    const record=deepFreeze(structuredClone({
      ...input,schema:WORLD_INTERACTION_IR_VERSION,sequence,id:'wi:1:'+sequence,law,
    })) as WorldInteraction;
    if(this.count<this.capacity){
      this.ring[(this.head+this.count)%this.capacity]=record;
      this.count++;
    }else{
      this.ring[this.head]=record;
      this.head=(this.head+1)%this.capacity;
      this.dropped++;
    }
    return record;
  }

  recordWeather(weather:EnvironmentState,tick:number,timeSeconds:number):WorldInteraction{
    return this.append({
      tick,timeSeconds,source:{domain:'environment',id:'weather'},
      effect:{kind:'weather',temperatureC:weather.temperatureC,snowfall:weather.snowfall,
        snowfallRateMps:weather.snowfallRate,humidity:weather.humidity,windMps:[...weather.wind],
        sunlight:weather.sunlight,groundMoisture:weather.groundMoisture},
    });
  }

  recordContact(contact:Contact,tick:number,timeSeconds:number):WorldInteraction{
    if(this.recentTick!==tick){this.recentContacts.clear();this.recentTick=tick;}
    const record=this.append({
      tick,timeSeconds,
      source:{domain:'body',id:contact.a},
      target:contact.b==='ground'?{domain:'ground',id:'ground'}:{domain:'body',id:contact.b},
      effect:{kind:'contact',mode:contact.mode,pointM:[...contact.point],normal:[...contact.normal],
        penetrationM:contact.penetration,normalImpulseNs:contact.impulse,
        normalSpeedMps:contact.normalSpeed,normalEnergyJ:contact.normalEnergy},
    });
    const key=pairKey(contact.a,contact.b);
    this.recentContacts.delete(key);
    if(this.recentContacts.size>=this.capacity){
      const oldest=this.recentContacts.keys().next().value;
      if(oldest!==undefined)this.recentContacts.delete(oldest);
    }
    this.recentContacts.set(key,record.id);
    return record;
  }

  contactForPair(a:string,b:string,tick:number):string|undefined{
    return tick===this.recentTick?this.recentContacts.get(pairKey(a,b)):undefined;
  }

  recordSurfaceWork(
    work:SurfaceContactWork,workJ:number,affectedCells:number,
    actual:SurfaceEnvironmentState,tick:number,timeSeconds:number,
  ):WorldInteraction{
    return this.append({
      tick,timeSeconds,source:{domain:'body',id:work.sourceId},
      target:{domain:'surface',id:work.surfaceId},
      effect:{kind:'surface-work',contact:{...work},workJ,affectedCells,resulting:{
        temperatureC:actual.temperatureC,snowDepthM:actual.snowDepthM,
        waterDepthM:actual.waterDepthM,iceDepthM:actual.iceDepthM,slush:actual.slush,
        frictionScale:actual.frictionScale,trafficHeatC:actual.trafficHeatC,
        dirt:actual.dirt,trackMelt:actual.trackMelt,
      }},
    });
  }

  recordEvent(event:EngineEvent,tick:number,causeId?:string):WorldInteraction{
    const source:WorldInteractionRef=event.type==='fracture'
      ?{domain:'entity',id:event.entity}
      :event.type==='impact'
      ?{domain:'body',id:event.a}
      :{domain:'entity',id:event.mechanism};
    return this.append({
      tick,timeSeconds:event.time,source,
      ...(event.type==='impact'?{
        target:event.b==='ground'?{domain:'ground' as const,id:'ground'}:{domain:'body' as const,id:event.b},
      }:{}),
      ...(causeId?{causeId}:{}),effect:{kind:'event',event},
    });
  }

  snapshot(tick:number,timeSeconds:number,afterSequence=0):WorldInteractionGraph{
    if(!Number.isSafeInteger(afterSequence)||afterSequence<0)throw new RangeError('World interaction cursor must be non-negative');
    const all:WorldInteraction[]=[];
    for(let i=0;i<this.count;i++){
      const interaction=this.ring[(this.head+i)%this.capacity]!;
      if(interaction.sequence>afterSequence)all.push(interaction);
    }
    return Object.freeze({
      schema:WORLD_INTERACTION_IR_VERSION,convention,tick,timeSeconds,
      firstSequence:this.count?this.ring[this.head]!.sequence:this.next,
      afterSequence,nextSequence:this.next,dropped:this.dropped,
      interactions:Object.freeze(all),
    });
  }
}

/** Audio/replay reads exact committed events; no new sound physics or extra RNG. */
export function eventsFromWorldInteractions(graph:WorldInteractionGraph):readonly EngineEvent[]{
  validateWorldInteractionGraph(graph);
  return Object.freeze(graph.interactions.flatMap(record=>
    record.effect.kind==='event'?[record.effect.event]:[]));
}

/** Reject untyped/incomplete projections before publishing to Render IR / CAS. */
export function validateWorldInteractionGraph(graph:WorldInteractionGraph):WorldInteractionGraph{
  if(graph.schema!==WORLD_INTERACTION_IR_VERSION||graph.convention.handedness!=='right'||
    graph.convention.up!=='+Y'||graph.convention.position!=='m'||graph.convention.time!=='s'||
    graph.convention.angle!=='rad')fail('unsupported World Interaction IR schema/convention');
  finite(graph.timeSeconds,'graph time');
  if(!Number.isSafeInteger(graph.tick)||graph.tick<0||!Number.isSafeInteger(graph.firstSequence)||
     !Number.isSafeInteger(graph.afterSequence)||graph.afterSequence<0||
     !Number.isSafeInteger(graph.nextSequence)||graph.firstSequence>graph.nextSequence||
     !Number.isSafeInteger(graph.dropped)||graph.dropped<0)
    fail('invalid graph cursor');
  let previous=0;
  const retained=new Set<number>();
  for(const item of graph.interactions){
    const expectedLaw=item.effect.kind==='event'
      ?WORLD_INTERACTION_LAWS[item.effect.event.type]:WORLD_INTERACTION_LAWS[item.effect.kind];
    if(item.law!==expectedLaw)fail('interaction law contradicts its committed effect');
    id(item.source.id,'graph source');
    if(!['body','ground','surface','environment','entity'].includes(item.source.domain))
      fail('invalid graph source domain');
    if(item.target){
      id(item.target.id,'graph target');
      if(!['body','ground','surface','environment','entity'].includes(item.target.domain))
        fail('invalid graph target domain');
    }
    finite(item.timeSeconds,'interaction time');
    validateEffect(item.effect);
    if(item.schema!==WORLD_INTERACTION_IR_VERSION||item.sequence<=previous||
       item.sequence<graph.firstSequence||item.sequence>=graph.nextSequence||
       item.id!=='wi:1:'+item.sequence)fail('unordered or invalid interaction identity');
    if(item.tick>graph.tick||item.timeSeconds>graph.timeSeconds+1e-9)
      fail('interaction occurs after the graph');
    if(item.causeId){
      const cause=Number(item.causeId.slice(5));
      if(!Number.isSafeInteger(cause)||cause>=item.sequence||
         (cause>=Math.max(graph.firstSequence,graph.afterSequence+1)&&!retained.has(cause)))
        fail('causal parent is missing or follows its effect');
    }
    retained.add(item.sequence);
    previous=item.sequence;
  }
  return graph;
}
