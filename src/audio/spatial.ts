import type {Vec3} from '../math.js';

export type SpatialSpeechActivity={id:string;speaking:boolean;/** Incoming mono RMS, 0..1. */level:number};
export type SpatialStreamOptions={volume?:number;/** Mono RMS required to begin speaking. Default .015. */speakingThreshold?:number;/** Quiet interval before clearing the indicator. Default .2 seconds. */releaseSeconds?:number};
export type SpatialClipOptions={/** Distance before attenuation, in world metres. Default 5. */refDistance?:number;/** Distance attenuation strength. Default .65. */rolloffFactor?:number};
type EmitterBase={panner:PannerNode;gain:GainNode;filter:BiquadFilterNode;position:Vec3;stop:()=>void};
type ClipEmitter=EmitterBase&{kind:'clip';source:AudioBufferSourceNode};
type StreamEmitter=EmitterBase&{kind:'stream';source:MediaStreamAudioSourceNode;track:MediaStreamTrack;analyser:AnalyserNode;samples:Float32Array<ArrayBuffer>;threshold:number;releaseSeconds:number;lastLoudAt:number|null;speaking:boolean;level:number};
type Emitter=ClipEmitter|StreamEmitter;
export type SpatialBus={context:AudioContext;input:GainNode;setActive(value:boolean):void;dispose():void};
/** World-space speech, live voice and clips, sharing one listener and echo-reference mix. */
export class SpatialAudio {
 private context:AudioContext|null=null;
 private output:GainNode|null=null;
 private referenceNode:AudioWorkletNode|null=null;
 private referenceSocket:WebSocket|null=null;
 private referenceFrames=0;
 private referenceReady=false;
 private emitters=new Map<string,Emitter>();
 private generation=0;
 private decoded=new Map<string,AudioBuffer>();
 private pending=new Map<string,Promise<AudioBuffer>>();
 private listener:Vec3=[0,0,0];
 private active=false;
 private buses=new Map<string,{gain:GainNode;active:boolean;stop?:()=>void}>();
 onActivity?: (active:boolean)=>void;
 /** Speaking transitions are based on received audio, never a client-supplied flag. */
 onSpeaking?: (activity:SpatialSpeechActivity)=>void;
 onReferenceDisconnect?:()=>void;
 private ensure(){if(!this.context){this.context=new AudioContext({latencyHint:'interactive'});this.output=this.context.createGain();this.output.connect(this.context.destination);}return this.context;}
 async unlock(){await this.ensure().resume();}
 /** Already-spatialized sources enter before the same echo-reference tap. */
 createBus(id:string,onStop?:()=>void):SpatialBus{
  if(!id||this.buses.has(id)||this.buses.size>=8)throw Error('Invalid shared audio bus');const context=this.ensure(),gain=context.createGain(),entry={gain,active:false,...(onStop?{stop:onStop}:{})};gain.gain.value=0;gain.connect(this.output!);this.buses.set(id,entry);let disposed=false;
  return{context,input:gain,setActive:value=>{if(disposed)return;entry.active=!!value;gain.gain.setTargetAtTime(value?1:0,context.currentTime,.02);this.activity();},dispose:()=>{if(disposed)return;disposed=true;gain.disconnect();this.buses.delete(id);this.activity();}};
 }
 async decode(bytes:ArrayBuffer){return this.ensure().decodeAudioData(bytes.slice(0));}
 /** Tap the actual stereo mix after HRTF for an external echo canceller.
  * Frames are mono PCM16, 10ms, prefixed by a little-endian sample rate. */
 async connectReference(url:string){
  if(this.referenceReady&&this.referenceSocket?.readyState===WebSocket.OPEN)return;
  const c=this.ensure();
  if(!this.referenceNode){
   const module=URL.createObjectURL(new Blob([referenceProcessor],{type:'text/javascript'}));
   try{await c.audioWorklet.addModule(module);}finally{URL.revokeObjectURL(module);}
   this.referenceNode=new AudioWorkletNode(c,'engine-speech-reference',{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[2]});
   this.output!.disconnect();this.output!.connect(this.referenceNode).connect(c.destination);
   // Background tabs can deliver a second of worklet messages together. Allow
   // that short burst; the receiver separately bounds its real-time DSP queue.
   this.referenceNode.port.onmessage=event=>{const socket=this.referenceSocket;if(socket?.readyState!==WebSocket.OPEN)return;if(socket.bufferedAmount>262144){this.disconnectReference();this.stop();this.onReferenceDisconnect?.();return;}socket.send(event.data);this.referenceFrames++;};
  }
  this.referenceFrames=0;
  const socket=new WebSocket(url);this.referenceSocket=socket;
  await new Promise<void>((resolve,reject)=>{
   const timeout=setTimeout(()=>{socket.close();reject(new Error('Аудиодвижок не подключил эхоподавление'));},4000);
   socket.onmessage=event=>{if(this.referenceSocket!==socket||socket.readyState!==WebSocket.OPEN)return;if(event.data==='ready'){clearTimeout(timeout);this.referenceReady=true;resolve();}};
   socket.onerror=()=>{clearTimeout(timeout);reject(new Error('Нет связи с эхоподавлением C920'));};
   socket.onclose=()=>{clearTimeout(timeout);if(this.referenceSocket!==socket)return;const established=this.referenceReady;this.referenceReady=false;this.referenceSocket=null;if(established){this.stop();this.onReferenceDisconnect?.();}reject(new Error('Связь со звуком офиса закрылась'));};
  });
  await new Promise<void>((resolve,reject)=>{const started=performance.now(),timer=setInterval(()=>{if(this.referenceFrames>=2){clearInterval(timer);resolve();}else if(!this.referenceReady||performance.now()-started>2000){clearInterval(timer);reject(new Error('Поток звука не запустился'));}},10);});
 }
 disconnectReference(){this.referenceReady=false;const socket=this.referenceSocket;this.referenceSocket=null;if(socket){socket.onclose=null;socket.close();}}
 async clip(url:string){
  if(this.decoded.has(url))return this.decoded.get(url)!;
  if(this.pending.has(url))return this.pending.get(url)!;
  const request=(async()=>{const r=await fetch(url);if(!r.ok)throw new Error(`Audio HTTP ${r.status}`);const b=await this.decode(await r.arrayBuffer());this.decoded.set(url,b);return b;})();
  this.pending.set(url,request);try{return await request;}finally{this.pending.delete(url);}
 }
 private graph(context:AudioContext,position:Vec3,volume:number,options:SpatialClipOptions={}){
  const panner=context.createPanner(),gain=context.createGain(),filter=context.createBiquadFilter();
  panner.panningModel='HRTF';panner.distanceModel='inverse';panner.refDistance=options.refDistance??5;panner.maxDistance=70;panner.rolloffFactor=options.rolloffFactor??.65;
  filter.type='lowpass';filter.frequency.value=18000;gain.gain.value=volume;
  filter.connect(gain).connect(panner).connect(this.output!);
  return {panner,gain,filter,position:[...position] as Vec3};
 }
 private activity(){const active=[...this.emitters.values()].some(e=>e.kind==='clip'||e.speaking)||[...this.buses.values()].some(b=>b.active);if(active!==this.active){this.active=active;this.onActivity?.(active);}}
 private speaking(id:string,e:StreamEmitter,value:boolean){if(value===e.speaking)return;e.speaking=value;this.onSpeaking?.({id,speaking:value,level:e.level});}
 private release(id:string,e:Emitter){
  if(this.emitters.get(id)===e)this.emitters.delete(id);
  e.source.disconnect();e.filter.disconnect();e.gain.disconnect();e.panner.disconnect();
  this.activity();
 }
 /** Attach one received audio track. This owns WebAudio nodes, never the caller's
  * MediaStream/track. The returned detach only removes this attachment, so a late
  * cleanup from an old connection cannot remove its replacement under the same id. */
 attachStream(id:string,stream:MediaStream,position:Vec3,options:SpatialStreamOptions={}):()=>void{
  const context=this.context;if(!context||context.state!=='running')throw new Error('Включи звук в офисе');
  const volume=options.volume??.7,threshold=options.speakingThreshold??.015,releaseSeconds=options.releaseSeconds??.2;
  if(!id||position.length!==3||!position.every(Number.isFinite)||!Number.isFinite(volume)||volume<0||volume>2||!Number.isFinite(threshold)||threshold<=0||threshold>1||!Number.isFinite(releaseSeconds)||releaseSeconds<0||releaseSeconds>5)throw new RangeError('Invalid spatial voice settings');
  const track=stream.getAudioTracks().find(t=>t.readyState==='live');if(!track)throw new TypeError('Live voice requires an active audio track');
  if(this.emitters.size>=16&&!this.emitters.has(id))throw new Error('Too many audio emitters');
  // A dedicated stream avoids the browser selecting an ended/other track from a
  // multi-track call. It does not take ownership of, or stop, the selected track.
  const selected=new MediaStream([track]),source=context.createMediaStreamSource(selected),analyser=context.createAnalyser();
  analyser.fftSize=512;analyser.smoothingTimeConstant=0;
  const graph=this.graph(context,position,volume);source.connect(analyser).connect(graph.filter);
  // Chromium can receive RTP without pulling remote PCM into WebAudio until a
  // media element starts playout (crbug.com/40094084). Keep that element muted:
  // all audible output and echo-reference audio still go through the HRTF graph.
  const playout=typeof document==='undefined'?null:document.createElement('audio');
  if(playout){playout.muted=true;playout.autoplay=true;playout.srcObject=selected;void playout.play().catch(()=>{});}
  let released=false;
  const e:StreamEmitter={...graph,kind:'stream',source,track,analyser,samples:new Float32Array(analyser.fftSize),threshold,releaseSeconds,lastLoudAt:null,speaking:false,level:0,stop:()=>{
   if(released)return;released=true;track.removeEventListener('ended',ended);track.removeEventListener('mute',muted);stream.removeEventListener('removetrack',removed);
   if(playout){playout.pause();playout.srcObject=null;}
   e.level=0;e.lastLoudAt=null;this.speaking(id,e,false);analyser.disconnect();this.release(id,e);
  }};
  const ended=()=>e.stop(),muted=()=>{e.level=0;e.lastLoudAt=null;this.speaking(id,e,false);this.activity();},removed=(event:MediaStreamTrackEvent)=>{if(event.track===track)e.stop();};
  this.emitters.get(id)?.stop();this.emitters.set(id,e);this.position(id,position);
  track.addEventListener('ended',ended);track.addEventListener('mute',muted);stream.addEventListener('removetrack',removed);
  return e.stop;
 }
 /** Sample once per presentation frame. Hysteresis uses the caller's monotonic
  * seconds clock; mute/end/removal reset immediately without waiting for a frame. */
 sampleActivity(nowSeconds=performance.now()/1000):SpatialSpeechActivity[]{
  if(!Number.isFinite(nowSeconds))throw new RangeError('Invalid speech activity clock');
  const result:SpatialSpeechActivity[]=[];
  for(const [id,e]of this.emitters){if(e.kind!=='stream')continue;
   if(e.track.readyState==='ended'){e.stop();continue;}
   let level=0;
   if(this.context?.state==='running'&&e.track.enabled&&!e.track.muted&&e.gain.gain.value>0){
    e.analyser.getFloatTimeDomainData(e.samples);let sum=0;for(const sample of e.samples)if(Number.isFinite(sample))sum+=sample*sample;level=Math.min(1,Math.sqrt(sum/e.samples.length));
   }else e.lastLoudAt=null;
   e.level=level;
   if(e.lastLoudAt!==null&&nowSeconds<e.lastLoudAt)e.lastLoudAt=null;
   if(level>=e.threshold)e.lastLoudAt=nowSeconds;
   // A clock reset also clears old hold time; it cannot stick the icon on.
   this.speaking(id,e,e.lastLoudAt!==null&&nowSeconds>=e.lastLoudAt&&nowSeconds-e.lastLoudAt<=e.releaseSeconds);
   result.push({id,speaking:e.speaking,level});
  }
  this.activity();return result;
 }
 play(id:string,buffer:AudioBuffer,position:Vec3,volume=.7,options:SpatialClipOptions={}):Promise<void>{
  const context=this.context;if(!context||context.state!=='running')return Promise.reject(new Error('Включи звук в офисе'));
  const refDistance=options.refDistance??5,rolloffFactor=options.rolloffFactor??.65;
  if(!id||position.length!==3||!position.every(Number.isFinite)||!Number.isFinite(volume)||volume<0||volume>2||!Number.isFinite(refDistance)||refDistance<=0||refDistance>70||!Number.isFinite(rolloffFactor)||rolloffFactor<0||rolloffFactor>1)return Promise.reject(new RangeError('Invalid spatial clip settings'));
  if(this.emitters.size>=16&&!this.emitters.has(id))return Promise.reject(new Error('Too many audio emitters'));
  this.emitters.get(id)?.stop();
  const source=context.createBufferSource(),graph=this.graph(context,position,volume,options);source.buffer=buffer;source.connect(graph.filter);
  const started=context.currentTime;
  return new Promise((resolve,reject)=>{
   let released=false;
   const finish=(complete:boolean)=>{if(released)return;released=true;source.onended=null;this.release(id,e);if(complete)resolve();else reject(new DOMException('Озвучка прервана','AbortError'));};
   const e:ClipEmitter={...graph,kind:'clip',source,stop:()=>{if(released)return;source.onended=null;try{source.stop();}finally{finish(false);}}};
   this.emitters.set(id,e);this.position(id,position);this.activity();source.onended=()=>finish(context.currentTime-started>=buffer.duration-.08);
   try{source.start();}catch(error){released=true;source.onended=null;this.release(id,e);reject(error);}
  });
 }
 position(id:string,p:Vec3,occlusion=0){const e=this.emitters.get(id),c=this.context;if(!e||!c)return;e.position=[...p];e.panner.positionX.value=p[0];e.panner.positionY.value=p[1];e.panner.positionZ.value=p[2];e.filter.frequency.setTargetAtTime(18000*(1-occlusion)+900*occlusion,c.currentTime,.12);}
 setListener(position:Vec3,target:Vec3){
  this.listener=[...position];const c=this.context;if(!c)return;const dx=target[0]-position[0],dy=target[1]-position[1],dz=target[2]-position[2],d=Math.hypot(dx,dy,dz)||1,l=c.listener;
  l.positionX.value=position[0];l.positionY.value=position[1];l.positionZ.value=position[2];l.forwardX.value=dx/d;l.forwardY.value=dy/d;l.forwardZ.value=dz/d;l.upX.value=0;l.upY.value=1;l.upZ.value=0;
 }
 inspect(){return{backend:'The Engine / WebAudio HRTF',listener:this.listener,emitters:[...this.emitters].map(([id,e])=>({id,kind:e.kind,position:[...e.position] as Vec3,panning:e.panner.panningModel,refDistance:e.panner.refDistance,...(e.kind==='stream'?{speaking:e.speaking,level:e.level}:{})})),state:this.context?.state??'locked',sampleRate:this.context?.sampleRate,reference:this.referenceReady&&this.referenceFrames>=2?'streaming':'disconnected',referenceFrames:this.referenceFrames,generation:this.generation};}
 stop(id?:string){if(id)this.emitters.get(id)?.stop();else{this.generation++;for(const e of [...this.emitters.values()])e.stop();for(const b of this.buses.values()){b.active=false;b.gain.gain.value=0;b.stop?.();}}this.activity();}
 dispose(){this.disconnectReference();this.stop();for(const b of this.buses.values())b.gain.disconnect();this.buses.clear();this.referenceNode?.disconnect();this.output?.disconnect();void this.context?.close();this.context=null;this.output=null;this.referenceNode=null;this.decoded.clear();}
}

const referenceProcessor=`class EngineSpeechReference extends AudioWorkletProcessor {
 constructor(){super();this.count=0;this.frame=new ArrayBuffer(4+Math.round(sampleRate/100)*2);this.view=new DataView(this.frame);this.view.setUint32(0,sampleRate,true);}
 process(inputs,outputs){const input=inputs[0],output=outputs[0],size=Math.round(sampleRate/100);
  for(let i=0;i<output[0].length;i++){let mono=0;for(let c=0;c<output.length;c++){const value=input[c]?.[i]??input[0]?.[i]??0;output[c][i]=value;mono+=value/output.length;}
   this.view.setInt16(4+this.count*2,Math.round(Math.max(-1,Math.min(1,mono))*32767),true);this.count++;
   if(this.count===size){this.port.postMessage(this.frame,[this.frame]);this.frame=new ArrayBuffer(4+size*2);this.view=new DataView(this.frame);this.view.setUint32(0,sampleRate,true);this.count=0;}
  }return true;
 }
}registerProcessor('engine-speech-reference',EngineSpeechReference);`;
