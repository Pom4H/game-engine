import {EngineKernel,type EngineModule,type SimulationTier} from '../core/kernel.js';
import {STATE,type CausalChannel} from '../core/ontology.js';
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

interface SystemDefinition {
  readonly action:SystemAction;
  readonly phase:'input'|'simulate'|'commit';
  readonly rateHz:number;
  readonly reads:readonly CausalChannel[];
  readonly writes:readonly CausalChannel[];
  readonly after:readonly SystemAction[];
  readonly tiers:readonly SimulationTier[];
}

const SYSTEMS:readonly SystemDefinition[]=[
  {action:'weather',phase:'input',rateHz:10,reads:[],writes:[STATE.environment.weather],after:[],tiers:ALL_TIERS},
  {action:'surfaces',phase:'input',rateHz:30,reads:[STATE.environment.weather,STATE.entity.transform,STATE.material.surface],writes:[STATE.surface.state],after:['weather'],tiers:SURFACE_TIERS},
  {action:'animation',phase:'simulate',rateHz:60,reads:[STATE.surface.state],writes:[STATE.entity.transform,STATE.entity.motion,STATE.entity.animation],after:[],tiers:ACTIVE_TIERS},
  {action:'physics',phase:'simulate',rateHz:60,reads:[STATE.surface.state,STATE.entity.transform,STATE.entity.motion],writes:[STATE.entity.transform,STATE.entity.motion,STATE.interaction.contact],after:['animation'],tiers:ACTIVE_TIERS},
  {action:'deformation',phase:'simulate',rateHz:60,reads:[STATE.interaction.contact,STATE.entity.transform,STATE.material.constitution],writes:[STATE.entity.transform,STATE.structure.deformation],after:['physics'],tiers:ACTIVE_TIERS},
  {action:'surface-contacts',phase:'commit',rateHz:60,reads:[STATE.surface.state,STATE.entity.animation,STATE.interaction.contact],writes:[STATE.surface.contact,STATE.surface.state],after:[],tiers:DETAILED_TIERS},
  {action:'events',phase:'commit',rateHz:60,reads:[STATE.interaction.contact],writes:[STATE.event.stream],after:['surface-contacts'],tiers:ACTIVE_TIERS},
  {action:'fracture',phase:'commit',rateHz:60,reads:[STATE.interaction.contact,STATE.material.constitution],writes:[STATE.structure.fracture,STATE.entity.existence,STATE.event.stream],after:['events'],tiers:ACTIVE_TIERS},
  {action:'cleanup',phase:'commit',rateHz:10,reads:[],writes:[STATE.entity.existence],after:['fracture'],tiers:ALL_TIERS},
  {action:'clock',phase:'commit',rateHz:60,reads:[],writes:[STATE.world.time],after:['cleanup'],tiers:ALL_TIERS},
];

export function sceneKernel():EngineKernel<SceneModuleContext,InternalCommand>{
  const kernel=new EngineKernel<SceneModuleContext,InternalCommand>();
  for(const definition of SYSTEMS){
    kernel.use({
      id:`engine:${definition.action}`,
      phase:definition.phase,
      rateHz:definition.rateHz,
      context:'none',
      reads:definition.reads,
      writes:definition.writes,
      tiers:definition.tiers,
      after:definition.after.map(id=>`engine:${id}`),
      run:(_context,frame)=>[{type:'system',action:definition.action,deltaSeconds:frame.deltaSeconds}],
    });
  }
  return kernel;
}
export type SceneModule=EngineModule<SceneModuleContext,SceneCommand>;
