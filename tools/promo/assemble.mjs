import {readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {shots} from './shots.mjs';
import {renderAmbience,renderAudio,wavBytes} from '../../dist/index.js';
const root=fileURLToPath(new URL('../../',import.meta.url)),out=join(root,'artifacts/promo'),sampleRate=48000;
const total=shots.reduce((s,c)=>s+c.duration,0),left=new Float32Array(total*sampleRate),right=new Float32Array(left.length);
const lerp=(a,b,t)=>a.map((v,i)=>v+(b[i]-v)*t),ease=t=>t*t*(3-2*t);
let offset=0;
for(const shot of shots){
 const raw=JSON.parse(await readFile(join(out,`${shot.id}-telemetry.json`),'utf8')),unique=[...new Map(raw.map(f=>[f.t,f])).values()];
 const frames=unique.map(f=>({time:f.t,listener:f.camera,target:shot.track?[-32+(f.t||1/60)*4.8,1.05,-1.6]:lerp(shot.lookFrom,shot.lookTo,ease(f.t/shot.duration)),vehicle:f.car,speedMps:4.8}));
 const a=renderAmbience(frames,shot.duration,{sampleRate,seed:2026,windSpeedMps:shot.set==='laboratory'?0:shot.set==='courtyard'?1.1:.7,vehicleGain:shot.set==='laboratory'?0:shot.id==='passage'?.44:.25});
 if(shot.set==='laboratory'){
  const events=JSON.parse(await readFile(join(out,`${shot.id}-events.json`),'utf8')).map(e=>({...e,time:e.time/(shot.simulationRate??1)}));
  const effects=renderAudio(events,shot.duration,sampleRate);for(let i=0;i<a.left.length;i++){a.left[i]+=effects.left[i]*.8;a.right[i]+=effects.right[i]*.8;}
 }
 for(let i=0;i<a.left.length;i++){const t=i/sampleRate,fade=Math.min(1,t/.18,(shot.duration-t)/.25);left[offset+i]+=a.left[i]*fade;right[offset+i]+=a.right[i]*fade;}
 offset+=a.left.length;
}
// Original sparse score: slowly evolving D minor / Bb / F / C, no third-party samples.
const chords=[[146.832,220,293.665,349.228],[116.541,174.614,233.082,293.665],[130.813,196,261.626,329.628],[130.813,196,261.626,293.665]];
for(let c=0;c<Math.ceil(total/7);c++){
 const start=c*7,frequencies=chords[c%4];
 for(let j=0;j<frequencies.length;j++){
  const begin=start+j*.19,end=Math.min(total,begin+10),n=Math.floor((end-begin)*sampleRate),at=Math.floor(begin*sampleRate),hz=frequencies[j],pan=(j/3-.5)*.45;
  for(let i=0;i<n;i++){const t=i/sampleRate,env=(1-Math.exp(-t/1.5))*Math.exp(-t/4)*Math.min(1,(end-begin-t)/1.4),tone=(Math.sin(2*Math.PI*hz*t)+.35*Math.sin(2*Math.PI*hz*1.0018*t)+.13*Math.sin(2*Math.PI*hz*2*t))*.012*env;left[at+i]+=tone*(1-pan);right[at+i]+=tone*(1+pan);}
 }
 // A soft felt-like high note marks each phrase, with a short stereo tail.
 const begin=start+.4,hz=frequencies[2]*2;
 for(let i=0;i<sampleRate*4&&Math.floor(begin*sampleRate)+i<left.length;i++){const t=i/sampleRate,v=.020*(1-Math.exp(-t*80))*Math.exp(-t*1.4)*(Math.sin(2*Math.PI*hz*t)+.2*Math.sin(2*Math.PI*hz*2.01*t)),at=Math.floor(begin*sampleRate)+i;left[at]+=v*.7;right[at]+=v*.6;const delay=Math.floor(.21*sampleRate);if(at+delay<right.length)right[at+delay]+=v*.16;}
}
for(let i=0;i<left.length;i++){const t=i/sampleRate,fade=Math.min(1,t/1.5,(total-t)/2);left[i]=Math.tanh(left[i]*1.8)*fade;right[i]=Math.tanh(right[i]*1.8)*fade;}
await writeFile(join(out,'winter-city-score.wav'),wavBytes({left,right,sampleRate}));
const run=(cmd,args)=>new Promise((resolve,reject)=>{const p=spawn(cmd,args,{stdio:'inherit'});p.on('error',reject);p.on('exit',code=>code===0?resolve():reject(new Error(`${cmd}: ${code}`)));});
await writeFile(join(out,'edit.ffconcat'),'ffconcat version 1.0\n'+shots.map(s=>`file '${s.id}-silent.mp4'`).join('\n')+'\n');
await run('ffmpeg',['-y','-hide_banner','-loglevel','warning','-f','concat','-safe','0','-i',join(out,'edit.ffconcat'),'-i',join(out,'winter-city-score.wav'),'-map','0:v:0','-map','1:a:0','-c:v','copy','-c:a','aac','-b:a','256k','-af','loudnorm=I=-18:TP=-1.5:LRA=10','-ar','48000','-movflags','+faststart','-t',String(total),join(out,'game-engine-winter-promo-1080p.mp4')]);
// A shorter city scene reel keeps the complete opening, snow detail and evening shots.
const cityIds=['arrival','snowbank','evening'];await writeFile(join(out,'city.ffconcat'),'ffconcat version 1.0\n'+cityIds.map(id=>`file '${id}-silent.mp4'`).join('\n')+'\n');
const edit=[];let cursor=0;for(const s of shots){if(cityIds.includes(s.id))edit.push({start:cursor,duration:s.duration});cursor+=s.duration;}
const sceneLength=edit.reduce((v,e)=>v+e.duration,0),sl=new Float32Array(sceneLength*sampleRate),sr=new Float32Array(sl.length);let at=0;for(const e of edit){const start=Math.round(e.start*sampleRate),count=e.duration*sampleRate;for(let i=0;i<count;i++){const fade=Math.min(1,i/sampleRate/.2,(count-i)/sampleRate/.4);sl[at+i]=left[start+i]*fade;sr[at+i]=right[start+i]*fade;}at+=count;}
await writeFile(join(out,'winter-city-scene.wav'),wavBytes({left:sl,right:sr,sampleRate}));await run('ffmpeg',['-y','-hide_banner','-loglevel','warning','-f','concat','-safe','0','-i',join(out,'city.ffconcat'),'-i',join(out,'winter-city-scene.wav'),'-map','0:v:0','-map','1:a:0','-c:v','copy','-c:a','aac','-b:a','256k','-af','loudnorm=I=-18:TP=-1.5:LRA=10','-ar','48000','-movflags','+faststart','-t',String(sceneLength),join(out,'winter-city-scene-1080p.mp4')]);
console.log(JSON.stringify({promoSeconds:total,sceneSeconds:sceneLength,frames:total*30,render:'actual WebGPU engine frames',audio:'original procedural ambience and score'}));
