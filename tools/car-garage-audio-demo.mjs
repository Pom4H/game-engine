import {mkdir,writeFile} from 'node:fs/promises';
import {
  AcousticWaveField,Scene,syncSceneAcousticBoundaries,traceAcousticTransfer,
  renderAmbience,renderAcousticTrajectory,wavBytes,
} from '../dist/index.js';

const out='artifacts/car-garage-audio';await mkdir(out,{recursive:true});
const duration=7.5,sampleRate=48_000;
const listener=[6.6,1.65,4.8],target=[0,1.5,3];
const path=[
  {time:0,vehicle:[-8,1.0,3],speedMps:5.8},
  {time:1,vehicle:[-5.4,1.0,3],speedMps:5.8},
  {time:2,vehicle:[-2.8,1.0,3],speedMps:5.4},
  {time:3,vehicle:[-.4,1.0,3],speedMps:4.8},
  {time:4,vehicle:[1.7,1.0,3],speedMps:3.8},
  {time:5,vehicle:[3.4,1.0,3],speedMps:2.8},
  {time:6,vehicle:[4.7,1.0,3],speedMps:1.6},
  {time:7.5,vehicle:[5.4,1.0,3],speedMps:.55},
];
const garageEntities=[
  {id:'floor',position:[4,-.125,3],mesh:{kind:'box',size:[8,.25,6]},body:{mass:0}},
  {id:'roof',position:[4,4.125,3],mesh:{kind:'box',size:[8,.25,6]},body:{mass:0}},
  {id:'left-wall',position:[4,2,0],mesh:{kind:'box',size:[8,4,.25]},body:{mass:0}},
  {id:'right-wall',position:[4,2,6],mesh:{kind:'box',size:[8,4,.25]},body:{mass:0}},
  {id:'back-wall',position:[8,2,3],mesh:{kind:'box',size:[.25,4,6]},body:{mass:0}},
  {id:'front-left',position:[0,2,.7],mesh:{kind:'box',size:[.25,4,1.4]},body:{mass:0}},
  {id:'front-right',position:[0,2,5.3],mesh:{kind:'box',size:[.25,4,1.4]},body:{mass:0}},
  {id:'front-top',position:[0,3.45,3],mesh:{kind:'box',size:[.25,1.1,3.2]},body:{mass:0}},
];
const scene=new Scene({version:1,ground:-100,entities:garageEntities});
const field=new AcousticWaveField({size:[42,10,14],origin:[-10,0,-.5],cellSizeM:.5,waveSpeedMps:343,densityKgM3:1.225,velocityDampingPerSecond:7});
syncSceneAcousticBoundaries(field,scene.entities.values());

const controlTimes=[];for(let t=0;t<=duration+1e-9;t+=.5)controlTimes.push(Math.min(duration,t));
const positionAt=time=>{
  let i=0;while(i<path.length-2&&path[i+1].time<time)i++;
  const a=path[i],b=path[Math.min(i+1,path.length-1)],u=Math.max(0,Math.min(1,(time-a.time)/Math.max(1e-9,b.time-a.time)));
  return {
    vehicle:a.vehicle.map((v,k)=>v+(b.vehicle[k]-v)*u),
    speedMps:a.speedMps+(b.speedMps-a.speedMps)*u,
  };
};

const transfers=[];
for(const time of controlTimes){
  const state=positionAt(time);
  const transfer=traceAcousticTransfer(field,state.vehicle,listener,{durationS:.55,sourceRadiusM:.65,acousticEnergyJ:1,maxReflections:6});
  transfers.push({time,transfer,vehicle:state.vehicle,speedMps:state.speedMps});
}

const dryFrames=path.map(frame=>({time:frame.time,listener:frame.vehicle,target:[frame.vehicle[0]+1,frame.vehicle[1],frame.vehicle[2]],vehicle:frame.vehicle,speedMps:frame.speedMps,puddle:0}));
const dry=renderAmbience(dryFrames,duration,{sampleRate,seed:221,windSpeedMps:0,vehicleGain:.78});
const wet=renderAcousticTrajectory(dry,transfers.map(({time,transfer})=>({time,transfer})),{outputDurationS:duration+2.2,crossfadeS:.5,listenerRight:[0,0,1],level:3.4});

let peak=0;for(const channel of [wet.left,wet.right])for(const sample of channel)peak=Math.max(peak,Math.abs(sample));
const scale=peak>.98?.98/peak:1;for(const channel of [wet.left,wet.right])for(let i=0;i<channel.length;i++)channel[i]*=scale;
await writeFile(`${out}/car-into-garage.wav`,wavBytes(wet));
await writeFile(`${out}/car-dry.wav`,wavBytes(dry));
await writeFile(`${out}/trajectory.json`,JSON.stringify({
  listener,path,
  transferFrames:transfers.map(({time,vehicle,speedMps,transfer})=>({
    time,vehicle,speedMps,
    directGain:transfer.direct.gain,
    delayMs:transfer.direct.delayS*1000,
    lowpassHz:transfer.direct.lowpassHz,
    reflections:transfer.reflections.length,
    rt60S:transfer.late.rt60S,
    lateGain:transfer.late.gain,
  })),
},null,2));
console.log(JSON.stringify(transfers.map(({time,vehicle,transfer})=>({time,x:vehicle[0],gain:+transfer.direct.gain.toFixed(3),delayMs:+(transfer.direct.delayS*1000).toFixed(1),reflections:transfer.reflections.length,rt60:+transfer.late.rt60S.toFixed(2)})),null,2));
