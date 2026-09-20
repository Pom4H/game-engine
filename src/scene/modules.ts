import {EngineKernel,type EngineModule,type SimulationTier} from '../core/kernel.js';
import type {EnvironmentState} from '../environment/types.js';
import type {Vec3} from '../math.js';
import type {EntitySpec,SceneSnapshot} from './types.js';

export interface SceneModuleContext extends SceneSnapshot {readonly environment:EnvironmentState;readonly resources:ReadonlyMap<string,unknown>}
export type SceneCommand={type:'spawn';entity:EntitySpec}|{type:'remove';id:string}|{type:'velocity';id:string;value:Vec3}|{type:'resource';key:string;value:unknown};
export type SystemAction='weather'|'surfaces'|'animation'|'physics'|'deformation'|'surface-contacts'|'events'|'fracture'|'cleanup'|'clock';
export type InternalCommand=SceneCommand|{type:'system';action:SystemAction;deltaSeconds:number};

const ALL_TIERS:readonly SimulationTier[]=['detailed','active','aggregate','dormant'];
const ACTIVE_TIERS:readonly SimulationTier[]=['detailed','active'];
const SURFACE_TIERS:readonly SimulationTier[]=['detailed','active','aggregate'];
const DETAILED_TIERS:readonly SimulationTier[]=['detailed'];

export function sceneKernel():EngineKernel<SceneModuleContext,InternalCommand>{
  const kernel=new EngineKernel<SceneModuleContext,InternalCommand>();
  const definitions=[
    {action:'weather',phase:'input',rateHz:10,reads:[],writes:['environment'],after:[],tiers:ALL_TIERS},
    {action:'surfaces',phase:'input',rateHz:30,reads:['environment','entities'],writes:['surface-state'],after:['weather'],tiers:SURFACE_TIERS},
    {action:'animation',phase:'simulate',rateHz:60,reads:['surface-state'],writes:['entities','animation'],after:[],tiers:ACTIVE_TIERS},
    {action:'physics',phase:'simulate',rateHz:60,reads:['surface-state','animation'],writes:['entities','contacts'],after:['animation'],tiers:ACTIVE_TIERS},
    {action:'deformation',phase:'simulate',rateHz:60,reads:['contacts','entities'],writes:['entities','deformation'],after:['physics'],tiers:ACTIVE_TIERS},
    {action:'surface-contacts',phase:'commit',rateHz:60,reads:['surface-state','animation','contacts'],writes:['entities','surface-contacts'],after:[],tiers:DETAILED_TIERS},
    {action:'events',phase:'commit',rateHz:60,reads:['contacts'],writes:['events'],after:['surface-contacts'],tiers:ACTIVE_TIERS},
    {action:'fracture',phase:'commit',rateHz:60,reads:['contacts'],writes:['entities','events'],after:['events'],tiers:ACTIVE_TIERS},
    {action:'cleanup',phase:'commit',rateHz:10,reads:[],writes:['entities'],after:['fracture'],tiers:ALL_TIERS},
    {action:'clock',phase:'commit',rateHz:60,reads:[],writes:['time'],after:['cleanup'],tiers:ALL_TIERS},
  ] as const;
  for(const definition of definitions){
    const {action,phase,rateHz,reads,writes,after,tiers}=definition;
    kernel.use({
      id:`engine:${action}`,phase,rateHz,context:'none',reads,writes,tiers,
      after:after.map(id=>`engine:${id}`),
      run:(_context,frame)=>[{type:'system',action,deltaSeconds:frame.deltaSeconds}],
    });
  }
  return kernel;
}
export type SceneModule=EngineModule<SceneModuleContext,SceneCommand>;
