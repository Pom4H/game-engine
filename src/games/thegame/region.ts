import type {Vec3} from '../../math.js';
import {populationCells,populationProjection} from '../../network/population.js';
import type {Frame,Stamp} from '../../network/projection.js';
import type {AuthorityAdapter} from '../../network/authority.js';
import {hash01,OpenWorld,SEA_LEVEL,WORLD_REVISION} from './world.js';

export const THEGAME_REGION_CAPABILITY='world.region.v1';
export const THEGAME_REGION_REVISION='thegame-region/1';

export interface ThegameRegionSpec {
 readonly seed:number;
 readonly x:number;
 readonly z:number;
 readonly sizeM:number;
 readonly population:number;
 readonly cellM:number;
 readonly stepSeconds:number;
}

const finite=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value);
const integer=(value:unknown,min:number,max:number):value is number=>finite(value)&&Number.isSafeInteger(value)&&value>=min&&value<=max;

export function readThegameRegionSpec(raw:unknown):Readonly<ThegameRegionSpec>{
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new TypeError('Expected region object');
 const r=raw as Record<string,unknown>;
 if(Object.keys(r).some(key=>!['seed','x','z','sizeM','population','cellM','stepSeconds'].includes(key)))throw new TypeError('Unknown region field');
 const spec={
  seed:r.seed??29,x:r.x??0,z:r.z??0,sizeM:r.sizeM??2048,
  population:r.population??4096,cellM:r.cellM??128,stepSeconds:r.stepSeconds??1,
 };
 if(!integer(spec.seed,0,0xffffffff)||!integer(spec.x,-4096,4096)||!integer(spec.z,-4096,4096)||
    !integer(spec.sizeM,256,8192)||!integer(spec.population,0,200_000)||!integer(spec.cellM,32,512)||
    !finite(spec.stepSeconds)||spec.stepSeconds<.1||spec.stepSeconds>60)throw new RangeError('Invalid region configuration');
 if(spec.sizeM%spec.cellM!==0)throw new RangeError('Region size must be divisible by population cell size');
 return Object.freeze(spec);
}

const smooth=(a:number,b:number,t:number)=>a+(b-a)*(t*t*(3-2*t));
const commute=(hour:number,start:number,end:number)=>{
 if(hour<=start)return 0;if(hour>=end)return 1;
 return smooth(0,1,(hour-start)/(end-start));
};

/** Distant population authority.
 * Residents are identities, not heap objects: every position is reconstructed from
 * seed + region + resident index + tick. A worker migration therefore needs only
 * the causal tick, not a serialized resident heap. */
export class ThegameRegionAuthority implements AuthorityAdapter {
 readonly spec:Readonly<ThegameRegionSpec>;
 readonly world:OpenWorld;
 tick:number;
 time:number;
 constructor(raw:Partial<ThegameRegionSpec>|ThegameRegionSpec={},startTick=0){
  this.spec=readThegameRegionSpec(raw);
  if(!integer(startTick,0,Number.MAX_SAFE_INTEGER))throw new RangeError('Invalid region start tick');
  this.tick=startTick;this.time=startTick*this.spec.stepSeconds;
  this.world=new OpenWorld(this.spec.seed,4);
 }
 step(dt:number):void{
  if(!finite(dt)||Math.abs(dt-this.spec.stepSeconds)>1e-9)throw new RangeError('Region step must match configured cadence');
  this.tick++;this.time=this.tick*this.spec.stepSeconds;
 }
 private anchor(index:number,salt:number):readonly [number,number]{
  const ox=this.spec.x*this.spec.sizeM,oz=this.spec.z*this.spec.sizeM,m=this.spec.sizeM*.08,span=this.spec.sizeM-2*m;
  return[
   ox+m+hash01(index,this.spec.x,salt,this.spec.seed)*span,
   oz+m+hash01(index,this.spec.z,salt+1,this.spec.seed)*span,
  ];
 }
 residentPosition(index:number,tick=this.tick):Vec3{
  if(!integer(index,0,this.spec.population-1))throw new RangeError('Invalid resident');
  if(!integer(tick,0,Number.MAX_SAFE_INTEGER))throw new RangeError('Invalid region tick');
  const home=this.anchor(index,100),work=this.anchor(index,200);
  const seconds=tick*this.spec.stepSeconds+hash01(index,this.spec.x,this.spec.z,this.spec.seed)*1800;
  const hour=((seconds/3600)%24+24)%24;
  let t=0;
  if(hour>=7&&hour<9)t=commute(hour,7,9);
  else if(hour>=9&&hour<17)t=1;
  else if(hour>=17&&hour<19)t=1-commute(hour,17,19);
  const sway=(hash01(index,77,this.spec.z,this.spec.seed)-.5)*18*Math.sin(seconds/37+index);
  const x=home[0]+(work[0]-home[0])*t+sway;
  const z=home[1]+(work[1]-home[1])*t+sway*.35;
  const y=Math.max(SEA_LEVEL,this.world.vertexHeight(x,z));
  return[x,y,z];
 }
 private *positions():Generator<Vec3>{
  for(let i=0;i<this.spec.population;i++)yield this.residentPosition(i);
 }
 capture(at:Stamp):Frame{
  if(at.tick!==this.tick||Math.abs(at.time-this.time)>1e-9)throw new TypeError('Region capture stamp does not match authority clock');
  return populationCells(at,this.positions(),this.spec.cellM,16);
 }
 dump(){
  return Object.freeze({
   revision:THEGAME_REGION_REVISION,
   world:WORLD_REVISION,
   spec:this.spec,
   tick:this.tick,
   time:this.time,
   reconstructable:true,
  });
 }
 inspect(){
  return{revision:THEGAME_REGION_REVISION,tick:this.tick,time:this.time,population:this.spec.population,region:[this.spec.x,this.spec.z],projection:populationProjection.name};
 }
 dispose():void{this.world.dispose();}
}
