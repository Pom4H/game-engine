import {synthesizeEvent} from '../../dist/audio/synth.js';
export const liveAuthority=true;
const tau=Math.PI*2;
function noise(i,seed){let n=Math.imul(i,374761393)^seed;n=Math.imul(n^(n>>>13),1274126177);return((n^(n>>>16))>>>0)/2147483648-1;}
/** The image and sound share authority samples: collision energy, tyre slip,
 * exposed substrate and snow material. No repeating soundtrack clock. */
export function renderAudio({startTime,duration,sampleRate=48000,frames}){
 if(!Number.isFinite(startTime)||startTime<0||!Number.isFinite(duration)||duration<=0||duration>10||sampleRate!==48000||!frames?.length)throw Error('Invalid live soundtrack range');
 const count=Math.round(duration*sampleRate),first=Math.round(startTime*sampleRate),pcm=new Float32Array(count*2),startTick=frames[0].tick;
 const gains=frames.map(frame=>frame.cars.map(car=>{const p=car.body,eye=frame.camera.position,target=frame.camera.target,dx=target[0]-eye[0],dz=target[2]-eye[2],len=Math.hypot(dx,dz)||1,dist=Math.hypot(p[0]-eye[0],p[1]-eye[1],p[2]-eye[2]),pan=Math.max(-.8,Math.min(.8,((p[0]-eye[0])*(-dz)+(p[2]-eye[2])*dx)/(len*Math.max(6,dist))));return{gain:.16/(1+dist/18),pan};}));
 for(let n=0;n<count;n++){
  const i=first+n,t=i/sampleRate,absolute=Math.floor(t*60),index=Math.max(0,Math.min(frames.length-2,absolute-startTick)),a=frames[index],b=frames[index+1],dt=t-a.tick/60,u=Math.max(0,Math.min(1,dt*60));let left=0,right=0;
  for(let k=0;k<a.cars.length;k++){
   const car=a.cars[k],next=b.cars[k],frequency=car.rpm/20,df=(next.rpm-car.rpm)/20,phase=car.phase+frequency*dt+df*dt*dt*30,{gain,pan}=gains[index][k],throttle=car.throttle+(next.throttle-car.throttle)*u;
   const engine=(Math.sin(tau*phase)+.32*Math.sin(tau*phase*2)+.14*Math.sin(tau*phase*3))*(.30+.70*throttle);
   const work=Math.min(1,Math.sqrt(Math.max(0,car.slip)/100000)),depth=car.surface?.depthM??.48,exposure=1-Math.min(1,depth/.05),slush=car.surface?.liquidFraction??0;
   const snow=(noise(i>>3,330+k)*.15+noise(i>>5,510+k)*.20)*(1-exposure)*(1-slush*.65);
   const tyre=(Math.sin(t*2700+noise(i>>8,77)*.4)*.11+noise(i>>1,400+k)*.08)*exposure;
   const sound=(engine+(snow+tyre)*work+noise(i,910+k)*.035*throttle)*gain;left+=sound*(1-pan*.5);right+=sound*(1+pan*.5);
  }
  const wind=.006*noise(i>>3,214);pcm[n*2]=left+wind;pcm[n*2+1]=right+wind;
 }
 const events=frames.flatMap(f=>f.events??[]).filter(e=>e.time<startTime+duration&&e.time+.8>=startTime);
 for(const event of events){const offset=Math.round((event.time-startTime)*sampleRate),index=Math.max(0,Math.min(frames.length-1,Math.floor(event.time*60)-startTick)),camera=frames[index].camera,dist=Math.hypot(...event.point.map((v,k)=>v-camera.position[k])),gain=1/(1+dist/12);
  if(['impact','fracture','mechanism','horn'].includes(event.type)){
   const voice=synthesizeEvent(event,sampleRate);for(let n=Math.max(0,-offset);n<voice.left.length&&offset+n<count;n++){pcm[(offset+n)*2]+=voice.left[n]*gain;pcm[(offset+n)*2+1]+=voice.right[n]*gain;}
  }else{
   const length=Math.round((event.type==='shovel'?.23:.13)*sampleRate),strength=Math.min(.2,.03+Math.sqrt(event.energy)*.016)*gain;
   for(let n=Math.max(0,-offset);n<length&&offset+n<count;n++){const value=noise((Math.round(event.time*sampleRate)+n)>>2,event.id)*Math.exp(-n/length*5)*strength;pcm[(offset+n)*2]+=value;pcm[(offset+n)*2+1]+=value;}
  }
 }
 for(let n=0;n<pcm.length;n++)pcm[n]=Math.tanh(pcm[n]);return pcm;
}
