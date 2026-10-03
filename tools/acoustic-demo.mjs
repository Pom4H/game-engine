import {mkdir,writeFile} from 'node:fs/promises';
import {
  AcousticWaveField,Scene,syncSceneAcousticBoundaries,traceAcousticTransfer,
  synthesizeEvent,renderAcousticTransfer,wavBytes,
} from '../dist/index.js';

const out='artifacts/acoustic-demo';await mkdir(out,{recursive:true});
const source=[3,2.25,3],listener=[9,2.25,3];
const frame=[
  {id:'bottom',position:[6,.5,3],mesh:{kind:'box',size:[.25,1,6]},body:{mass:0}},
  {id:'top',position:[6,4.25,3],mesh:{kind:'box',size:[.25,1.5,6]},body:{mass:0}},
  {id:'left',position:[6,2.25,.75],mesh:{kind:'box',size:[.25,2.5,1.5]},body:{mass:0}},
  {id:'right',position:[6,2.25,4.875],mesh:{kind:'box',size:[.25,2.5,2.25]},body:{mass:0}},
];
function transfer(open){
  const scene=new Scene({version:1,ground:-100,entities:[...frame,{id:'door',position:[6,2.25,3],rotation:[0,open?Math.PI/2:0,0],mesh:{kind:'box',size:[.25,2.5,1.5]},body:{mass:0}}]});
  const field=new AcousticWaveField({size:[24,10,12],origin:[0,0,0],cellSizeM:.5,waveSpeedMps:343,densityKgM3:1.225,velocityDampingPerSecond:7});
  syncSceneAcousticBoundaries(field,scene.entities.values());
  return traceAcousticTransfer(field,source,listener,{durationS:.65,sourceRadiusM:.65,acousticEnergyJ:1,maxReflections:6});
}
const closed=transfer(false),open=transfer(true);
const dry=synthesizeEvent({type:'impact',id:9001,time:0,point:source,normal:[1,0,0],a:'demo-source',b:'ground',materialA:'steel',materialB:'default',energy:480,impulse:38,speed:14,size:.9},48_000);
const openAudio=renderAcousticTransfer(dry,open,{outputDurationS:1.4}),closedAudio=renderAcousticTransfer(dry,closed,{outputDurationS:1.4});
const peak=a=>{let p=0;for(const channel of [a.left,a.right])for(const sample of channel)p=Math.max(p,Math.abs(sample));return p;};
const openPeak=peak(openAudio),scale=openPeak>1e-9?.92/openPeak:1;
for(const audio of [openAudio,closedAudio])for(const channel of [audio.left,audio.right])for(let i=0;i<channel.length;i++)channel[i]*=scale;
await writeFile(`${out}/door-open.wav`,wavBytes(openAudio));await writeFile(`${out}/door-closed.wav`,wavBytes(closedAudio));
await writeFile(`${out}/transfer.json`,JSON.stringify({source,listener,closed,open,comparison:{directGainRatio:closed.direct.gain/Math.max(1e-12,open.direct.gain),openReflections:open.reflections.length,closedReflections:closed.reflections.length}},null,2));
console.log(JSON.stringify({open:{gain:open.direct.gain,delayMs:open.direct.delayS*1000,lowpassHz:open.direct.lowpassHz,reflections:open.reflections.length,rt60:open.late.rt60S},closed:{gain:closed.direct.gain,delayMs:closed.direct.delayS*1000,lowpassHz:closed.direct.lowpassHz,reflections:closed.reflections.length,rt60:closed.late.rt60S}},null,2));
