import {EngineKernel,type EngineModule} from '../core/kernel.js';
import type {EnvironmentState} from '../environment/types.js';
import type {Vec3} from '../math.js';
import type {EntitySpec,SceneSnapshot} from './types.js';
export interface SceneModuleContext extends SceneSnapshot {readonly environment:EnvironmentState;readonly resources:ReadonlyMap<string,unknown>}
export type SceneCommand={type:'spawn';entity:EntitySpec}|{type:'remove';id:string}|{type:'velocity';id:string;value:Vec3}|{type:'resource';key:string;value:unknown};
export type SystemAction='weather'|'surfaces'|'physics'|'events'|'fracture'|'cleanup'|'clock';
export type InternalCommand=SceneCommand|{type:'system';action:SystemAction};
export function sceneKernel():EngineKernel<SceneModuleContext,InternalCommand>{
  const kernel=new EngineKernel<SceneModuleContext,InternalCommand>();
  const definitions=[
    ['weather','input',[],['environment'],[]],
    ['surfaces','input',['environment','entities'],['winter'],['weather']],
    ['physics','simulate',['winter'],['entities','contacts'],[]],
    ['events','commit',['contacts'],['events'],[]],
    ['fracture','commit',['contacts'],['entities','events'],['events']],
    ['cleanup','commit',[],['entities'],['fracture']],
    ['clock','commit',[],['time'],['cleanup']],
  ] as const;
  for(const [action,phase,reads,writes,after] of definitions)kernel.use({id:`engine:${action}`,phase,rateHz:60,reads,writes,after:after.map(id=>`engine:${id}`),run:()=>[{type:'system',action}]});
  return kernel;
}
export type SceneModule=EngineModule<SceneModuleContext,SceneCommand>;
