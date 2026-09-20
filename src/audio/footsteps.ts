import {mulberry32} from '../core/random.js';
import {V3,type Vec3} from '../math.js';
import type {AudioChannels} from './synth.js';
import type {AmbienceFrame} from './ambience.js';

export interface FootstepSound {
 readonly time:number;readonly position:Vec3;readonly sequence:number;readonly depth:number;
 /** Live physical state of the contacted snow/surface. */
 readonly wetness?:number;readonly slush?:number;readonly temperatureC?:number;
}

/** A heel impulse excites granular snow. Dry/cold snow produces many crisp grain
 * failures; wet/slushy snow shifts the same contact energy toward slower,
 * lower-frequency shear/suction. No recorded or looping footstep sample. */
export function renderFootsteps(events:readonly FootstepSound[],frames:readonly AmbienceFrame[],duration:number,sampleRate=48000):AudioChannels{
 if(!frames.length||!Number.isFinite(duration)||duration<=0||duration>3600||!Number.isSafeInteger(sampleRate)||sampleRate<8000||sampleRate>192000)throw new RangeError('Invalid footstep render parameters');
 for(let i=0;i<frames.length;i++){const f=frames[i]!;if(!Number.isFinite(f.time)||f.time<0||(i>0&&f.time<=frames[i-1]!.time)||[f.listener,f.target].some(v=>v.length!==3||v.some(x=>!Number.isFinite(x))))throw new TypeError('Invalid listener frames');}
 const left=new Float32Array(Math.ceil(duration*sampleRate)),right=new Float32Array(left.length);
 for(const e of events){
  if(!Number.isFinite(e.time)||!Number.isFinite(e.depth)||e.depth<0||!Number.isSafeInteger(e.sequence)||e.position.length!==3||e.position.some(v=>!Number.isFinite(v)))throw new TypeError('Invalid footstep event');
  if(e.time<0||e.time>=duration)continue;
  const frame=frames.reduce((a,b)=>Math.abs(a.time-e.time)<Math.abs(b.time-e.time)?a:b),delta=V3.sub(e.position,frame.listener),distance=V3.length(delta),rightAxis=V3.normalize(V3.cross(V3.sub(frame.target,frame.listener),[0,1,0])),pan=Math.max(-.9,Math.min(.9,V3.dot(V3.normalize(delta),rightAxis))),gain=.7/(1+(distance/3)**1.5)*Math.min(1,e.depth/.02),gl=gain*Math.sqrt((1-pan)/2),gr=gain*Math.sqrt((1+pan)/2),start=Math.round(e.time*sampleRate),rng=mulberry32(e.sequence+923);
  const wet=clamp01(e.wetness??0),slush=clamp01(e.slush??0),temperature=e.temperatureC??-5,cold=clamp01(-temperature/18),wetMix=clamp01(wet*.72+slush*.78),dry=clamp01(1-wet*.62-slush*.82+cold*.12);
  const grainCount=Math.round(5+dry*15),grains=Array.from({length:grainCount},()=>[.018+rng()*(.16+dry*.07),.35+rng()*.65] as const);
  const crunchCutoff=650+dry*1900,wetCutoff=260+wetMix*520;
  let low=0,soft=0,wetLow=0,wetSoft=0;
  for(let j=0;j<sampleRate*.42&&start+j<left.length;j++){
   const t=j/sampleRate,noise=rng()*2-1;
   low+=(noise-low)*(1-Math.exp(-2*Math.PI*crunchCutoff/sampleRate));soft+=(low-soft)*(1-Math.exp(-2*Math.PI*(520+dry*1450)/sampleRate));
   wetLow+=(noise-wetLow)*(1-Math.exp(-2*Math.PI*wetCutoff/sampleRate));wetSoft+=(wetLow-wetSoft)*(1-Math.exp(-2*Math.PI*(180+wetMix*360)/sampleRate));
   const pressure=Math.min(1,t/.012)*Math.exp(-t*(13+wetMix*4)),grain=grains.reduce((sum,[at,amp])=>sum+(t>at?amp*Math.exp(-(t-at)*(150+dry*75)):0),0);
   const impact=Math.sin(t*2*Math.PI*(82-34*t))*Math.exp(-t*(34-wetMix*7))*Math.min(1,t*250);
   const crunch=soft*(.46*pressure+.15*grain)*dry;
   const suction=Math.sin(2*Math.PI*(205+75*Math.exp(-t*11))*t)*Math.exp(-t*24)*wetMix*.07;
   const squish=(wetSoft*(.46*pressure+.08*grain)+suction)*wetMix;
   const v=.18*impact+crunch+squish;
   left[start+j]!+=v*gl;right[start+j]!+=v*gr;
  }
 }
 return{left,right,sampleRate};
}
function clamp01(value:number){return Math.max(0,Math.min(1,Number.isFinite(value)?value:0));}
