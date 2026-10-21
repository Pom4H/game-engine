import {mulberry32} from '../core/random.js';
import type {EngineEvent} from '../scene/events.js';
import type {CameraSpec} from '../scene/types.js';
import type {AudioChannels} from './synth.js';
import {AudioSynthFamily,type EventSynthesizer} from './depth.js';
import type {SimulationProfileInput} from '../core/depth.js';
import {renderFootsteps,type FootstepSound} from './footsteps.js';
import {connectAcousticWebAudio,type AcousticTransferObservation,type AcousticWebAudioGraph} from './acoustic-transfer.js';
import type {Vec3} from '../math.js';

export interface AmbientAudioState {
 windSpeed:number;snowfall:number;trafficCount:number;trafficSpeed:number;roadWetness:number;slush:number;
 /** Actual wheel contact, when the scene configures native tyre emitters. */
 contactWetness?:number;
 /** Listener-space attenuation and stereo pan, evaluated by BrowserRuntime. */
 trafficGain?:number;trafficPan?:number;
}
interface Voice {readonly source:AudioBufferSourceNode;readonly gain:GainNode;readonly acoustic?:AcousticWebAudioGraph}
export class ProceduralAudio {
 private context:AudioContext|null=null;private unlocked=false;private disposed=false;private ambient:AmbientGraph|null=null;
 private readonly synthFamily=new AudioSynthFamily();private eventSynth:EventSynthesizer|undefined;
 private readonly voices=new Set<Voice>();private readonly maxVoices=48;
 private muted=false;
 private readonly unlockGesture=()=>{void this.unlock();};
 constructor(profile:SimulationProfileInput='detailed'){
  this.eventSynth=this.synthFamily.compile(profile);
  addEventListener('pointerdown',this.unlockGesture,{once:true,capture:true});
  addEventListener('touchstart',this.unlockGesture,{once:true,capture:true,passive:true});
  addEventListener('keydown',this.unlockGesture,{once:true,capture:true});
 }
 async unlock():Promise<boolean>{
  if(this.disposed||!this.eventSynth)return false;
  const context=this.ensure(),wasUnlocked=this.unlocked;this.ensureAmbient(context);
  // iOS/WebKit requires resume to happen directly from the user gesture.
  if(context.state!=='running')await context.resume();
  if(this.disposed||this.context!==context)return false;
  this.unlocked=context.state==='running';if(this.unlocked&&!wasUnlocked)this.confirmUnlocked(context);return this.unlocked;
 }
 setSimulationProfile(profile:SimulationProfileInput):void{
  const next=this.synthFamily.compile(profile),wasActive=this.eventSynth!==undefined;this.eventSynth=next;
  if(wasActive&&!next)this.silence();
 }
 updateAmbient(state:AmbientAudioState):void{
  if(this.muted||!this.eventSynth||!this.unlocked||this.disposed)return;const context=this.ensure();if(context.state!=='running')return;
  const graph=this.ensureAmbient(context),now=context.currentTime,wind=clamp(state.windSpeed/12),snow=clamp(state.snowfall),traffic=clamp(state.trafficCount/5),speed=clamp(state.trafficSpeed/18),wet=clamp(state.contactWetness??state.roadWetness),slush=clamp(state.slush),rolling=traffic*speed;
  smooth(graph.windGain.gain,.010+wind*.10,now,.18);smooth(graph.windFilter.frequency,160+wind*260,now,.2);
  // Falling snow contributes very faint filtered air, never a high-pass hiss.
  smooth(graph.snowGain.gain,snow*(.002+.005*wind),now,.22);smooth(graph.snowFilter.frequency,280+snow*220,now,.2);
  smooth(graph.trafficPan.pan,Math.max(-.95,Math.min(.95,state.trafficPan??0)),now,.08);smooth(graph.trafficGain.gain,clamp(state.trafficGain??1),now,.10);
  smooth(graph.roadGain.gain,rolling*(.065+wet*.025+slush*.025),now,.12);smooth(graph.roadFilter.frequency,360+speed*120,now,.12);smooth(graph.roadSoft.frequency,420,now,.12);
  smooth(graph.humGain.gain,rolling*.028,now,.2);smooth(graph.hum.frequency,54+speed*72,now,.18);
  // The same two low-pass stages as the offline tyre model round out the swish.
  smooth(graph.slushGain.gain,rolling*(wet*.095+slush*.035),now,.10);smooth(graph.slushFilter.frequency,950,now,.12);smooth(graph.slushSoft.frequency,700,now,.12);
 }
 setMuted(muted:boolean):void{this.muted=muted;if(muted)this.silence();}
 play(events:readonly EngineEvent[],camera?:CameraSpec,simulationTime?:number):void{
  const synth=this.eventSynth;if(this.muted||!synth||!events.length||!this.unlocked||this.disposed)return;const context=this.ensure();if(context.state!=='running')return;
  for(const event of events){
   if(event.type==='impact'&&event.energy<.02)continue;
   let projected=event,level=.72,offset=0;
   if(event.type==='horn'){
    offset=Math.max(0,(simulationTime??event.time)-event.time);if(offset>=event.durationSeconds+.08)continue;
    if(camera){
     const dx=event.point[0]-camera.position[0],dy=event.point[1]-camera.position[1],dz=event.point[2]-camera.position[2],distance=Math.hypot(dx,dy,dz);
     const fx=camera.target[0]-camera.position[0],fz=camera.target[2]-camera.position[2],length=Math.max(1e-9,Math.hypot(fx,fz));
     const pan=Math.max(-.65,Math.min(.65,(-fz*dx+fx*dz)/length/Math.max(2,distance)));
     projected={...event,point:[pan*25,0,0]};level=.82/(1+(distance/15)**1.6);
    }
   }
   this.playVoice(synth(projected,context.sampleRate),level,context.currentTime,offset);
  }
 }
 /** Play an already-synthesized voice through a control-rate acoustic transfer.
  * The wave solver has finished before this call; WebAudio only renders delays,
  * filtering, early taps and the feedback tail at sample rate. */
 playAcoustic(channels:AudioChannels,transfer:AcousticTransferObservation,listenerRight:Vec3=[1,0,0],level=.72):void{
  if(!this.eventSynth||!this.unlocked||this.disposed)return;const context=this.ensure();if(context.state!=='running')return;
  this.playAcousticVoice(channels,transfer,listenerRight,level,context.currentTime,0);
 }
 /** Live playback reuses the same synthesis and contact records as an offline
  * capture. Catch-up ticks start at the elapsed sample; old seek history is silent. */
 playFootsteps(events:readonly FootstepSound[],camera:CameraSpec,simulationTime:number):void{
  if(this.muted||!this.eventSynth||!events.length||!this.unlocked||this.disposed)return;if(!Number.isFinite(simulationTime)||simulationTime<0)throw new RangeError('Invalid footstep simulation time');
  const context=this.ensure();if(context.state!=='running')return;
  for(const event of events){const age=simulationTime-event.time;if(age>=.38||age<-.25)continue;
   const voice=renderFootsteps([{...event,time:0}],[{time:0,listener:camera.position,target:camera.target,vehicle:event.position,speedMps:0}],.38,context.sampleRate);
   this.playVoice(voice,1,context.currentTime+Math.max(0,-age),Math.max(0,age));
  }
 }
 private playVoice(channels:AudioChannels,level:number,when:number,offset:number):void{
  const context=this.context!;if(offset>=channels.left.length/channels.sampleRate)return;
  while(this.voices.size>=this.maxVoices){const oldest=this.voices.values().next().value!;oldest.source.stop();this.release(oldest);}
  const buffer=context.createBuffer(2,channels.left.length,channels.sampleRate);buffer.getChannelData(0).set(channels.left);buffer.getChannelData(1).set(channels.right);
  const source=context.createBufferSource(),gain=context.createGain(),voice:Voice={source,gain};gain.gain.value=level;source.buffer=buffer;source.connect(gain).connect(context.destination);source.onended=()=>this.release(voice);this.voices.add(voice);source.start(when,offset);
 }
 private playAcousticVoice(channels:AudioChannels,transfer:AcousticTransferObservation,listenerRight:Vec3,level:number,when:number,offset:number):void{
  const context=this.context!;if(offset>=channels.left.length/channels.sampleRate)return;
  while(this.voices.size>=this.maxVoices){const oldest=this.voices.values().next().value!;oldest.source.stop();this.release(oldest);}
  const buffer=context.createBuffer(2,channels.left.length,channels.sampleRate);buffer.getChannelData(0).set(channels.left);buffer.getChannelData(1).set(channels.right);
  const source=context.createBufferSource(),gain=context.createGain();gain.gain.value=1;source.buffer=buffer;source.connect(gain);
  const acoustic=connectAcousticWebAudio(context,gain,context.destination,transfer,{listenerRight,level}),voice:Voice={source,gain,acoustic};source.onended=()=>this.release(voice);this.voices.add(voice);source.start(when,offset);
 }
 private release(voice:Voice):void{if(!this.voices.delete(voice))return;voice.source.onended=null;voice.source.disconnect();voice.gain.disconnect();voice.acoustic?.disconnect();}
 private silence():void{
  for(const voice of [...this.voices]){try{voice.source.stop();}catch{}this.release(voice);}
  const context=this.context,graph=this.ambient;if(!context||!graph)return;const now=context.currentTime;
  for(const gain of [graph.windGain.gain,graph.snowGain.gain,graph.trafficGain.gain,graph.roadGain.gain,graph.slushGain.gain,graph.humGain.gain]){
   gain.cancelScheduledValues(now);gain.setValueAtTime(0,now);
  }
 }
 inspect(){return{enabled:this.eventSynth!==undefined,unlocked:this.unlocked,muted:this.muted,state:this.context?.state??'locked',ambient:this.ambient!==null,voices:this.voices.size};}
 dispose():void{
  if(this.disposed)return;this.disposed=true;this.unlocked=false;
  for(const event of ['pointerdown','touchstart','keydown'])removeEventListener(event,this.unlockGesture,true);
  for(const voice of this.voices){voice.source.stop();this.release(voice);}
  this.ambient?.wind.stop();this.ambient?.snow.stop();this.ambient?.road.stop();this.ambient?.slush.stop();this.ambient?.hum.stop();
  this.ambient=null;void this.context?.close();this.context=null;
 }
 private ensure():AudioContext{
  if(this.context)return this.context;const AudioContextCtor=globalThis.AudioContext??(globalThis as typeof globalThis&{webkitAudioContext?:typeof AudioContext}).webkitAudioContext;if(!AudioContextCtor)throw new Error('WebAudio is unavailable');this.context=new AudioContextCtor({latencyHint:'interactive'});return this.context;
 }
 private ensureAmbient(context:AudioContext):AmbientGraph{
  if(this.ambient)return this.ambient;const master=context.createGain();master.gain.value=.72;master.connect(context.destination);
  const trafficPan=context.createStereoPanner(),trafficGain=context.createGain();trafficGain.gain.value=0;trafficPan.connect(trafficGain).connect(master);
  const wind=noiseSource(context,11),windFilter=context.createBiquadFilter(),windGain=context.createGain();windFilter.type='lowpass';windFilter.frequency.value=200;windGain.gain.value=0;wind.connect(windFilter).connect(windGain).connect(master);
  const snow=noiseSource(context,29),snowFilter=context.createBiquadFilter(),snowGain=context.createGain();snowFilter.type='lowpass';snowFilter.frequency.value=400;snowGain.gain.value=0;snow.connect(snowFilter).connect(snowGain).connect(master);
  const road=noiseSource(context,47),roadFilter=context.createBiquadFilter(),roadSoft=context.createBiquadFilter(),roadGain=context.createGain();roadFilter.type='lowpass';roadFilter.frequency.value=420;roadSoft.type='lowpass';roadSoft.frequency.value=420;roadGain.gain.value=0;road.connect(roadFilter).connect(roadSoft).connect(roadGain).connect(trafficPan);
  const slush=noiseSource(context,73),slushFilter=context.createBiquadFilter(),slushSoft=context.createBiquadFilter(),slushGain=context.createGain();slushFilter.type='lowpass';slushFilter.frequency.value=950;slushSoft.type='lowpass';slushSoft.frequency.value=700;slushGain.gain.value=0;slush.connect(slushFilter).connect(slushSoft).connect(slushGain).connect(trafficPan);
  const hum=context.createOscillator(),humGain=context.createGain();hum.type='triangle';hum.frequency.value=62;humGain.gain.value=0;hum.connect(humGain).connect(trafficPan);
  wind.start();snow.start();road.start();slush.start();hum.start();
  this.ambient={master,trafficPan,trafficGain,wind,windFilter,windGain,snow,snowFilter,snowGain,road,roadFilter,roadSoft,roadGain,slush,slushFilter,slushSoft,slushGain,hum,humGain};return this.ambient;
 }
 private confirmUnlocked(context:AudioContext):void{
  const oscillator=context.createOscillator(),gain=context.createGain(),now=context.currentTime;oscillator.type='sine';oscillator.frequency.setValueAtTime(520,now);oscillator.frequency.exponentialRampToValueAtTime(660,now+.045);gain.gain.setValueAtTime(.0001,now);gain.gain.exponentialRampToValueAtTime(.022,now+.006);gain.gain.exponentialRampToValueAtTime(.0001,now+.07);oscillator.connect(gain).connect(context.destination);oscillator.onended=()=>{oscillator.disconnect();gain.disconnect();};oscillator.start(now);oscillator.stop(now+.075);
 }
}
interface AmbientGraph {
 master:GainNode;trafficPan:StereoPannerNode;trafficGain:GainNode;
 wind:AudioBufferSourceNode;windFilter:BiquadFilterNode;windGain:GainNode;
 snow:AudioBufferSourceNode;snowFilter:BiquadFilterNode;snowGain:GainNode;
 road:AudioBufferSourceNode;roadFilter:BiquadFilterNode;roadSoft:BiquadFilterNode;roadGain:GainNode;
 slush:AudioBufferSourceNode;slushFilter:BiquadFilterNode;slushSoft:BiquadFilterNode;slushGain:GainNode;
 hum:OscillatorNode;humGain:GainNode;
}
function noiseSource(context:AudioContext,seed:number):AudioBufferSourceNode{
 const count=Math.round(context.sampleRate*3),buffer=context.createBuffer(1,count,context.sampleRate),data=buffer.getChannelData(0),rng=mulberry32(seed);let brown=0;
 for(let i=0;i<count;i++){const white=rng()*2-1;brown=brown*.965+white*.035;data[i]=white*.58+brown*.72;}
 const source=context.createBufferSource();source.buffer=buffer;source.loop=true;return source;
}
function smooth(param:AudioParam,value:number,now:number,time:number){param.setTargetAtTime(value,now,time);}
function clamp(value:number){return Math.max(0,Math.min(1,value));}
