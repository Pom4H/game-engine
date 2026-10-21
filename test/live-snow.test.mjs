import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Scene} from '../dist/scene/scene.js';
import {SnowMatter} from '../dist/environment/snow-matter.js';
import {Drivetrain} from '../dist/vehicles/drivetrain.js';
import spec,{createAuthority,initializeRuntime,seekRuntime} from '../tools/snow-city/scene.mjs';
import {LiveSnowWorld} from '../tools/snow-city/live-world.mjs';
import {SnowLaboratory} from '../tools/snow-city/snow-lab.mjs';
import {renderAudio} from '../tools/snow-city/live-audio.mjs';
import {openSnowArchive} from '../tools/snow-city/snow-archive.mjs';
import {residentMesh} from '../tools/snow-city/resident-mesh.mjs';

test('shovel arbitrary cuts, weight, thermal contact, transfer and undercuts share a mass ledger',()=>{
 const scene=new Scene({version:1,entities:[]}),lab=new SnowLaboratory(scene);
 for(let n=0;n<6;n++)lab.apply({x:-.4+n*.08,z:.3,shape:n%2?'blade':'round',depth:.35});
 const initial=lab.metrics();assert(initial.carriedKg>1);assert(Math.abs(initial.massErrorKg)<1e-7);
 for(let n=0;n<12;n++)lab.apply({x:.7,z:.6,tool:'dump'});assert(lab.metrics().carriedKg<initial.carriedKg);
 const load=lab.snow.sample(-1,-1).height;lab.apply({x:-1,z:-1,tool:'press'});assert(lab.snow.sample(-1,-1).height<load);
 for(let n=0;n<40;n++)lab.apply({x:-1,z:-1,tool:'heat',temperature:200,dt:.25});assert(lab.metrics(-1,-1).liquidFraction>0);
 assert(Math.abs(lab.metrics().massErrorKg)<1e-6);
 const roofLab=new SnowLaboratory(new Scene({version:1,entities:[]}));roofLab.tunnel();assert(roofLab.snow.cell(0,4,0).massKg>0);assert(roofLab.snow.cell(0,2,0).massKg<.02);assert(Math.abs(roofLab.metrics().massErrorKg)<1e-6);
});

test('residency exhaustion does not leave half a pressure or deposit transfer',()=>{
 const snow=new SnowMatter({cellM:.1,maxCells:1}),before=snow.snapshot();
 assert.throws(()=>snow.contact({position:[0,0,0],radiusM:.3,normalLoadN:4000,slipSpeedMps:0,durationSeconds:.1,heatJ:500}),/budget/);assert.deepEqual(snow.snapshot(),before);
 assert.throws(()=>snow.deposit([0,0,0],{massKg:20,volumeM3:.1,enthalpyJ:0,bond:.1}),/budget/);assert.deepEqual(snow.snapshot(),before);
});

test('a stalled engine is cranked by starter torque with an open clutch',()=>{
 const drive=new Drivetrain({engine:{idleRpm:1000,stallRpm:300,redlineRpm:7000,inertiaKgM2:.38,dragTorqueNm:8,torqueCurve:[{rpm:0,torqueNm:120},{rpm:7000,torqueNm:400}]},clutch:{maxTorqueNm:600,stiffnessNmPerRadS:12},gearbox:{forwardRatios:[4],reverseRatio:3,finalDrive:3.4},differential:{outputs:['w']}});
 const input={throttle:0,clutch:1,wheelOmega:()=>0,wheelInertia:()=>1};for(let n=0;n<120;n++)drive.step(1/120,input);assert(drive.state.stalled);
 for(let n=0;n<120;n++)drive.step(1/120,{...input,clutch:0,starter:1,throttle:.2});assert(drive.state.engineRpm>800);assert.equal(drive.torqueFor('w'),0);
});

