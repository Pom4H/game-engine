import {ENGINE_DEPTH,type SimulationProfileInput,simulationProfile} from '../core/depth.js';
import {ENGINE_DOMAINS,ENGINE_SLOTS} from '../core/domains.js';
import {DepthVariantRegistry,type DepthVariantPlugin} from '../core/variants.js';

export interface CollisionSolverProgram{
 readonly surfaceIterations:number;
}
export type CollisionSolverPlugin=DepthVariantPlugin<CollisionSolverProgram>;

const minimal=Object.freeze({surfaceIterations:1});
const aggregate=Object.freeze({surfaceIterations:2});
const full=Object.freeze({surfaceIterations:3});

export class CollisionSolverFamily{
 private readonly variants=new DepthVariantRegistry<CollisionSolverProgram>(32);
 constructor(){
  this.variants.use({id:'collision.solver.minimal',slot:ENGINE_SLOTS.collisionSolve,depth:{axis:ENGINE_DOMAINS.collision,min:ENGINE_DEPTH.dormant,max:ENGINE_DEPTH.aggregate-1},value:minimal});
  this.variants.use({id:'collision.solver.aggregate',slot:ENGINE_SLOTS.collisionSolve,depth:{axis:ENGINE_DOMAINS.collision,min:ENGINE_DEPTH.aggregate,max:ENGINE_DEPTH.active-1},value:aggregate});
  this.variants.use({id:'collision.solver.full',slot:ENGINE_SLOTS.collisionSolve,depth:{axis:ENGINE_DOMAINS.collision,min:ENGINE_DEPTH.active},value:full});
 }
 usePlugin(plugin:CollisionSolverPlugin):this{this.variants.usePlugin(plugin);return this;}
 compile(input:SimulationProfileInput='detailed'):CollisionSolverProgram{
  const profile=simulationProfile(input);
  const collisionDepth=profile.axes[ENGINE_DOMAINS.collision]??profile.axes[ENGINE_DOMAINS.physics]??profile.defaultDepth;
  const axes={...profile.axes,[ENGINE_DOMAINS.collision]:collisionDepth};
  return this.variants.compile({defaultDepth:profile.defaultDepth,axes}).require(ENGINE_SLOTS.collisionSolve);
 }
 get diagnostics(){return this.variants.diagnostics;}
}
