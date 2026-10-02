import {DepthVariantRegistry,type DepthRange,type DepthVariantPlugin} from '../core/variants.js';
import {ENGINE_SLOTS} from '../core/domains.js';
import type {SimulationProfileInput} from '../core/depth.js';
import type {WorldTileDemand} from './tiles.js';

export type WorldGenerator<T>=(demand:WorldTileDemand,signal:AbortSignal)=>T|Promise<T>;
export interface WorldGeneratorVariant<T>{readonly id:string;readonly depth:DepthRange;readonly generate:WorldGenerator<T>}
export type WorldGeneratorPlugin<T>=DepthVariantPlugin<WorldGenerator<T>>;

export class WorldGeneratorFamily<T>{
 private readonly variants=new DepthVariantRegistry<WorldGenerator<T>>(64);
 use(variant:WorldGeneratorVariant<T>):this{
  this.variants.use({id:variant.id,slot:ENGINE_SLOTS.worldMaterialize,depth:variant.depth,value:variant.generate});return this;
 }
 usePlugin(plugin:WorldGeneratorPlugin<T>):this{this.variants.usePlugin(plugin);return this;}
 compile(profile:SimulationProfileInput='detailed'):WorldGenerator<T>|undefined{return this.variants.compile(profile).get(ENGINE_SLOTS.worldMaterialize);}
 get diagnostics(){return this.variants.diagnostics;}
}
