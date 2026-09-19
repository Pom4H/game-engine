import {Scene} from '../scene/scene.js';
import type {SceneSpec,CameraSpec} from '../scene/types.js';
import type {EngineEvent} from '../scene/events.js';
import {renderAudio,type AudioChannels} from './synth.js';
import {renderFootsteps,type FootstepSound} from './footsteps.js';

export interface SceneAudioOptions {
 readonly startTime?:number;
 readonly sampleRate?:number;
 readonly tickRate?:number;
}
export interface SceneAudioRender {
 readonly audio:AudioChannels;
 /** Absolute simulation timestamps, including voices that began before the cut. */
 readonly events:readonly EngineEvent[];
 readonly footsteps:readonly FootstepSound[];
 readonly startTime:number;
 readonly endTime:number;
 readonly ticks:number;
}

/** Render native event audio without browser or scene-specific callbacks.
 * Simulation always starts at zero, so a cut reproduces the same contact history.
 * A clip is at most one hour and may start anywhere within a simulation day.
 * Only voices overlapping the requested interval are retained; footsteps use the
 * listener at contact time, matching live ProceduralAudio playback. */
export function renderSceneAudio(spec:SceneSpec,duration:number,options:SceneAudioOptions={}):SceneAudioRender{
 const startTime=options.startTime??0,sampleRate=options.sampleRate??48_000,tickRate=options.tickRate??60,endTime=startTime+duration;
 if(!Number.isFinite(duration)||duration<=0||duration>3600||!Number.isFinite(startTime)||startTime<0||endTime>86400||!Number.isSafeInteger(sampleRate)||sampleRate<8000||sampleRate>192000||!Number.isSafeInteger(tickRate)||tickRate<4||tickRate>240)throw new RangeError('Invalid scene audio parameters: duration must be within (0, 3600], interval within [0, 86400], sample rate 8000–192000, tick rate 4–240');
 const scene=new Scene(spec),events:EngineEvent[]=[],voices:{event:FootstepSound;camera:CameraSpec}[]=[],ticks=Math.ceil(endTime*tickRate),dt=1/tickRate;
 for(let tick=0;tick<ticks;tick++){
  scene.step(dt);
  for(const event of scene.drainEvents())if(event.time>=startTime-1.25&&event.time<endTime)events.push(event);
  for(const event of scene.contacts.drainFootsteps())if(event.time>=startTime-.38&&event.time<endTime)voices.push({event,camera:structuredClone(scene.camera)});
 }
 const audio=renderAudio(events,duration,sampleRate,startTime);
 for(const {event,camera} of voices){
  // The lower-level batch footstep renderer intentionally accepts nonnegative
  // times. Synthesize the complete voice, then mix its surviving tail at the
  // signed sample offset instead of discarding a pre-cut planting.
  const voice=renderFootsteps([{...event,time:0}],[{time:0,listener:camera.position,target:camera.target,vehicle:event.position,speedMps:0}],.38,sampleRate);
  const offset=Math.round((event.time-startTime)*sampleRate);
  for(let i=Math.max(0,-offset);i<voice.left.length&&offset+i<audio.left.length;i++){
   audio.left[offset+i]!+=voice.left[i]!;audio.right[offset+i]!+=voice.right[i]!;
  }
 }
 for(let i=0;i<audio.left.length;i++){audio.left[i]=Math.tanh(audio.left[i]!);audio.right[i]=Math.tanh(audio.right[i]!);}
 return{audio,events:Object.freeze(events),footsteps:Object.freeze(voices.map(v=>v.event)),startTime,endTime,ticks};
}
