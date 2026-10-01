import type {Frame} from '../../network/projection.js';
import {populationProjection} from '../../network/population.js';
import {
 characterState,stepCharacter,type CharacterState,type CharacterTuning,
} from '../../runtime/character-motor.js';
import {ambientPersonAt,materializeCrowd,type AmbientPerson} from './crowd.js';
import {residentIntent,residentProfile,type ResidentIntent,type ResidentProfile} from './resident-life.js';
import type {OpenWorld} from './world.js';

export interface AuthoritativeNpc {
 readonly id:string;
 readonly state:CharacterState;
 intent:ResidentIntent;
 promotedAt:number;
 sourceTick:number;
}
export interface ResidentMemory {
 possessions:number;
 lastPossessedTick?:number;
 lastReleasedTick?:number;
 lastActivity:string;
}
export interface ResidentPossession {
 readonly id:string;
 readonly state:CharacterState;
 readonly profile:ResidentProfile;
 readonly intent:ResidentIntent;
 readonly memory:Readonly<ResidentMemory>;
}
export interface NpcAuthorityStats {
 active:number;
 possessed:number;
 memories:number;
 promotions:number;
 demotions:number;
 forcedDemotions:number;
 possessions:number;
 releases:number;
 refreshes:number;
 populationFrames:number;
}

const PROMOTE_RADIUS=80;
const DEMOTE_RADIUS=120;
const FORCE_DEMOTE_RADIUS=180;
const MAX_ACTIVE=16;
const MAX_MEMORIES=256;
const REFRESH_TICKS=12;
const COARSE_HANDOFF_ERROR=1.5;

const distance=(a:Readonly<{x:number;z:number}>,b:Readonly<{x:number;z:number}>)=>Math.hypot(a.x-b.x,a.z-b.z);
const stateFrom=(person:AmbientPerson):CharacterState=>{
 const p=characterState(person.data.position[0],person.data.position[1],person.data.position[2],person.data.yaw);
 p.lookYaw=person.data.yaw;p.phase=person.data.phase;p.speed=person.data.speed;
 return p;
};
const copyState=(state:CharacterState):CharacterState=>({...state});

export class NearbyNpcAuthority {
 private readonly active=new Map<string,AuthoritativeNpc>();
 private readonly possessed=new Set<string>();
 private readonly memories=new Map<string,ResidentMemory>();
 private unavailable=new Set<string>();
 private population:readonly Frame[]=[];
 private nextRefreshTick=0;
 private promotions=0;
 private demotions=0;
 private forcedDemotions=0;
 private possessions=0;
 private releases=0;
 private refreshes=0;
 constructor(
  readonly world:OpenWorld,
  readonly tuning:CharacterTuning,
 ){}

 setPopulation(frames:readonly Frame[]):void{
  if(!Array.isArray(frames)||frames.length>64)throw new RangeError('Population frame budget exceeded');
  this.population=Object.freeze(frames.map(frame=>populationProjection.read(frame)));
 }
 setUnavailable(ids:Iterable<string>):void{
  this.unavailable=new Set(ids);
  for(const id of this.unavailable)this.active.delete(id);
 }

 private remember(id:string,tick:number,kind:'possess'|'release'):ResidentMemory{
  let memory=this.memories.get(id);
  if(!memory){
   if(this.memories.size>=MAX_MEMORIES)this.memories.delete(this.memories.keys().next().value!);
   memory={possessions:0,lastActivity:residentIntent(this.world.seed,id,tick).activity};this.memories.set(id,memory);
  }else{this.memories.delete(id);this.memories.set(id,memory);}
  memory.lastActivity=residentIntent(this.world.seed,id,tick).activity;
  if(kind==='possess'){memory.possessions++;memory.lastPossessedTick=tick;}
  else memory.lastReleasedTick=tick;
  return memory;
 }

 private possession(id:string,state:CharacterState,tick:number):ResidentPossession{
  const intent=residentIntent(this.world.seed,id,tick),profile=residentProfile(this.world.seed,id),memory=this.remember(id,tick,'possess');
  this.possessed.add(id);this.possessions++;
  return{id,state,profile,intent,memory:Object.freeze({...memory})};
 }

 acquire(around:Readonly<{x:number;z:number}>,tick:number):ResidentPossession|undefined{
  if(!Number.isSafeInteger(tick)||tick<0)throw new RangeError('Invalid possession tick');
  for(const person of materializeCrowd(this.world,this.population,around,tick,48)){
   if(this.possessed.has(person.id)||this.unavailable.has(person.id))continue;
   const npc=this.active.get(person.id);if(npc)this.active.delete(person.id);
   return this.possession(person.id,npc?.state??stateFrom(person),tick);
  }
 }

 reclaim(id:string,fallback:CharacterState|undefined,tick:number):ResidentPossession|undefined{
  if(this.possessed.has(id)||this.unavailable.has(id))return;
  const npc=this.active.get(id);if(npc)this.active.delete(id);
  const ambient=ambientPersonAt(this.world,id,tick);
  const state=npc?.state??(fallback?copyState(fallback):ambient?stateFrom(ambient):undefined);
  if(!state)return;
  return this.possession(id,state,tick);
 }

