import {DepthVariantRegistry,type DepthVariantPlugin} from '../core/variants.js';
import {ENGINE_DEPTH,type SimulationProfileInput} from '../core/depth.js';
import {ENGINE_DOMAINS,ENGINE_SLOTS} from '../core/domains.js';
import type {CameraSpec} from '../scene/types.js';
import type {Scene} from '../scene/scene.js';
import {buildDormantRenderFrame,buildProxyRenderFrame,buildRenderFrame,type RenderFrameIR} from './frame.js';

export type RenderFrameBuilder=(scene:Scene,camera?:CameraSpec,options?:{readonly includeMeshes?:boolean})=>RenderFrameIR;
export type RenderFramePlugin=DepthVariantPlugin<RenderFrameBuilder>;

export class RenderFrameFamily{
 private readonly variants=new DepthVariantRegistry<RenderFrameBuilder>(32);
 constructor(){
  this.variants.use({id:'render.frame.dormant',slot:ENGINE_SLOTS.renderFrame,depth:{axis:ENGINE_DOMAINS.render,min:ENGINE_DEPTH.dormant,max:ENGINE_DEPTH.aggregate-1},value:buildDormantRenderFrame});
  this.variants.use({id:'render.frame.proxy',slot:ENGINE_SLOTS.renderFrame,depth:{axis:ENGINE_DOMAINS.render,min:ENGINE_DEPTH.aggregate,max:ENGINE_DEPTH.active-1},value:buildProxyRenderFrame});
  this.variants.use({id:'render.frame.full',slot:ENGINE_SLOTS.renderFrame,depth:{axis:ENGINE_DOMAINS.render,min:ENGINE_DEPTH.active},value:buildRenderFrame});
 }
 usePlugin(plugin:RenderFramePlugin):this{this.variants.usePlugin(plugin);return this;}
 compile(profile:SimulationProfileInput='detailed'):RenderFrameBuilder{return this.variants.compile(profile).require(ENGINE_SLOTS.renderFrame);}
 get diagnostics(){return this.variants.diagnostics;}
}
