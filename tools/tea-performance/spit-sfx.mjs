import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {TEA_SPIT_EVENT} from './chaos-events.mjs';

const rate=44100,duration=42,frames=Math.ceil(duration*rate),channels=2;
const left=new Float32Array(frames),right=new Float32Array(frames);
let state=0x5f3759df;
const random=()=>{state^=state<<13;state^=state>>>17;state^=state<<5;return (state>>>0)/4294967296*2-1;};
const clamp=(x,a=-1,b=1)=>Math.max(a,Math.min(b,x));
const add=(time,value,pan=-.24)=>{
  const i=Math.round(time*rate);if(i<0||i>=frames)return;
  const theta=(pan+1)*Math.PI/4;left[i]+=value*Math.cos(theta);right[i]+=value*Math.sin(theta);
};
let slow=0,mid=0,wet=0;
for(let n=0;n<Math.ceil(TEA_SPIT_EVENT.durationS*rate);n++){
  const t=n/rate,global=TEA_SPIT_EVENT.startS+t,white=random();
  // Water being blown from the mouth: pressure ramps up instead of a hard /p/
  // transient. Two one-pole filters keep the energy in a wet mid-band and
  // deliberately remove the foil-like high-frequency edge.
  slow+=.018*(white-slow);
  mid+=.095*(white-mid);
  wet+=.035*(white-wet);
  const band=(mid-slow)*.78+wet*.22;
  const attack=Math.min(1,t/.045),release=Math.exp(-Math.max(0,t-.34)*4.4);
  const envelope=attack*release*(t<.78?1:Math.max(0,1-(t-.78)/.22));
  const liquidPulse=.74+.20*Math.sin(2*Math.PI*11.5*t+.35*Math.sin(t*31))+.06*Math.sin(2*Math.PI*23*t);
  const mouthNoise=band*envelope*liquidPulse*.56;
  // Low wet turbulence represents liquid shearing across lips/teeth; no
  // instantaneous plosive burst and no narrow-band ringing.
  const turbulence=(wet-slow)*envelope*.24;
  add(global,mouthNoise+turbulence);
}
// Individual droplets hit nearby coat/table/ground after the spray front.
// Fixed seeds keep replay/render bit-stable.
for(let k=0;k<34;k++){
  const delay=.07+((k*73)%101)/101*.72,amp=.012+((k*37)%31)/31*.035;
  // Wet splat only: short low-passed noise pressure impulse. Deliberately no
  // sinusoidal/ringing component — tonal 1.5–7 kHz impacts read as breaking glass.
  let wetLp=0;
  const decay=52+((k*29)%23);
  for(let n=0;n<Math.round(.035*rate);n++){
    const t=n/rate,env=Math.exp(-t*decay),white=random();
    wetLp+=.18*(white-wetLp);
    const splat=(wetLp*.86+white*.14)*env*amp;
    add(TEA_SPIT_EVENT.startS+delay+t,splat,-.24+(((k*17)%11)-5)*.035);
  }
}
let peak=0;for(let i=0;i<frames;i++)peak=Math.max(peak,Math.abs(left[i]),Math.abs(right[i]));
const gain=peak>.000001?.78/peak:1;for(let i=0;i<frames;i++){left[i]*=gain;right[i]*=gain;}
const bytes=new Uint8Array(44+frames*channels*2),view=new DataView(bytes.buffer),write=(off,s)=>[...s].forEach((c,i)=>view.setUint8(off+i,c.charCodeAt(0)));
write(0,'RIFF');view.setUint32(4,36+frames*4,true);write(8,'WAVE');write(12,'fmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,2,true);view.setUint32(24,rate,true);view.setUint32(28,rate*4,true);view.setUint16(32,4,true);view.setUint16(34,16,true);write(36,'data');view.setUint32(40,frames*4,true);
let off=44;for(let i=0;i<frames;i++){view.setInt16(off,Math.round(clamp(left[i])*32767),true);off+=2;view.setInt16(off,Math.round(clamp(right[i])*32767),true);off+=2;}
const out=resolve(process.env.TEA_OUTPUT??'artifacts/tea-chaos');await mkdir(out,{recursive:true});await writeFile(out+'/spit-sfx.wav',bytes);
console.log(JSON.stringify({event:TEA_SPIT_EVENT,sampleRate:rate,channels:2,durationS:duration,peak,gain,file:out+'/spit-sfx.wav'}));
