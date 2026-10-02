import {DepthVariantRegistry,type DepthRange,type DepthVariantPlugin} from '../core/variants.js';
import {ENGINE_SLOTS} from '../core/domains.js';
import type {SimulationProfileInput} from '../core/depth.js';
import type {Fields} from './projection.js';
import {Projection} from './projection.js';

export interface ProjectionVariant<S extends Fields=Fields>{readonly id:string;readonly depth:DepthRange;readonly projection:Projection<S>}
export type ProjectionFamilyPlugin=DepthVariantPlugin<Projection>;

export class ProjectionFamily{
 private readonly variants=new DepthVariantRegistry<Projection>(64);
 use<S extends Fields>(variant:ProjectionVariant<S>):this{
  this.variants.use({id:variant.id,slot:ENGINE_SLOTS.networkProject,depth:variant.depth,value:variant.projection as Projection});return this;
 }
 usePlugin(plugin:ProjectionFamilyPlugin):this{this.variants.usePlugin(plugin);return this;}
 compile(profile:SimulationProfileInput='detailed'):Projection|undefined{return this.variants.compile(profile).get(ENGINE_SLOTS.networkProject);}
 get diagnostics(){return this.variants.diagnostics;}
}
