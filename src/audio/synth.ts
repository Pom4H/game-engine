import {hashString,mulberry32} from '../core/random.js';
import {material} from '../materials/catalog.js';
import type {EngineEvent,FractureEvent,ImpactEvent} from '../scene/events.js';

export interface AudioChannels {left:Float32Array;right:Float32Array;sampleRate:number}

export function synthesizeEvent(event:EngineEvent,sampleRate=48_000):AudioChannels{
  const duration=event.type==='fracture'?Math.min(1.25,.32+event.size*.12):Math.min(.55,.09+event.size*.045+Math.log1p(event.energy)*.018);
  const count=Math.max(1,Math.ceil(duration*sampleRate)),left=new Float32Array(count),right=new Float32Array(count);
  const rng=mulberry32((event.id^hashString(event.type))>>>0);
  const pan=Math.max(-.65,Math.min(.65,event.point[0]/25)),gainL=Math.sqrt((1-pan)/2),gainR=Math.sqrt((1+pan)/2);
  const amplitude=event.type==='fracture'?Math.min(.75,.11+Math.log1p(event.energy)*.075):Math.min(.55,.035+Math.log1p(event.energy)*.06);
  if(event.type==='fracture')fractureVoice(event,left,right,sampleRate,rng,amplitude,gainL,gainR);
  else impactVoice(event,left,right,sampleRate,rng,amplitude,gainL,gainR);
  softLimit(left);softLimit(right);return{left,right,sampleRate};
}

export function renderAudio(events:readonly EngineEvent[],duration:number,sampleRate=48_000,startTime=0):AudioChannels{
  const count=Math.max(1,Math.ceil(duration*sampleRate)),left=new Float32Array(count),right=new Float32Array(count);
  for(const event of events){const offset=Math.round((event.time-startTime)*sampleRate);if(offset>=count)continue;const voice=synthesizeEvent(event,sampleRate);for(let i=Math.max(0,-offset);i<voice.left.length&&offset+i<count;i++){const at=offset+i;if(at>=0){left[at]!+=voice.left[i]!;right[at]!+=voice.right[i]!;}}}
  softLimit(left);softLimit(right);return{left,right,sampleRate};
}

export function wavBytes(audio:AudioChannels):Uint8Array{
  const frames=Math.min(audio.left.length,audio.right.length),bytes=new Uint8Array(44+frames*4),view=new DataView(bytes.buffer);
  const text=(offset:number,value:string)=>{for(let i=0;i<value.length;i++)bytes[offset+i]=value.charCodeAt(i);};
  text(0,'RIFF');view.setUint32(4,36+frames*4,true);text(8,'WAVE');text(12,'fmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,2,true);view.setUint32(24,audio.sampleRate,true);view.setUint32(28,audio.sampleRate*4,true);view.setUint16(32,4,true);view.setUint16(34,16,true);text(36,'data');view.setUint32(40,frames*4,true);
  for(let i=0;i<frames;i++){view.setInt16(44+i*4,Math.round(Math.max(-1,Math.min(1,audio.left[i]!))*32767),true);view.setInt16(46+i*4,Math.round(Math.max(-1,Math.min(1,audio.right[i]!))*32767),true);}
  return bytes;
}

function impactVoice(event:ImpactEvent,left:Float32Array,right:Float32Array,sampleRate:number,rng:()=>number,amplitude:number,gainL:number,gainR:number){
  const a=material(event.materialA).acoustic,b=material(event.materialB).acoustic,brightness=(a.brightness+b.brightness)/2,damping=Math.max(.025,(a.damping+b.damping)/2);
  const geometryScale=Math.max(.35,Math.sqrt(Math.max(.04,event.size))),base=Math.max(70,Math.sqrt(a.resonanceHz*b.resonanceHz)/geometryScale);
  const modes=[1,1.43,2.07,2.91],phases=modes.map(()=>rng()*Math.PI*2);
  for(let i=0;i<left.length;i++){const t=i/sampleRate,env=Math.exp(-t*(10+34*damping)),attack=Math.min(1,t*.004*sampleRate),noise=(rng()*2-1)*Math.exp(-t*55)*(a.noise+b.noise)*.22;let sample=noise;for(let m=0;m<modes.length;m++)sample+=Math.sin(2*Math.PI*base*modes[m]!*t+phases[m]!)*env*(1/(1+m*.72))*(.55+brightness*.55);sample*=amplitude*attack*.34;left[i]=sample*gainL;right[i]=sample*gainR;}
}

function fractureVoice(event:FractureEvent,left:Float32Array,right:Float32Array,sampleRate:number,rng:()=>number,amplitude:number,gainL:number,gainR:number){
  const profile=material(event.material).acoustic,thicknessScale=Math.sqrt(Math.max(.25,event.thickness/.01)),sizeScale=Math.max(.65,event.size),base=Math.max(260,profile.resonanceHz*thicknessScale/Math.sqrt(sizeScale));
  const modes=[1,1.31,1.77,2.36,3.12],phases=modes.map(()=>rng()*Math.PI*2),tinks=Math.min(18,Math.max(4,Math.round(event.shardCount*.45)));
  const tinkTimes=Array.from({length:tinks},()=>.015+rng()*.38).sort((a,b)=>a-b),tinkFreq=tinkTimes.map(()=>base*(1.2+rng()*2.8));
  for(let i=0;i<left.length;i++){const t=i/sampleRate,crack=Math.exp(-t*48),ring=Math.exp(-t*(7+profile.damping*22));let sample=(rng()*2-1)*crack*(.32+profile.noise*.85);for(let m=0;m<modes.length;m++)sample+=Math.sin(2*Math.PI*base*modes[m]!*t+phases[m]!)*ring*(.48/(1+m*.62));for(let k=0;k<tinkTimes.length;k++){const age=t-tinkTimes[k]!;if(age>=0&&age<.18)sample+=Math.sin(2*Math.PI*tinkFreq[k]!*age)*Math.exp(-age*38)*(.08+rng()*.025);}sample*=amplitude*.34;left[i]=sample*gainL;right[i]=sample*gainR;}
}

function softLimit(data:Float32Array){for(let i=0;i<data.length;i++)data[i]=Math.tanh(data[i]!*.92);}