 release(id:string,state:CharacterState,tick:number):void{
  if(!this.possessed.delete(id))return;
  this.releases++;this.remember(id,tick,'release');
  if(this.unavailable.has(id)||this.active.size>=MAX_ACTIVE)return;
  this.active.set(id,{id,state:copyState(state),intent:residentIntent(this.world.seed,id,tick),promotedAt:tick,sourceTick:tick});
 }

 private nearest(players:readonly Readonly<{id:string;state:CharacterState}>[],position:Readonly<{x:number;z:number}>):number{
  let best=Infinity;for(const player of players)best=Math.min(best,distance(player.state,position));return best;
 }

 refresh(playersInput:Iterable<Readonly<{id:string;state:CharacterState}>>,tick:number):void{
  if(!Number.isSafeInteger(tick)||tick<0)throw new RangeError('Invalid NPC authority tick');
  if(tick<this.nextRefreshTick)return;
  this.nextRefreshTick=tick+REFRESH_TICKS;this.refreshes++;
  const players=[...playersInput].sort((a,b)=>a.id.localeCompare(b.id));
  if(!players.length){this.active.clear();return;}

  const candidates=new Map<string,{person:AmbientPerson;distance:number}>();
  for(const player of players){
   for(const person of materializeCrowd(this.world,this.population,player.state,tick,24)){
    if(this.possessed.has(person.id)||this.unavailable.has(person.id))continue;
    const d=distance(player.state,{x:person.data.position[0],z:person.data.position[2]});
    const previous=candidates.get(person.id);if(!previous||d<previous.distance)candidates.set(person.id,{person,distance:d});
   }
  }

  for(const [id,npc] of [...this.active]){
   const nearest=this.nearest(players,npc.state);
   if(nearest<=DEMOTE_RADIUS)continue;
   const coarse=ambientPersonAt(this.world,id,tick);
   const error=coarse?Math.hypot(
    npc.state.x-coarse.data.position[0],
    npc.state.y-coarse.data.position[1],
    npc.state.z-coarse.data.position[2],
   ):Infinity;
   if(error<=COARSE_HANDOFF_ERROR||nearest>FORCE_DEMOTE_RADIUS){
    this.active.delete(id);this.demotions++;if(nearest>FORCE_DEMOTE_RADIUS)this.forcedDemotions++;
   }
  }

  const ordered=[...candidates.values()]
   .filter(candidate=>candidate.distance<=PROMOTE_RADIUS)
   .sort((a,b)=>a.distance-b.distance||a.person.id.localeCompare(b.person.id));

  for(const candidate of ordered){
   if(this.active.has(candidate.person.id)||this.possessed.has(candidate.person.id)||this.unavailable.has(candidate.person.id)||this.active.size>=MAX_ACTIVE)continue;
   this.active.set(candidate.person.id,{
    id:candidate.person.id,state:stateFrom(candidate.person),
    intent:residentIntent(this.world.seed,candidate.person.id,tick),promotedAt:tick,sourceTick:tick,
   });
   this.promotions++;
  }
 }

 step(tick:number):void{
  if(!Number.isSafeInteger(tick)||tick<0)throw new RangeError('Invalid NPC authority tick');
  for(const npc of this.active.values()){
   npc.intent=residentIntent(this.world.seed,npc.id,tick);
   const dx=npc.intent.destination[0]-npc.state.x,dz=npc.intent.destination[1]-npc.state.z,d=Math.hypot(dx,dz);
   const yaw=d>.05?Math.atan2(dx,dz):npc.state.lookYaw;
   stepCharacter(npc.state,{forward:npc.intent.speed>0&&d>.15?1:0,right:0,yaw,sprint:false,jump:false},this.world,1/60,this.tuning);
   npc.sourceTick=tick;
  }
 }

 rowsAround(self:Readonly<{x:number;z:number}>,radius=512,limit=MAX_ACTIVE){
  const rows:{id:string;data:{position:readonly[number,number,number];yaw:number;phase:number;speed:number;kind:number}}[]=[];
  for(const npc of this.active.values()){
   if(rows.length>=limit)break;
   if(distance(self,npc.state)>radius)continue;
   const p=npc.state;rows.push({id:npc.id,data:{position:[p.x,p.y,p.z],yaw:p.yaw,phase:p.phase,speed:p.speed,kind:1}});
  }
  return rows;
 }

 intent(id:string,tick:number):ResidentIntent{return residentIntent(this.world.seed,id,tick);}
 profile(id:string):ResidentProfile{return residentProfile(this.world.seed,id);}
 memory(id:string):Readonly<ResidentMemory>|undefined{const value=this.memories.get(id);return value?Object.freeze({...value}):undefined;}
 has(id:string):boolean{return this.active.has(id)||this.possessed.has(id);}
 isPossessed(id:string):boolean{return this.possessed.has(id);}
 get size():number{return this.active.size;}
 inspect():NpcAuthorityStats{return{
  active:this.active.size,possessed:this.possessed.size,memories:this.memories.size,
  promotions:this.promotions,demotions:this.demotions,forcedDemotions:this.forcedDemotions,
  possessions:this.possessions,releases:this.releases,refreshes:this.refreshes,populationFrames:this.population.length,
 };}
 dispose():void{this.active.clear();this.possessed.clear();this.memories.clear();this.unavailable.clear();this.population=[];}
}
