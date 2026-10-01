import type {Frame} from '../../network/projection.js';
import {populationProjection} from '../../network/population.js';
import {climateAt,hash01,hash32,OpenWorld,SEA_LEVEL} from './world.js';

export interface AmbientPerson {
 readonly id:string;
 readonly data:{
  readonly position:readonly [number,number,number];
  readonly yaw:number;
  readonly phase:number;
  readonly speed:number;
  readonly kind:2;
 };
}

const CELL_M=128;
const SOURCE_RADIUS_M=640;
const SLOT_THRESHOLDS=[1,4,12,32] as const;
const fallbackDensity=(seed:number,cx:number,cz:number):number=>{
 const x=cx*CELL_M+CELL_M/2,z=cz*CELL_M+CELL_M/2;
 const biome=climateAt(seed,x,z).biome;
 return biome==='city'?18:biome==='suburbs'?10:biome==='coast'?5:
  biome==='grassland'?3:biome==='forest'?2:biome==='desert'?1:biome==='mountains'?1:0;
};
const cellKey=(cx:number,cz:number)=>`${cx}:${cz}`;

function sourceCounts(frames:readonly Frame[]):Map<string,number>{
 const counts=new Map<string,number>();
 for(const input of frames){
  const frame=populationProjection.read(input);
  for(const row of frame.rows){
   const x=row.values[0]!,z=row.values[2]!,count=row.values[3]!;
   const key=cellKey(Math.floor(x/CELL_M),Math.floor(z/CELL_M));
   counts.set(key,(counts.get(key)??0)+count);
  }
 }
 return counts;
}

function candidate(
 world:OpenWorld,cx:number,cz:number,slot:number,tick:number,
):AmbientPerson|undefined{
 const seed=world.seed,time=tick/60,urban=Math.max(Math.abs(cx*CELL_M+64),Math.abs(cz*CELL_M+64))<448;
 const a=hash01(cx,cz,slot*17+3,seed),b=hash01(cx,cz,slot*17+5,seed),c=hash01(cx,cz,slot*17+7,seed);
 const speed=.75+c*.9,phase=(time*speed+a*53)%(Math.PI*2000);
 let x:number,z:number,yaw:number;
 if(urban){
  const horizontal=(hash32(cx,cz,slot,seed)&1)===0,side=(hash32(cx,cz,slot+101,seed)&1)?1:-1;
  const centerX=cx*CELL_M+64,centerZ=cz*CELL_M+64,travel=((time*speed*1.7+a*CELL_M)%CELL_M)-CELL_M/2;
  if(horizontal){x=centerX+travel;z=Math.round((centerZ+(b-.5)*48)/64)*64+side*8.25;yaw=travel>=0?Math.PI/2:-Math.PI/2;}
  else{x=Math.round((centerX+(b-.5)*48)/64)*64+side*8.25;z=centerZ+travel;yaw=travel>=0?0:Math.PI;}
 }else{
  const angle=a*Math.PI*2,turn=time*(.035+b*.025)+slot;
  x=cx*CELL_M+64+Math.cos(angle)*28+Math.sin(turn)*12;
  z=cz*CELL_M+64+Math.sin(angle)*28+Math.cos(turn*.93)*12;
  yaw=Math.atan2(Math.sin(turn*.93),Math.cos(turn));
 }
 const ground=Math.max(SEA_LEVEL,world.ground(x,z).y);
 if(world.blocked(x,ground,z,1.8,.28))return;
 return{id:`crowd:${cx}:${cz}:${slot}`,data:{position:[x,ground,z],yaw,phase,speed,kind:2}};
}

/** Refines aggregate population into bounded, stable presentation residents around one player.
 * Meshwork counts override local estimates, but IDs/trajectories are derived from the same
 * global cell coordinates. Losing the distributed source therefore changes density, not identity. */
export function materializeCrowd(
 world:OpenWorld,
 frames:readonly Frame[],
 self:Readonly<{x:number;z:number}>,
 tick:number,
 limit=24,
):readonly AmbientPerson[]{
 if(!Number.isSafeInteger(tick)||tick<0||!Number.isSafeInteger(limit)||limit<0||limit>48)throw new RangeError('Invalid crowd materialization budget');
 const remote=sourceCounts(frames),centerX=Math.floor(self.x/CELL_M),centerZ=Math.floor(self.z/CELL_M),radius=Math.ceil(SOURCE_RADIUS_M/CELL_M);
 const cells:{cx:number;cz:number;count:number;distance:number}[]=[];
 for(let dz=-radius;dz<=radius;dz++)for(let dx=-radius;dx<=radius;dx++){
  const cx=centerX+dx,cz=centerZ+dz,x=cx*CELL_M+64,z=cz*CELL_M+64,distance=Math.hypot(x-self.x,z-self.z);
  if(distance>SOURCE_RADIUS_M+CELL_M*.75)continue;
  const key=cellKey(cx,cz),count=remote.get(key)??fallbackDensity(world.seed,cx,cz);
  if(count>0)cells.push({cx,cz,count,distance});
 }
 cells.sort((a,b)=>a.distance-b.distance||a.cx-b.cx||a.cz-b.cz);
 const out:AmbientPerson[]=[];
 for(const cell of cells){
  for(let slot=0;slot<SLOT_THRESHOLDS.length&&out.length<limit;slot++){
   if(cell.count<SLOT_THRESHOLDS[slot]!)continue;
   const person=candidate(world,cell.cx,cell.cz,slot,tick);if(person)out.push(person);
  }
  if(out.length>=limit)break;
 }
 return Object.freeze(out);
}
