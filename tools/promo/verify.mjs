import {readFile,writeFile,mkdir,stat,access} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import {shots} from './shots.mjs';

const exec=promisify(execFile),root=fileURLToPath(new URL('../../',import.meta.url)),out=join(root,'artifacts/promo-v3');
const fps=30,expectedIds=['arrival','m3','walk','footsteps','snowbank','evening'];
const limits={drawCalls:2200,triangles:4_000_000,snowTiles:256,detailedTiles:28,footprints:256,sprayParticles:96};
const sourceM3=JSON.parse(await readFile(join(root,'tools/promo/assets/m3-provenance.json'),'utf8'));
const movie='game-engine-winter-promo-1080p.mp4',sounds='winter-street-sounds.wav';
const probe=async file=>JSON.parse((await exec('ffprobe',['-v','error','-count_frames','-show_streams','-show_format','-of','json',file],{maxBuffer:4e6})).stdout);
const readJSON=async name=>JSON.parse(await readFile(join(out,name),'utf8'));
const integerWithin=(value,min,max,label)=>assert.ok(Number.isSafeInteger(value)&&value>=min&&value<=max,`${label}: expected integer ${min}..${max}, received ${value}`);
const finiteVector=(value,label)=>assert.ok(Array.isArray(value)&&value.length===3&&value.every(Number.isFinite),`${label} must be a finite vec3`);
const close=(actual,expected,label,tolerance=1e-6)=>assert.ok(Number.isFinite(actual)&&Math.abs(actual-expected)<=tolerance,`${label}: expected ${expected}, received ${actual}`);

