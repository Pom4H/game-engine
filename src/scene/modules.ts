import {ENGINE_DEPTH,EngineKernel,type EngineModule,type EnginePlugin} from '../core/kernel.js';
import {ENGINE_DOMAINS,ENGINE_SLOTS} from '../core/domains.js';
import type {EnvironmentState} from '../environment/types.js';
import type {Vec3} from '../math.js';
import type {EntitySpec,SceneSnapshot} from './types.js';
import type {Scene} from './scene.js';
import type {SystemFrame} from './system-runtime.js';

export interface SceneModuleContext extends SceneSnapshot {readonly environment:EnvironmentState;readonly resources:ReadonlyMap<string,unknown>}
export type SceneCommand={type:'spawn';entity:EntitySpec}|{type:'remove';id:string}|{type:'velocity';id:string;value:Vec3}|{type:'resource';key:string;value:unknown};
export type SystemAction=string;
export type InternalCommand=SceneCommand|{type:'system';action:SystemAction;deltaSeconds:number};
export type SceneModule=EngineModule<SceneModuleContext,SceneCommand>;
export interface ScenePluginSystem{readonly id:string;readonly run:(scene:Scene,frame:SystemFrame)=>void}
export interface ScenePlugin extends EnginePlugin<SceneModuleContext,InternalCommand>{readonly systems?:readonly ScenePluginSystem[]}

export function sceneKernel():EngineKernel<SceneModuleContext,InternalCommand>{
 const kernel=new EngineKernel<SceneModuleContext,InternalCommand>();
 const definitions=[
  {action:'weather',id:'engine:weather',phase:'input',rateHz:10,reads:[],writes:['environment'],after:[],depth:{axis:ENGINE_DOMAINS.world,min:ENGINE_DEPTH.dormant}},
  {action:'surfaces',id:'engine:surfaces',phase:'input',rateHz:30,reads:['environment','entities'],writes:['surface-state'],after:['engine:weather'],depth:{axis:ENGINE_DOMAINS.world,min:ENGINE_DEPTH.aggregate}},
  {action:'animation',id:'engine:animation.aggregate',slot:ENGINE_SLOTS.agentsSimulate,phase:'simulate',rateHz:10,reads:['surface-state'],writes:['entities','animation'],after:[],depth:{axis:ENGINE_DOMAINS.agents,min:ENGINE_DEPTH.aggregate,max:ENGINE_DEPTH.active-1}},
  {action:'animation',id:'engine:animation',slot:ENGINE_SLOTS.agentsSimulate,phase:'simulate',rateHz:60,reads:['surface-state'],writes:['entities','animation'],after:[],depth:{axis:ENGINE_DOMAINS.agents,min:ENGINE_DEPTH.active}},
  // The stable slot is the future LOD/plugin seam: aggregate/full physics variants can
  // replace each other at compile time without changing downstream dependencies.
  {action:'physics',id:'engine:physics.coarse',slot:ENGINE_SLOTS.physicsStep,phase:'simulate',rateHz:30,reads:['surface-state','animation'],writes:['entities','contacts'],after:[ENGINE_SLOTS.agentsSimulate],depth:{axis:ENGINE_DOMAINS.physics,min:128,max:ENGINE_DEPTH.active-1}},
  {action:'physics',id:'engine:physics',slot:ENGINE_SLOTS.physicsStep,phase:'simulate',rateHz:60,reads:['surface-state','animation'],writes:['entities','contacts'],after:[ENGINE_SLOTS.agentsSimulate],depth:{axis:ENGINE_DOMAINS.physics,min:ENGINE_DEPTH.active}},
  {action:'vehicle-visuals',id:'engine:vehicle-visuals',phase:'simulate',rateHz:60,reads:['entities','contacts'],writes:['entities'],after:[ENGINE_SLOTS.physicsStep],depth:{axis:ENGINE_DOMAINS.render,min:ENGINE_DEPTH.aggregate}},
  {action:'deformation',id:'engine:deformation',phase:'simulate',rateHz:60,reads:['contacts','entities'],writes:['entities','deformation'],after:[ENGINE_SLOTS.physicsStep],depth:{axis:ENGINE_DOMAINS.destruction,min:ENGINE_DEPTH.active}},
  {action:'surface-contacts',id:'engine:surface-contacts',phase:'commit',rateHz:60,reads:['surface-state','animation','contacts'],writes:['entities','surface-contacts'],after:[],depth:{axis:ENGINE_DOMAINS.physics,min:ENGINE_DEPTH.detailed}},
  {action:'events',id:'engine:events',phase:'commit',rateHz:60,reads:['contacts'],writes:['events'],after:['engine:surface-contacts'],depth:{axis:ENGINE_DOMAINS.physics,min:ENGINE_DEPTH.active}},
  {action:'fracture-aggregate',id:'engine:fracture.aggregate',slot:ENGINE_SLOTS.destructionResolve,phase:'commit',rateHz:60,reads:['contacts'],writes:['entities','events'],after:['engine:events'],depth:{axis:ENGINE_DOMAINS.destruction,min:ENGINE_DEPTH.aggregate,max:ENGINE_DEPTH.active-1}},
  {action:'fracture',id:'engine:fracture',slot:ENGINE_SLOTS.destructionResolve,phase:'commit',rateHz:60,reads:['contacts'],writes:['entities','events'],after:['engine:events'],depth:{axis:ENGINE_DOMAINS.destruction,min:ENGINE_DEPTH.active}},
  {action:'cleanup',id:'engine:cleanup',phase:'commit',rateHz:10,reads:[],writes:['entities'],after:[ENGINE_SLOTS.destructionResolve],depth:{axis:ENGINE_DOMAINS.world,min:ENGINE_DEPTH.dormant}},
  {action:'clock',id:'engine:clock',slot:ENGINE_SLOTS.clock,phase:'commit',rateHz:60,reads:[],writes:['time'],after:['engine:cleanup'],depth:{axis:ENGINE_DOMAINS.core,min:ENGINE_DEPTH.dormant}},
 ] as const;
 const modules=definitions.map(definition=>({
  ...definition,
  context:'none' as const,
  run:(_context:Readonly<SceneModuleContext>,frame:{readonly deltaSeconds:number})=>[{type:'system' as const,action:definition.action,deltaSeconds:frame.deltaSeconds}],
 }));
 kernel.usePlugin({id:'engine.scene.builtin',modules});
 return kernel;
}