test('authority snapshots restore shuffled ranges without client simulation, and audio joins exactly',async()=>{
 const authority=await createAuthority(),frames=[],base=authority.checkpoint();
 for(let n=0;n<=720;n++){frames.push(authority.frame());authority.step();}
 const client=new LiveSnowWorld(new Scene(spec)),steps=client.scene.physics.steps;
 for(const tick of [600,120,360,0]){client.snow.restore(base.snow);for(let n=0;n<=tick;n++)client.snow.apply(frames[n].snowEdits);client.restore(structuredClone(frames[tick]));assert.deepEqual(client.cars.map(c=>c.rig.body.position),frames[tick].cars.map(c=>c.body.slice(0,3)));assert.equal(client.scene.physics.steps,steps);}
 const a=renderAudio({startTime:1,duration:.37,frames}),b=renderAudio({startTime:1.37,duration:.63,frames}),whole=renderAudio({startTime:1,duration:1,frames});assert.deepEqual([...a,...b],[...whole]);
 assert(whole.some(v=>Math.abs(v)>.02));assert(authority.world.cars.some(c=>c.distanceM>80));assert(frames.at(-1).people.actors.some(a=>a.mode!=='walk'));assert(authority.world.snow.cells.size>100);
 assert(residentMesh(0,2).length<32);assert(residentMesh(0,3).reduce((s,p)=>s+p.mesh.indices.length,0)<residentMesh(0,1).reduce((s,p)=>s+p.mesh.indices.length,0)/4);
 client.dispose();authority.dispose();
});

test('archived terrain is restored before becoming resident and its edits reach clients',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'snow-archive-'));try{
  const archive=await openSnowArchive(directory),snow=new SnowMatter({cellM:.2}),p=[0,1,0],world={snow,cars:[{rig:{body:{position:p}}}],service:{rig:{body:{position:p}}},people:{actors:new Map()}};
  snow.contact({position:[0,0,0],radiusM:.2,normalLoadN:4000,slipSpeedMps:0,durationSeconds:.1});const height=snow.sample(0,0).height;snow.drainEdits();p[0]=500;archive.update(world);assert.equal(snow.cells.size,0);p[0]=0;archive.update(world);assert.equal(snow.sample(0,0).height,height);assert(snow.drainEdits().length>0);
 }finally{await rm(directory,{recursive:true,force:true});}
});

test('separated cars keep their streets populated and collision geometry resident',()=>{
 const world=new LiveSnowWorld(new Scene(spec),{authority:true});world.cars[1].rig.body.position[0]=960;world.cars[2].rig.body.position[2]=-960;world.plan(1/60);
 assert([...world.people.actors.values()].some(a=>Math.abs(a.p[0]-960)<96));assert([...world.people.actors.values()].some(a=>Math.abs(a.p[2]+960)<96));assert(world.colliders.has('solid:10:0:-1:-1'));assert(world.colliders.has('solid:0:-10:-1:-1'));world.dispose();
});

test('undisturbed snow shares immutable geometry without losing world anchoring',()=>{
 const world=new LiveSnowWorld(new Scene(spec));world.scene.camera.target=[0,0,0];world.snowView.update();const a=world.scene.entities.get('snow-volume:0,0'),b=world.scene.entities.get('snow-volume:1,0');assert.equal(a.mesh,b.mesh);assert.deepEqual(a.position,[0,0,0]);assert.deepEqual(b.position,[6,0,0]);world.dispose();
});


test('an archived tile restores only resident cells, including a revisit of its outer edge',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'snow-archive-edge-'));try{const archive=await openSnowArchive(directory),snow=new SnowMatter({cellM:.2}),p=[31,1,0],world={snow,cars:[{rig:{body:{position:p}}}],service:{rig:{body:{position:p}}},people:{actors:new Map()}};
 snow.contact({position:[31,0,0],radiusM:.2,normalLoadN:4000,slipSpeedMps:0,durationSeconds:.1});const before=snow.sample(31,0).height;p[0]=500;archive.update(world);assert.equal(snow.cells.size,0);p[0]=0;archive.update(world);assert.equal(snow.cells.size,0,'near tile centre must not resurrect its distant cells');p[0]=31;archive.update(world);assert.equal(snow.sample(31,0).height,before);
 }finally{await rm(directory,{recursive:true,force:true});}
});