assert.deepEqual(shots.map(s=>s.id),expectedIds,'The complete six-shot edit is required');
assert.equal(shots.reduce((sum,s)=>sum+s.duration,0),48,'The film must contain all 48 seconds');
let end=0;for(const s of shots){assert.equal(s.offset,end,`${s.id}: cuts must preserve the simulation timeline`);assert.ok(['street','courtyard'].includes(s.set));end+=s.duration;}
await mkdir(join(out,'delivery-qa'),{recursive:true});
const report={version:3,capture:'offline WebGPU frames, fixed 60 Hz simulation, 30 fps export',limits,captures:[],deliveries:[],footsteps:[]};
let lastTime=-1,lastCount=-1;
for(const s of shots){
 const e=await readJSON(`${s.id}-evidence.json`),p=await probe(join(out,`${s.id}-silent.mp4`)),v=p.streams.find(stream=>stream.codec_type==='video');
 assert.equal(e.backend,'webgpu');assert.deepEqual(e.errors,[],`${s.id}: GPU validation errors`);
 assert.equal(e.width,1920);assert.equal(e.height,1080);assert.ok(v,`${s.id}: missing video stream`);
 assert.equal(v.width,1920);assert.equal(v.height,1080);assert.equal(v.r_frame_rate,`${fps}/1`);assert.equal(Number(v.nb_read_frames),s.duration*fps);
 integerWithin(e.drawCalls,1,limits.drawCalls,`${s.id}: draw budget`);integerWithin(e.triangles,1,limits.triangles,`${s.id}: geometry budget`);
 // These records come from Scene.lastExecution, not the movie player's own labels.
 assert.ok(Array.isArray(e.systems),`${s.id}: missing native kernel execution evidence`);
 assert.equal(new Set(e.systems).size,e.systems.length,`${s.id}: repeated engine systems`);
 const animation=e.systems.indexOf('engine:animation'),physics=e.systems.indexOf('engine:physics'),contacts=e.systems.indexOf('engine:surface-contacts');
 assert.ok(animation>=0&&physics>animation&&contacts>physics,`${s.id}: required native order is animation → physics → surface contacts`);
 assert.ok(e.systems.includes('engine:surfaces')&&e.systems.includes('engine:clock'),`${s.id}: incomplete native world update`);
 const native=e.nativeContacts;assert.ok(native,`${s.id}: missing native surface-contact inspection`);
 assert.equal(native.wheelContacts,4,`${s.id}: the M3 must bind four native wheel contacts`);
 assert.equal(native.surfaces,1,`${s.id}: the authored walk must bind one native snow surface`);
 integerWithin(native.tiles,1,limits.snowTiles,`${s.id}: native snow tiles`);
 integerWithin(native.detailedTiles,1,Math.min(native.tiles,limits.detailedTiles),`${s.id}: adaptive tile budget`);
 integerWithin(native.footprints,1,limits.footprints,`${s.id}: retained footprints`);
 integerWithin(native.particles,0,limits.sprayParticles,`${s.id}: active spray`);
 integerWithin(native.particleEntities,native.particles,limits.sprayParticles,`${s.id}: allocated spray`);
 assert.equal(native.footprints,e.footprints);assert.equal(native.sprayEmitted,e.sprayEmitted);
 assert.ok(Number.isFinite(native.wetness)&&native.wetness>=0&&native.wetness<=1);
 assert.equal(e.m3.sha256,sourceM3.sha256,`${s.id}: source M3 changed`);
 assert.equal(e.m3.sourceBytes,sourceM3.sourceBytes,`${s.id}: reference byte size changed`);
 assert.match(e.m3.representation,/parametric control sections/i);
 integerWithin(e.m3.profileBytes,1,4096,`${s.id}: compact M3 profile bytes`);
 assert.ok(e.m3.sourceBytes/e.m3.profileBytes>10,`${s.id}: M3 profile no longer provides >10x source-data reduction`);
 integerWithin(e.m3.triangles,1000,10000,`${s.id}: generated M3 triangles`);
 integerWithin(e.m3.parts,20,64,`${s.id}: generated M3 parts`);

 const raw=await readJSON(`${s.id}-telemetry.json`),frames=[...new Map(raw.map(f=>[f.t,f])).values()],stamps=await readJSON(`${s.id}-footsteps.json`);
 assert.equal(frames.length,s.duration*fps,`${s.id}: incomplete frame telemetry`);
 assert.ok(frames[0].worldTime>lastTime);assert.ok(frames[0].footprints>=lastCount);
 for(const [i,f] of frames.entries()){
  close(f.t,i/fps,`${s.id}: exported frame time ${i}`);
  close(f.worldTime,Math.max(1/60,s.offset+i/fps),`${s.id}: fixed simulation time ${i}`);
  for(const key of ['camera','target','car','person'])finiteVector(f[key],`${s.id}: ${key}`);
  assert.ok(Number.isFinite(f.snowfallRate)&&f.snowfallRate>0,`${s.id}: missing snowfall`);
  assert.ok(Number.isFinite(f.puddle)&&f.puddle>=0&&f.puddle<=1,`${s.id}: invalid native wet-contact amount`);
  integerWithin(f.footprints,1,limits.footprints,`${s.id}: footprint count`);
  if(i){assert.ok(f.worldTime>frames[i-1].worldTime);assert.ok(f.footprints>=frames[i-1].footprints);}
 }
 close(e.time,frames.at(-1).worldTime,`${s.id}: inspected simulation time`);close(e.tick/60,e.time,`${s.id}: simulation tick`);
 assert.equal(e.footprints,frames.at(-1).footprints);
 integerWithin(stamps.length,1,limits.footprints,`${s.id}: native footstep records`);
 assert.equal(stamps.length,e.footprints,`${s.id}: exported contact and deformation records differ`);
 assert.equal(new Set(stamps.map(c=>c.sequence)).size,stamps.length,`${s.id}: duplicate contact records`);
 assert.deepEqual([...new Set(stamps.map(c=>c.foot))].sort(),['walker:left','walker:right']);
 const plantedAt=new Map();
 for(const c of stamps){
  integerWithin(c.sequence,0,Number.MAX_SAFE_INTEGER,`${s.id}: contact sequence`);finiteVector(c.position,`${s.id}: footprint position`);
  assert.equal(c.surfaceId,'walk-1',`${s.id}: footsteps must land on the snowy walkway`);
  assert.ok(Number.isFinite(c.time)&&c.time>=0&&c.time<=e.time+1e-6);
  assert.ok(Number.isFinite(c.depth)&&c.depth>0&&c.depth<=.025&&Number.isFinite(c.yaw));
  if(plantedAt.has(c.foot))assert.ok(c.time-plantedAt.get(c.foot)>.25,`${s.id}: repeated stamp while a foot remained planted`);
  plantedAt.set(c.foot,c.time);
 }
 const onScreen=stamps.filter(c=>c.time>=s.offset&&c.time<s.offset+s.duration);
 assert.ok(onScreen.length>=8,`${s.id}: missing visible stepping sequence`);
 const maxWaterContact=Math.max(...frames.map(f=>f.puddle));
 if(s.id==='m3'){assert.ok(e.sprayEmitted>0,`${s.id}: no native tyre spray`);assert.ok(maxWaterContact>.1,`${s.id}: tyres never reached water`);}
 report.captures.push({id:s.id,frames:Number(v.nb_read_frames),simulationStart:frames[0].worldTime,simulationEnd:e.time,triangles:e.triangles,drawCalls:e.drawCalls,objects:e.objects,systems:e.systems,nativeContacts:native,m3:e.m3,errors:e.errors});
 report.footsteps.push({id:s.id,contacts:onScreen.length,totalFootprints:e.footprints,sprayEmitted:e.sprayEmitted,maxWaterContact});
 lastTime=frames.at(-1).worldTime;lastCount=frames.at(-1).footprints;
}

