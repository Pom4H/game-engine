import type {Vec3} from '../math.js';
import {compareIds} from '../world/locations.js';

export type AcousticSourceMode='continuous'|'transient';
export interface AcousticSource{
  readonly id:string;readonly mode:AcousticSourceMode;readonly position:Vec3;readonly energy:number;readonly cost:number;
  readonly priority?:number;readonly maxDistance?:number;readonly protected?:boolean;readonly cause?:string;
}
export interface AcousticListener{readonly position:Vec3}
export interface AudioSceneBudget{readonly maxSources:number;readonly maxCost:number}
export interface AdmittedAcousticSource extends AcousticSource{readonly distance:number;readonly score:number}
export interface AudioSceneFrame{readonly admitted:readonly AdmittedAcousticSource[];readonly rejected:readonly string[];readonly cost:number}
export class AudioScene{
  constructor(readonly budget:AudioSceneBudget={maxSources:64,maxCost:16}){
    if(!Number.isSafeInteger(budget.maxSources)||budget.maxSources<1||!Number.isFinite(budget.maxCost)||budget.maxCost<=0)throw new RangeError('Invalid audio scene budget');
  }
  select(listener:AcousticListener,sources:readonly AcousticSource[]):AudioSceneFrame{
    if(!listener.position.every(Number.isFinite))throw new RangeError('Invalid listener position');const seen=new Set<string>(),candidates:AdmittedAcousticSource[]=[];
    for(const source of sources){
      if(!source.id||seen.has(source.id)||!source.position.every(Number.isFinite)||!Number.isFinite(source.energy)||source.energy<0||!Number.isFinite(source.cost)||source.cost<=0)throw new TypeError('Invalid acoustic source');seen.add(source.id);
      const distance=Math.hypot(source.position[0]-listener.position[0],source.position[1]-listener.position[1],source.position[2]-listener.position[2]),maxDistance=source.maxDistance??Math.max(8,Math.sqrt(source.energy+1)*24);
      if(distance>maxDistance&&!source.protected)continue;
      const score=(source.protected?1e9:0)+(source.priority??0)*1e6+source.energy/(1+distance*distance);
      candidates.push({...source,distance,score});
    }
    candidates.sort((a,b)=>b.score-a.score||a.cost-b.cost||compareIds(a.id,b.id));
    const admitted:AdmittedAcousticSource[]=[],rejected:string[]=[];let cost=0;
    for(const source of candidates){if(admitted.length<this.budget.maxSources&&cost+source.cost<=this.budget.maxCost){admitted.push(source);cost+=source.cost;}else rejected.push(source.id);}
    return{admitted,rejected,cost};
  }
}