test('sequential presentation receives deltas and preserves unseen snow ticks across quality boundaries',async()=>{
 const authority=await createAuthority(),template=authority.frame(),snow=authority.world.snow,chunks=new Map(),expected=new Map();
 for(let start=0;start<360;start+=120){const base={snow:snow.snapshot()},frames=[];for(let tick=start;tick<start+120;tick++){if(tick===115)snow.detachWhere(()=>true);if(tick===0||tick===118||tick===127||tick===241)snow.contact({position:[tick/80,0,0],radiusM:.2,normalLoadN:4000,slipSpeedMps:0,durationSeconds:.1});frames.push({...structuredClone(template),tick,snowEdits:snow.drainEdits(),snowRemoved:snow.drainRemoved()});expected.set(tick,JSON.parse(JSON.stringify(snow.snapshot().cells)));}chunks.set(start,{startTick:start,base,frames});}
 const runtime={scene:new Scene(spec),tickRate:60},requests=[],original=globalThis.fetch;await initializeRuntime(runtime);
 globalThis.fetch=async input=>{const url=new URL(input,'http://test'),start=Number(url.searchParams.get('tick')),chunk=structuredClone(chunks.get(start));requests.push([start,url.searchParams.get('checkpoint')]);if(url.searchParams.get('checkpoint')==='0')delete chunk.base;return Response.json(chunk);};
 try{for(const tick of [0,112,120,128,245,120,0]){await seekRuntime(runtime,tick,{streamId:'test',sceneHash:'test'});assert.deepEqual([...runtime.snowCity.snow.cells].sort(),expected.get(tick).map(([k,m,v,h,b])=>[k,{massKg:m,volumeM3:v,enthalpyJ:h,bond:b}]).sort());}assert.deepEqual(requests,[[0,null],[120,'0'],[240,'0'],[120,null]]);const restarted=structuredClone(chunks.get(0));restarted.base.snow.cells=[];for(const frame of restarted.frames){frame.snowEdits=[];frame.snowRemoved=[];}chunks.set(0,restarted);await seekRuntime(runtime,0,{streamId:'test',sceneHash:'test',epoch:2});assert.equal(runtime.snowCity.snow.cells.size,0,'a server restart must not reuse material from a previous epoch');assert.deepEqual(requests.at(-1),[0,null]);}finally{globalThis.fetch=original;runtime.snowCity.dispose();authority.dispose();}
});

test('distant snow edits do not rebuild unrelated far geometry',()=>{
 const world=new LiveSnowWorld(new Scene(spec));world.scene.camera.target=[0,0,0];world.snowView.update();const meshes=[0,1,2,3].map(i=>world.scene.entities.get('snow-volume:far'+i).mesh);
 world.snow.contact({position:[960,0,960],radiusM:.2,normalLoadN:4000,slipSpeedMps:0,durationSeconds:.1});world.snowView.update();assert.deepEqual([0,1,2,3].map(i=>world.scene.entities.get('snow-volume:far'+i).mesh),meshes);
 world.snow.contact({position:[60,0,0],radiusM:.2,normalLoadN:4000,slipSpeedMps:0,durationSeconds:.1});world.snowView.update();assert.notEqual(world.scene.entities.get('snow-volume:far3').mesh,meshes[3]);assert.equal(world.scene.entities.get('snow-volume:far0').mesh,meshes[0]);world.dispose();
});


test('backward presentation seek clears damage absent from the authoritative frame',async()=>{
 const authority=await createAuthority(),pristine=authority.frame(),car=authority.world.cars[0];car.soft.structure.position[0]+=.2;car.softRevision=1;car.softUntil=1;
 const damaged=authority.frame(),client=new LiveSnowWorld(new Scene(spec));client.restore(damaged);client.cars[0].publish();assert.equal(client.cars[0].softRevision,1);assert.notEqual(client.cars[0].soft.structure.position[0],client.cars[0].soft.nodeRest[0]);
 const body=client.scene.entities.get(client.cars[0].id+':visual:body').mesh;
 assert(body.indices.length>=1126*3*16,'damage must retain a smooth render shell');
 assert(body.normals.every(Number.isFinite));assert.equal(body.normals.length,body.positions.length);
 client.restore(pristine);client.cars[0].publish();assert.equal(client.cars[0].softRevision,0);assert.deepEqual([...client.cars[0].soft.structure.position],[...client.cars[0].soft.nodeRest]);client.dispose();authority.dispose();
});