const file=join(out,movie),p=await probe(file),v=p.streams.find(s=>s.codec_type==='video'),a=p.streams.find(s=>s.codec_type==='audio');
assert.ok(v&&a,'Final movie requires both video and audio');assert.equal(v.width,1920);assert.equal(v.height,1080);assert.equal(v.r_frame_rate,`${fps}/1`);assert.equal(Number(v.nb_read_frames),1440);assert.equal(v.codec_name,'h264');assert.equal(a.codec_name,'aac');assert.equal(a.channels,2);assert.equal(a.sample_rate,'48000');close(Number(p.format.duration),48,'Final movie duration',.10);
await exec('ffmpeg',['-v','error','-i',file,'-f','null','-'],{maxBuffer:4e6});
const loud=await exec('ffmpeg',['-hide_banner','-nostats','-i',file,'-af','loudnorm=I=-18:TP=-1.5:LRA=10:print_format=json','-f','null','-'],{maxBuffer:4e6});
const begin=loud.stderr.lastIndexOf('{'),loudness=JSON.parse(loud.stderr.slice(begin,loud.stderr.indexOf('}',begin)+1));
assert.ok(Number(loudness.input_tp)<-.8,'Movie audio peak exceeds the delivery ceiling');assert.ok(Number(loudness.input_i)>-25,'Movie audio is unexpectedly quiet');
report.deliveries.push({name:movie,duration:Number(p.format.duration),frames:Number(v.nb_read_frames),width:v.width,height:v.height,fps:v.r_frame_rate,codec:v.codec_name,audio:a.codec_name,channels:a.channels,loudness});
const audioProbe=await probe(join(out,sounds)),audioStream=audioProbe.streams.find(s=>s.codec_type==='audio');assert.ok(audioStream);assert.equal(audioStream.channels,2);assert.equal(audioStream.sample_rate,'48000');close(Number(audioProbe.format.duration),48,'Sound-only WAV duration',.02);
report.deliveries.push({name:sounds,duration:Number(audioProbe.format.duration),channels:audioStream.channels,sampleRate:Number(audioStream.sample_rate),codec:audioStream.codec_name});

let time=0;
for(const s of shots){
 for(const [label,t] of [['start',.2],['mid',s.duration/2],['end',s.duration-.15]])await exec('ffmpeg',['-y','-v','error','-ss',String(time+t),'-i',file,'-frames:v','1',join(out,'delivery-qa',`${s.id}-${label}.png`)]);
 time+=s.duration;
}
await writeFile(join(out,'verification.json'),JSON.stringify(report,null,2));
const digest=async path=>({bytes:(await stat(path)).size,sha256:createHash('sha256').update(await readFile(path)).digest('hex')});
const git=async args=>(await exec('git',args,{cwd:root})).stdout.trim();
const manifest={version:3,verifiedAtUTC:new Date().toISOString(),source:{head:await git(['rev-parse','HEAD']),branch:await git(['branch','--show-current']),workingTreeDirty:!!(await git(['status','--porcelain']))},capture:{backend:'WebGPU',mode:'offline fixed-step frame capture',width:1920,height:1080,frames:1440,fps,durationSeconds:48},outputs:[],assets:[]};
for(const name of [movie,sounds,'verification.json'])manifest.outputs.push({name,...await digest(join(out,name))});
try{await access(join(out,'engine-before-after-metadata.json'));
 const comparison=await readJSON('engine-before-after-metadata.json'),current=await digest(file);
 assert.equal(comparison.sources.v3.video.sha256,current.sha256,'Comparison must use this final V3 movie');
 for(const name of ['engine-before-after-1080p.mp4','engine-before-after-metadata.json'])manifest.outputs.push({name,...await digest(join(out,name))});
}catch(error){if(error.code!=='ENOENT')throw error;}
for(const [name,description] of [['snow-granular.png','AI-generated repeating material image sampled on real engine geometry; not a scenery frame or background'],['brick-weathered.png','AI-generated repeating masonry material sampled on real facade geometry'],['m3-provenance.json','Source reference provenance for the procedural M3 profile'],['material-provenance.json','Exact generation prompts and image provenance']])manifest.assets.push({name,description,...await digest(join(root,'tools/promo/assets',name))});
manifest.assets.push({name:'src/vehicles/m3.ts',description:'Compact authored M3 control profile; no imported FBX geometry at runtime',...await digest(join(root,'src/vehicles/m3.ts'))});
manifest.assets.push({name:'src/vehicles/passenger.ts',description:'Reusable passenger-car geometry and structural-cage generator',...await digest(join(root,'src/vehicles/passenger.ts'))});
await writeFile(join(out,'capture-manifest.json'),JSON.stringify(manifest,null,2));
console.log(JSON.stringify(report,null,2));
