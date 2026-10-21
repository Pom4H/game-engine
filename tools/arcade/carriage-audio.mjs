import {cameraOnRail} from '../../dist/scene/camera-rail.js';
import {camera,cameraRail} from './camera.mjs';

// Acoustic actors only: no geometry, shadow or reflection can enter the shot.
// One horse pulls one cart with two axles and four independent wheel contacts.
export const carriage={horses:1,wheels:[[-1.2,-.78],[-1.2,.78],[1.2,-.78],[1.2,.78]],wheelRadius:.46,speed:2.8};
export const passTimes=[12,58],loopSeconds=90,passSeconds=15;
const tau=Math.PI*2,clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const smooth=x=>{x=clamp(x,0,1);return x*x*(3-2*x);};
const noise=n=>{let x=Math.imul(n|0,1597334677);x^=x>>>15;x=Math.imul(x,2246822519);return ((x^(x>>>13))>>>0)/2147483648-1;};
function band(t,hz,seed){const k=t*hz,i=Math.floor(k),u=smooth(k-i);return noise(i+seed)*(1-u)+noise(i+1+seed)*u;}

export function acousticPose(time){
 const t=((time%loopSeconds)+loopSeconds)%loopSeconds;
 const pass=passTimes.findIndex(start=>t>=start&&t<start+passSeconds);
 const view=cameraOnRail(camera,cameraRail,time),p=view.position;
 const dx=view.target[0]-p[0],dz=view.target[2]-p[2],len=Math.hypot(dx,dz),forward=[dx/len,0,dz/len],right=[forward[2],0,-forward[0]];
 const elapsed=pass<0?0:t-passTimes[pass],direction=pass===1?-1:1;
 const lateral=(elapsed-passSeconds*.5)*carriage.speed*direction;
 const position=[p[0]+right[0]*lateral-forward[0]*8,.6,p[2]+right[2]*lateral-forward[2]*8];
 return {active:pass>=0,elapsed,position,forward,right,listener:p,lateral,direction,
  envelope:pass<0?0:smooth(elapsed/2)*smooth((passSeconds-elapsed)/2)*8/Math.hypot(lateral,8)};
}

function pulse(time,period,offset,frequency,seed){
 const cycle=Math.floor((time-offset)/period),age=time-offset-cycle*period;
 if(age>.18)return 0;
 const click=band(time,6800,seed+cycle*137)*Math.exp(-age*110)*.38;
 const body=Math.sin(tau*frequency*age)*Math.exp(-age*38)*.55;
 const grit=band(time,1350,seed+cycle*101)*Math.exp(-age*60)*.20;
 return (click+body+grit)*Math.min(1,age*2200);
}

/** Interleaved stereo PCM at absolute sample indices. Independent segments
 * produce the same waveform as a continuous render, including pass boundaries. */
export function renderAudio({startTime,duration,sampleRate=48000}){
 if(!Number.isFinite(startTime)||startTime<0||!Number.isFinite(duration)||duration<=0||duration>10||sampleRate!==48000)throw Error('Invalid soundtrack range');
 const first=Math.round(startTime*sampleRate),frames=Math.round(duration*sampleRate),pcm=new Float32Array(frames*2);
 let control=-1,pose;
 for(let n=0;n<frames;n++){
  const index=first+n,t=index/sampleRate,block=Math.floor(index/240);
  if(block!==control){control=block;pose=acousticPose(block*240/sampleRate);}
  // Low winter air remains between the occasional passes.
  const air=.004*(band(t,140,191)+.20*band(t,1300,29));
  let l=air,r=air*.92;
  if(pose.active){
   const age=pose.elapsed+(index%240)/sampleRate,pan=clamp(pose.lateral/24,-.90,.90);
   let hoof=0;
   for(const [i,phase] of [0,.14,.50,.64].entries())hoof+=pulse(age,.82,phase*.82,175+i*19,421+i*313);
   const horsePan=clamp(pan+pose.direction*.07,-1,1),horse=hoof*.21*pose.envelope;
   l+=horse*Math.sqrt((1-horsePan)/2);r+=horse*Math.sqrt((1+horsePan)/2);
   for(const [i,[axle,side]] of carriage.wheels.entries()){
    const wheelPan=clamp(pan+side*.025+axle*pose.direction*.025,-1,1);
    const cobbles=pulse(age,.20+i*.001,axle/carriage.speed+i*.039,92+i*17,2701+i*331);
    const wood=Math.sin(tau*age*carriage.speed/(tau*carriage.wheelRadius)+i)*band(t,370,671+i*31);
    const wheel=(cobbles*.095+wood*.025)*pose.envelope;
    l+=wheel*Math.sqrt((1-wheelPan)/2);r+=wheel*Math.sqrt((1+wheelPan)/2);
   }
   const creak=Math.sin(tau*age*690+3*Math.sin(age*7))*Math.pow(Math.max(0,Math.sin(age*2.2)),12)*.014*pose.envelope;
   l+=creak*Math.sqrt((1-pan)/2);r+=creak*Math.sqrt((1+pan)/2);
  }
  pcm[n*2]=clamp(l,-.9,.9);pcm[n*2+1]=clamp(r,-.9,.9);
 }
 return pcm;
}
