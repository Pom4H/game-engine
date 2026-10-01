import type {Frame} from '../../network/projection.js';
import {populationProjection} from '../../network/population.js';
import {
 characterState,stepCharacter,type CharacterState,type CharacterTuning,
} from '../../runtime/character-motor.js';
import {ambientPersonAt,materializeCrowd,type AmbientPerson} from './crowd.js';
import type {OpenWorld} from './world.js';

export interface AuthoritativeNpc {
 readonly id:string;
 readonly state:CharacterState;
 promotedAt:number;
 sourceTick:number;
}
export interface NpcAuthorityStats {
 active:number;
 promotions:number;
 demotions:number;
 forcedDemotions:number;
 refreshes:number;
 populationFrames:number;
}

const PROMOTE_RADIUS=80;
const DEMOTE_RADIUS=120;
const FORCE_DEMOTE_RADIUS=180;
const MAX_ACTIVE=16;
const REFRESH_TICKS=12;
const COARSE_HANDOFF_ERROR=1.5;

const distance=(a:Readonly<{x:number;z:number}>,b:Readonly<{x:number;z:number}>)=>Math.hypot(a.x-b.x,a.z-b.z);
const stateFrom=(person:AmbientPerson):CharacterState=>{
 const p=characterState(person.data.position[0],person.data.position[1],person.data.position[2],person.data.yaw);
 p.lookYaw=person.data.yaw;p.phase=person.data.phase;p.speed=person.data.speed;
 return p;
};

/** Bounded promotion layer between aggregate population and player-critical authority.
 * Ambient identities are stable. Near a player the same identity receives a real
 * CharacterState and is stepped at 60 Hz; away from every player it folds back into
 * the reconstructable crowd cause. Meshwork is never on the player tick path. */
export class NearbyNpcAuthority {
 private readonly active=new Map<string,AuthoritativeNpc>();
 private population:readonly Frame[]=[];
 private nextRefreshTick=0;
 private promotions=0;
 private demotions=0;
 private forcedDemotions=0;
 private refreshes=0;
 constructor(
  readonly world:OpenWorld,
  readonly tuning:CharacterTuning,
 ){}

 setPopulation(frames:readonly Frame[]):void{
  if(!Array.isArray(frames)||frames.length>64)throw new RangeError('Population frame budget exceeded');
  this.population=Object.freeze(frames.map(frame=>populationProjection.read(frame)));
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
    const d=distance(player.state,{x:person.data.position[0],z:person.data.position[2]});
    const previous=candidates.get(person.id);if(!previous||d<previous.distance)candidates.set(person.id,{person,distance:d});
   }
  }

  const ordered=[...candidates.values()]
   .filter(candidate=>candidate.distance<=PROMOTE_RADIUS)
   .sort((a,b)=>a.distance-b.distance||a.person.id.localeCompare(b.person.id));

  for(const candidate of ordered){
   if(this.active.has(candidate.person.id)||this.active.size>=MAX_ACTIVE)continue;
   this.active.set(candidate.person.id,{id:candidate.person.id,state:stateFrom(candidate.person),promotedAt:tick,sourceTick:tick});
   this.promotions++;
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
 }

 step(tick:number):void{
  if(!Number.isSafeInteger(tick)||tick<0)throw new RangeError('Invalid NPC authority tick');
  for(const npc of this.active.values()){
   const target=ambientPersonAt(this.world,npc.id,tick+30); // deterministic 0.5 s look-ahead intent
   if(!target)continue;
   const dx=target.data.position[0]-npc.state.x,dz=target.data.position[2]-npc.state.z,d=Math.hypot(dx,dz);
   const yaw=d>.05?Math.atan2(dx,dz):npc.state.lookYaw;
   stepCharacter(npc.state,{forward:d>.15?1:0,right:0,yaw,sprint:false,jump:false},this.world,1/60,this.tuning);
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

 has(id:string):boolean{return this.active.has(id);}
 get size():number{return this.active.size;}
 inspect():NpcAuthorityStats{return{
  active:this.active.size,promotions:this.promotions,demotions:this.demotions,
  forcedDemotions:this.forcedDemotions,refreshes:this.refreshes,populationFrames:this.population.length,
 };}
 dispose():void{this.active.clear();this.population=[];}
}
