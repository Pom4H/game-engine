import {DepthVariantRegistry,type DepthVariantPlugin} from '../core/variants.js';
import {ENGINE_DEPTH,type SimulationProfileInput} from '../core/depth.js';
import {ENGINE_DOMAINS,ENGINE_SLOTS} from '../core/domains.js';
import type {EngineEvent} from '../scene/events.js';
import {synthesizeEvent,type AudioChannels} from './synth.js';

export type EventSynthesizer=(event:EngineEvent,sampleRate?:number)=>AudioChannels;
export type AudioSynthPlugin=DepthVariantPlugin<EventSynthesizer>;

/** Compile once per listener/cohort. Dormant audio deliberately compiles to undefined. */
export class AudioSynthFamily{
 private readonly variants=new DepthVariantRegistry<EventSynthesizer>(32);
 constructor(){
  this.variants.use({id:'audio.event.full',slot:ENGINE_SLOTS.audioMix,depth:{axis:ENGINE_DOMAINS.audio,min:ENGINE_DEPTH.aggregate},value:synthesizeEvent});
 }
 usePlugin(plugin:AudioSynthPlugin):this{this.variants.usePlugin(plugin);return this;}
 compile(profile:SimulationProfileInput='detailed'):EventSynthesizer|undefined{return this.variants.compile(profile).get(ENGINE_SLOTS.audioMix);}
 get diagnostics(){return this.variants.diagnostics;}
}
