import {mulberry32} from '../core/random.js';
import {V3,type Vec3} from '../math.js';
import type {AudioChannels} from './synth.js';

/** Sampled world/listener transforms. Rendering is offline and deterministic. */
export interface AmbienceFrame {
 readonly time:number;
 readonly listener:Vec3;
 readonly target:Vec3;
 readonly vehicle:Vec3;
 readonly speedMps:number;
}
export interface AmbienceOptions {readonly sampleRate?:number;readonly seed?:number;readonly windSpeedMps?:number;readonly vehicleGain?:number}
/** Procedural wind, engine harmonics and tyre noise with listener-relative stereo,
 * distance attenuation and bounded Doppler. This is an audio model, not a recording. */
export function renderAmbience(frames:readonly AmbienceFrame[],duration:number,options:AmbienceOptions={}):AudioChannels{
 const sampleRate=options.sampleRate??48000,wind=options.windSpeedMps??.7,gain=options.vehicleGain??.32;
 if(!Number.isFinite(duration)||duration<=0||duration>3600||!Number.isSafeInteger(sampleRate)||sampleRate<8000||sampleRate>192000||!frames.length||!Number.isFinite(wind)||wind<0||!Number.isFinite(gain)||gain<0)throw new RangeError('Invalid ambience render parameters');
 for(let i=0;i<frames.length;i++){const f=frames[i]!;if(!Number.isFinite(f.time)||f.time<0||(i>0&&f.time<=frames[i-1]!.time)||!Number.isFinite(f.speedMps)||f.speedMps<0||[f.listener,f.target,f.vehicle].some(v=>v.length!==3||v.some(x=>!Number.isFinite(x))))throw new TypeError('Ambience frames must be finite and strictly ordered');}
 const count=Math.ceil(duration*sampleRate),left=new Float32Array(count),right=new Float32Array(count),random=mulberry32(options.seed??7319);
 let index=0,phase=0,lowL=0,lowR=0,tyreLow=0,previousDistance=0,doppler=1;
 const mix=(a:Vec3,b:Vec3,t:number):Vec3=>[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t,a[2]+(b[2]-a[2])*t];
 let gainL=0,gainR=0,baseHz=40;
 for(let i=0;i<count;i++){
  const time=i/sampleRate;
  // Spatial controls at 200 Hz; oscillators and filters run at the sample rate.
  if(i%Math.max(1,Math.floor(sampleRate/200))===0){
   while(index<frames.length-2&&frames[index+1]!.time<time)index++;
   const a=frames[index]!,b=frames[Math.min(index+1,frames.length-1)]!,u=Math.max(0,Math.min(1,(time-a.time)/Math.max(1e-9,b.time-a.time)));
   const listener=mix(a.listener,b.listener,u),source=mix(a.vehicle,b.vehicle,u),target=mix(a.target,b.target,u),delta=V3.sub(source,listener),distance=V3.length(delta),rightAxis=V3.normalize(V3.cross(V3.sub(target,listener),[0,1,0]));
   const pan=Math.max(-.92,Math.min(.92,V3.dot(V3.normalize(delta),rightAxis))),attenuation=gain/(1+Math.pow(distance/7,1.4)),speed=a.speedMps+(b.speedMps-a.speedMps)*u;
   gainL=attenuation*Math.sqrt((1-pan)/2);gainR=attenuation*Math.sqrt((1+pan)/2);
   const radial=i===0?0:(distance-previousDistance)*200;previousDistance=distance;doppler=Math.max(.8,Math.min(1.2,343/(343+radial)));baseHz=(35+speed*4.4)*doppler;
  }
  const nl=random()*2-1,nr=random()*2-1;lowL+=(nl-lowL)*(1-Math.exp(-2*Math.PI*160/sampleRate));lowR+=(nr-lowR)*(1-Math.exp(-2*Math.PI*160/sampleRate));tyreLow+=(nl-tyreLow)*(1-Math.exp(-2*Math.PI*850/sampleRate));
  phase+=2*Math.PI*baseHz/sampleRate;
  const pulse=Math.sin(phase)*.24+Math.sin(phase*2)*.22+Math.sin(phase*3+.4)*.10+Math.sin(phase*5)*.035;
  const hiss=(nl-tyreLow)*.20+tyreLow*.28;
  const windGain=Math.min(2,wind/2)*(.035+.016*Math.sin(time*.45)+.01*Math.sin(time*.17+1));
  left[i]=(pulse+hiss)*gainL+lowL*windGain;right[i]=(pulse+hiss)*gainR+lowR*windGain;
 }
 return{left,right,sampleRate};
}
