import {loadTimeline} from './timeline.mjs';
import {EPISODE_SECONDS} from './timing.mjs';
const tape=await loadTimeline();
const tau=Math.PI*2;
function noise(i,seed){let n=Math.imul(i,374761393)^seed;n=Math.imul(n^(n>>>13),1274126177);return((n^(n>>>16))>>>0)/2147483648-1;}
export function renderAudio({startTime,duration,sampleRate=48000}){
 if(!Number.isFinite(startTime)||startTime<0||!Number.isFinite(duration)||duration<=0||duration>10||sampleRate!==48000)throw Error('Invalid soundtrack range');
 const frames=Math.round(duration*sampleRate),first=Math.round(startTime*sampleRate),pcm=new Float32Array(frames*2);
 for(let n=0;n<frames;n++){
  const i=first+n,t=i/sampleRate,visit=Math.floor(t/EPISODE_SECONDS),local=t-visit*EPISODE_SECONDS,index=Math.min(tape.frames.length-2,Math.floor(local*60)),dt=local-index/60,u=dt*60,a=tape.frames[index],b=tape.frames[index+1];let left=0,right=0;
  for(let k=0;k<3;k++){
   const car=a.cars[k],next=b.cars[k],frequency=car.rpm/60*3,df=(next.rpm-car.rpm)/60*3,phase=visit*tape.frames.at(-1).cars[k].phase+car.phase+frequency*dt+df*dt*dt*30;
   const distance=Math.hypot(car.body[0]-a.camera.position[0],car.body[1]-a.camera.position[1],car.body[2]-a.camera.position[2]),gain=.16/(1+distance/15),throttle=car.throttle+(next.throttle-car.throttle)*u,engine=(Math.sin(tau*phase)+.32*Math.sin(tau*phase*2)+.14*Math.sin(tau*phase*3))*(.30+.70*throttle),grit=noise(i,914+k)*(.035+.055*throttle),skid=Math.min(.11,car.slip/160_000)*noise(i>>1,332+k),pan=Math.max(-.7,Math.min(.7,(car.body[0]-a.camera.position[0])/30)),sound=(engine+grit+skid)*gain;
   left+=sound*(1-pan*.4);right+=sound*(1+pan*.4);
  }
  const wind=.008*noise(i>>3,214);pcm[n*2]=Math.tanh(left+wind);pcm[n*2+1]=Math.tanh(right+wind);
 }
 return pcm;
}
