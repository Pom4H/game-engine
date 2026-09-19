import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import {shots} from './shots.mjs';
const exec=promisify(execFile),out=fileURLToPath(new URL('../../artifacts/promo-v2/',import.meta.url));
await mkdir(join(out,'delivery-qa'),{recursive:true});
const probe=async file=>JSON.parse((await exec('ffprobe',['-v','error','-count_frames','-show_streams','-show_format','-of','json',file],{maxBuffer:4e6})).stdout);
const report={captures:[],deliveries:[],footsteps:[]};
for(const s of shots){const e=JSON.parse(await readFile(join(out,`${s.id}-evidence.json`),'utf8'));assert.equal(e.backend,'webgpu');assert.deepEqual(e.errors,[]);assert.equal(e.width,1920);assert.equal(e.height,1080);const p=await probe(join(out,`${s.id}-silent.mp4`)),v=p.streams.find(s=>s.codec_type==='video');assert.equal(Number(v.nb_read_frames),s.duration*30);report.captures.push({id:s.id,frames:Number(v.nb_read_frames),triangles:e.triangles,objects:e.objects,errors:e.errors});}
for(const [name,seconds] of [['game-engine-winter-promo-1080p.mp4',shots.reduce((v,s)=>v+s.duration,0)]]){
 const file=join(out,name),p=await probe(file),v=p.streams.find(s=>s.codec_type==='video'),a=p.streams.find(s=>s.codec_type==='audio');assert.equal(v.width,1920);assert.equal(v.height,1080);assert.equal(v.r_frame_rate,'30/1');assert.equal(Number(v.nb_read_frames),seconds*30);assert.equal(a.channels,2);assert.equal(a.sample_rate,'48000');assert.ok(Math.abs(Number(p.format.duration)-seconds)<.10);
 await exec('ffmpeg',['-v','error','-i',file,'-f','null','-'],{maxBuffer:4e6});
 const loud=await exec('ffmpeg',['-hide_banner','-nostats','-i',file,'-af','loudnorm=I=-18:TP=-1.5:LRA=10:print_format=json','-f','null','-'],{maxBuffer:4e6});
 const begin=loud.stderr.lastIndexOf('{');const loudness=JSON.parse(loud.stderr.slice(begin,loud.stderr.indexOf('}',begin)+1));assert.ok(Number(loudness.input_tp)<-.8);assert.ok(Number(loudness.input_i)>-25);
 report.deliveries.push({name,duration:Number(p.format.duration),frames:Number(v.nb_read_frames),width:v.width,height:v.height,fps:v.r_frame_rate,codec:v.codec_name,audio:a.codec_name,channels:a.channels,loudness});
}
let lastTime=-1,lastCount=-1;for(const s of shots){
 const raw=JSON.parse(await readFile(join(out,`${s.id}-telemetry.json`),'utf8')),frames=[...new Map(raw.map(f=>[f.t,f])).values()],contacts=JSON.parse(await readFile(join(out,`${s.id}-footsteps.json`),'utf8')),evidence=JSON.parse(await readFile(join(out,`${s.id}-evidence.json`),'utf8'));
 assert.equal(frames.length,s.duration*30);assert.ok(frames.every(f=>f.snowfallRate>0));assert.ok(frames[0].worldTime>=lastTime);assert.ok(frames[0].footprints>=lastCount);
 for(let i=1;i<frames.length;i++){assert.ok(frames[i].worldTime>frames[i-1].worldTime);assert.ok(frames[i].footprints>=frames[i-1].footprints);}
 assert.ok(contacts.length>0);assert.equal(new Set(contacts.map(c=>c.sequence)).size,contacts.length);assert.equal(evidence.m3.triangles,9798);assert.ok(evidence.drawCalls<1600);
 const onScreen=contacts.filter(c=>c.time>=s.offset&&c.time<s.offset+s.duration);assert.ok(onScreen.length>=8);report.footsteps.push({id:s.id,contacts:onScreen.length,totalFootprints:evidence.footprints,sprayEmitted:evidence.sprayEmitted,maxWaterContact:Math.max(...frames.map(f=>f.puddle))});
 if(s.id==='m3'){assert.ok(evidence.sprayEmitted>0);assert.ok(frames.some(f=>f.puddle>.1));}
 lastTime=frames.at(-1).worldTime;lastCount=frames.at(-1).footprints;
}
assert.ok(shots.every(s=>s.set!=='laboratory'&&s.set!=='square'));
let time=0;for(const s of shots){for(const [label,t] of [['start',.2],['mid',s.duration/2],['end',s.duration-.15]])await exec('ffmpeg',['-y','-v','error','-ss',String(time+t),'-i',join(out,'game-engine-winter-promo-1080p.mp4'),'-frames:v','1',join(out,'delivery-qa',`${s.id}-${label}.png`)]);time+=s.duration;}
await writeFile(join(out,'verification.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
