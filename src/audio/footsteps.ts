import {mulberry32} from '../core/random.js';
import {V3,type Vec3} from '../math.js';
import type {AudioChannels} from './synth.js';
import type {AmbienceFrame} from './ambience.js';
export interface FootstepSound {readonly time:number;readonly position:Vec3;readonly sequence:number;readonly depth:number}
/** A damped heel impact followed by irregular snow grains, synchronized to the
 * same contact records that deform the snow. No looping footstep sample. */
export function renderFootsteps(events:readonly FootstepSound[],frames:readonly AmbienceFrame[],duration:number,sampleRate=48000):AudioChannels{
 if(!frames.length||!Number.isFinite(duration)||duration<=0||duration>3600||!Number.isSafeInteger(sampleRate)||sampleRate<8000||sampleRate>192000)throw new RangeError('Invalid footstep render parameters');
 for(let i=0;i<frames.length;i++){const f=frames[i]!;if(!Number.isFinite(f.time)||f.time<0||(i>0&&f.time<=frames[i-1]!.time)||[f.listener,f.target].some(v=>v.length!==3||v.some(x=>!Number.isFinite(x))))throw new TypeError('Invalid listener frames');}
 const left=new Float32Array(Math.ceil(duration*sampleRate)),right=new Float32Array(left.length);
 for(const e of events){
  if(!Number.isFinite(e.time)||!Number.isFinite(e.depth)||e.depth<0||!Number.isSafeInteger(e.sequence)||e.position.length!==3||e.position.some(v=>!Number.isFinite(v)))throw new TypeError('Invalid footstep event');
  if(e.time<0||e.time>=duration)continue;
  const frame=frames.reduce((a,b)=>Math.abs(a.time-e.time)<Math.abs(b.time-e.time)?a:b),delta=V3.sub(e.position,frame.listener),distance=V3.length(delta),rightAxis=V3.normalize(V3.cross(V3.sub(frame.target,frame.listener),[0,1,0])),pan=Math.max(-.9,Math.min(.9,V3.dot(V3.normalize(delta),rightAxis))),gain=.7/(1+(distance/3)**1.5)*Math.min(1,e.depth/.02),gl=gain*Math.sqrt((1-pan)/2),gr=gain*Math.sqrt((1+pan)/2),start=Math.round(e.time*sampleRate),rng=mulberry32(e.sequence+923),grains=Array.from({length:12},()=>[.025+rng()*.20,.4+rng()*.6]);
  let low=0,soft=0;
  for(let j=0;j<sampleRate*.38&&start+j<left.length;j++){
   const t=j/sampleRate,noise=rng()*2-1;low+=(noise-low)*(1-Math.exp(-2*Math.PI*1800/sampleRate));soft+=(low-soft)*(1-Math.exp(-2*Math.PI*1500/sampleRate));
   const pressure=Math.min(1,t/.012)*Math.exp(-t*15),grain=grains.reduce((sum,[at,amp])=>sum+(t>at!?amp!*Math.exp(-(t-at!)*180):0),0),impact=Math.sin(t*2*Math.PI*(84-38*t))*Math.exp(-t*38)*Math.min(1,t*250),v=.18*impact+soft*(.55*pressure+.13*grain);
   left[start+j]!+=v*gl;right[start+j]!+=v*gr;
  }
 }
 return{left,right,sampleRate};
}
