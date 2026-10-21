/** Recovered from game-engine 9c564556275b1a50b366e92034910ade90b68986; current Engine adapter. */
import type {Frame} from '../../../src/network/projection.js';
import {populationProjection} from '../../../src/network/population.js';
import {climateAt,OpenWorld,SEA_LEVEL} from './world.js';
import {residentPose} from './resident-life.js';

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
 const id=`crowd:${cx}:${cz}:${slot}`,pose=residentPose(world.seed,id,tick);
 const x=pose.position[0],z=pose.position[1],ground=Math.max(SEA_LEVEL,world.ground(x,z).y);
 if(world.blocked(x,ground,z,1.8,.28))return;
 return{id,data:{position:[x,ground,z],yaw:pose.yaw,phase:pose.phase,speed:pose.speed,kind:2}};
}

export function ambientPersonAt(world:OpenWorld,id:string,tick:number):AmbientPerson|undefined{
 const match=/^crowd:(-?\d+):(-?\d+):(\d+)$/.exec(id);if(!match)return;
 const cx=Number(match[1]),cz=Number(match[2]),slot=Number(match[3]);
 if(!Number.isSafeInteger(cx)||!Number.isSafeInteger(cz)||!Number.isSafeInteger(slot)||slot<0||slot>=SLOT_THRESHOLDS.length)return;
 return candidate(world,cx,cz,slot,tick);
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
