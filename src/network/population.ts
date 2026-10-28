import type {Vec3} from '../math.js';
import {projection,scalar,vector3,type Stamp} from './projection.js';
export const populationProjection=projection('population-cells/v1',{position:vector3('step'),count:scalar('step',0,1e9)},{maxEntities:4096});
/** Explicit aggregate projection, not fictitious distant NPCs. Rebuild on population revision/cadence,
 * once for a publication cohort. Different storeys/terrain elevations occupy different cells. */
export function populationCells(at:Stamp,positions:Iterable<Vec3>,cellM=128,heightM=16){
 if(!Number.isFinite(cellM)||cellM<=0||!Number.isFinite(heightM)||heightM<=0)throw new RangeError('Invalid population cells');
 const cells=new Map<string,{id:string;data:{position:Vec3;count:number}}>();
 for(const p of positions){if(p.length!==3||p.some(x=>!Number.isFinite(x)))throw new TypeError('Invalid resident position');
  const x=Math.floor(p[0]/cellM),y=Math.floor(p[1]/heightM),z=Math.floor(p[2]/cellM),id=`${x}:${y}:${z}`;let cell=cells.get(id);
  if(!cell){if(cells.size>=populationProjection.maxEntities)throw new RangeError('Population projection budget exceeded');cell={id,data:{position:[(x+.5)*cellM,(y+.5)*heightM,(z+.5)*cellM],count:0}};cells.set(id,cell);}cell.data.count++;
 }
 return populationProjection.capture(at,cells.values());
}