test('snow presentation interpolates physical cells continuously without editing their mass',()=>{
 const world=new LiveSnowWorld(new Scene(spec)),s=world.snow;
 s.cut({min:[0,0,0],max:[.199999,.7,.199999],distance:()=>-1});const before=s.snapshot();
 const left=world.snowView.sample(.199999,.1),right=world.snowView.sample(.200001,.1);
 assert(Math.abs(left.height-right.height)<.00001);assert(left.height>0&&left.height<.48);
 assert.deepEqual(s.snapshot(),before);
 world.scene.camera.target=[0,0,0];world.snowView.update();const far=world.scene.entities.get('snow-volume:far3').mesh;
 s.contact({position:[59.9,0,.1],radiusM:.025,normalLoadN:4000,slipSpeedMps:0,durationSeconds:.1});world.snowView.update();
 assert.notEqual(world.scene.entities.get('snow-volume:far3').mesh,far,'the far vertex depends on the neighbouring physical column too');world.dispose();
});

test('the city skyline stays resident at bounded detail while the camera crosses districts',async()=>{
 const world=new LiveSnowWorld(new Scene(spec));
 try{for(const position of [[0,15,0],[96,15,0],[9600,15,-9600]]){
  world.scene.camera.position=position;world.scene.camera.target=[position[0],0,position[2]];await world.prepareFrame();
  assert.equal(world.world.inspect().resident,25);assert.equal(world.world.ready().filter(v=>v.demand.id.lod===0).length,9);
  assert.equal(world.world.ready().filter(v=>v.demand.id.lod===1).length,16);
  assert.equal(new Set(world.scene.entities.keys()).size,world.scene.entities.size);
 }}finally{world.dispose();}
});

test('fine snow joins the coarse edge without cracks, colour seams or split normals',()=>{
 const world=new LiveSnowWorld(new Scene(spec));
 try{
  world.snow.cut({min:[5.7,0,2.1],max:[6.3,.7,3.3],distance:p=>Math.hypot(p[0]-6,p[2]-2.65)-.3});
  const fine=world.snowView.mesh(0,0,6,6,30,30,false,[false,true,false,false]),coarse=world.snowView.mesh(6,0,6,6,6,6);
  for(let row=0;row<=30;row++){
   const z=row*.2,lo=Math.floor(z),hi=Math.ceil(z),t=z-lo,fi=row*31+30,ci=lo*7,cj=hi*7;
   assert(Math.abs(fine.positions[fi*3+1]-(coarse.positions[ci*3+1]*(1-t)+coarse.positions[cj*3+1]*t))<1e-8);
   const n=[0,1,2].map(k=>coarse.normals[ci*3+k]*(1-t)+coarse.normals[cj*3+k]*t),length=Math.hypot(...n);
   for(let k=0;k<3;k++){assert(Math.abs(fine.normals[fi*3+k]-n[k]/length)<1e-8);assert(Math.abs(fine.colors[fi*4+k]-(coarse.colors[ci*4+k]*(1-t)+coarse.colors[cj*4+k]*t))<1e-8);}
  }
 }finally{world.dispose();}
});

test('service payload presentation preserves collected volume and follows heat and emptying',()=>{
 const world=new LiveSnowWorld(new Scene(spec)),service=world.service;
 try{
  service.load={massKg:500,volumeM3:3.2,enthalpyJ:-500*2100*5,bond:.2};service.publish();const entity=world.scene.entities.get('roads:plow:snow-load'),mesh=entity.mesh;let volume=0;
  for(let i=0;i<mesh.indices.length;i+=3){const [a,b,c]=mesh.indices.slice(i,i+3).map(n=>mesh.positions.slice(n*3,n*3+3));volume+=Math.abs((b[0]-a[0])*(c[2]-a[2])-(b[2]-a[2])*(c[0]-a[0]))*.5*(a[1]+b[1]+c[1])/3;}
  assert(Math.abs(volume-3.2)<1e-9);const color=entity.material.color[0];service.load.enthalpyJ=500*334000*.5;service.publish();assert.equal(entity.mesh,mesh);assert(entity.material.color[0]<color);
  service.load={massKg:0,volumeM3:0,enthalpyJ:0,bond:0};service.publish();assert.equal(world.scene.entities.has('roads:plow:snow-load'),false);assert.equal(service.parts.some(p=>p.id==='roads:plow:snow-load'),false);
 }finally{world.dispose();}
});
