import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {createHash} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import os from 'node:os';
import {fixture} from './vehicle-runtime-fixture.mjs';

const dt=1/120;
const sample=f=>({position:[...f.car.body.position],velocity:[...f.car.body.velocity],rotation:[...f.car.body.rotation],angularVelocity:[...f.car.body.angularVelocity],force:[...f.car.force],torque:[...f.car.torque],parts:f.blueprint.parts.map(p=>{const v=structuredClone(f.car.part(p.source.id));delete v.derivedBuilds;return v;})});
const hash=value=>{
 const h=createHash('sha256'),buffer=Buffer.allocUnsafe(8);
 const visit=v=>{if(typeof v==='number'){assert.ok(Number.isFinite(v));buffer.writeDoubleLE(v);h.update('n').update(buffer);}else if(v&&typeof v==='object'){h.update(Array.isArray(v)?'[':'{');for(const key of Object.keys(v)){h.update(key+'\0');visit(v[key]);}h.update(']');}else h.update(JSON.stringify(v));};
 visit(value);return h.digest('hex');
};
function flight(wings){
 const f=fixture({wings,incidenceRad:0});f.car.setControls({throttle:1});const frames=[];
 let airborneAt=null,maxY=-Infinity;
 for(let i=0;i<2400;i++){
  if(i===1800)f.car.setControls({flap:1});
  f.world.step(dt);
  const support=['front.left','front.right','rear.left','rear.right'].reduce((sum,id)=>sum+f.car.part(id).loadN,0);
  if(i>1800&&support===0&&airborneAt===null)airborneAt=(i+1)*dt;
  maxY=Math.max(maxY,f.car.body.position[1]);
  if(i%12===0)frames.push({time:(i+1)*dt,x:f.car.body.position[0],height:f.car.body.position[1],vx:f.car.body.velocity[0],vy:f.car.body.velocity[1],supportN:support,liftN:wings?f.car.part('wing.left').liftN+f.car.part('wing.right').liftN:0});
 }
 const out={massKg:f.car.body.mass,airborneAt,maxCenterHeightM:maxY,frames,final:sample(f)};f.car.dispose();return out;
}
const road=flight(false),flying=flight(true);
assert.equal(road.airborneAt,null);assert.ok(flying.airborneAt>15);assert.ok(flying.maxCenterHeightM>1.3);

function benchmark(reuseDerived){
 const f=fixture({wearEnergyJ:1e6,incidenceRad:.08},{velocity:[35,0,0]},{reuseDerived});
 f.car.setControls({throttle:.35});
 const start=performance.now();
 for(let i=0;i<1200;i++)f.world.step(dt);
 const ms=performance.now()-start,result=sample(f);
 const work={...f.car.diagnostics,worldSubsteps:f.world.substeps};
 const derivations={bodyBases:f.car.basisBuilds,parts:f.blueprint.parts.map(p=>({id:p.source.id,builds:f.car.part(p.source.id).derivedBuilds}))};
 f.car.dispose();return{ms,hash:hash(result),work,derivations};
}
for(let i=0;i<4;i++){benchmark(false);benchmark(true);}
const cached=[],reference=[];
for(let i=0;i<11;i++)for(const enabled of i%2?[true,false]:[false,true]){const result=benchmark(enabled);(enabled?cached:reference).push(result);}
for(let i=0;i<11;i++){assert.equal(cached[i].hash,reference[i].hash);assert.deepEqual(cached[i].work,reference[i].work);}
const median=a=>[...a].sort((x,y)=>x-y)[Math.floor(a.length/2)];
const c=median(cached.map(x=>x.ms)),r=median(reference.map(x=>x.ms));
const wear=fixture({wings:false,wearEnergyJ:30000},{velocity:[30,0,0]});wear.car.setControls({throttle:1,brake:1});for(let i=0;i<240;i++)wear.world.step(dt);
const rear=structuredClone(wear.car.part('rear.left'));wear.car.dispose();
const report={schema:1,commit:process.env.GITHUB_SHA??'local-working-tree',node:process.version,platform:process.platform,arch:process.arch,cpu:os.cpus()[0]?.model,
 notes:[
 'This is a full-scale SI demonstration based on M3 envelope dimensions, not calibrated BMW/1:64 mechanics.',
 'Flight is temporary wheel-powered takeoff after pilot wing deflection; there is no airborne propulsor.',
 'Ground backend is the existing static world.ground plane; wing failure retains attached mass and drag, not detached debris.',
 'Wear is a calibrated dissipated-work model, fatigue a streaming reversal approximation; no claim of BeamNG superiority.',
 'Benchmarks include PhysicsWorld integration/contacts; reference disables derived reuse, not physical work or solver iterations.',
 'Same-process paired trials, four warmups per path, eleven samples; no FPS or allocation-free whole-world claim.',
 ],road,flying,wear:rear,
 benchmark:{stepsPerSample:1200,warmups:4,samples:11,referenceMedianMs:r,cachedMedianMs:c,speedup:r/c,cachedMeanStepUs:c/1200*1000,geometryRebuildsDuringPhysics:0,cached,reference}};
const out='artifacts/vehicle-runtime';await mkdir(out,{recursive:true});await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));
const md=`# Vehicle runtime evidence\n\n${process.version}, ${process.platform}/${process.arch}, ${report.cpu}.\n\n`+
`| Experiment | Result |\n|---|---|\n| Without wings | no takeoff; max COM height ${road.maxCenterHeightM.toFixed(3)} m |\n| With wings | takeoff ${flying.airborneAt.toFixed(3)} s; max COM height ${flying.maxCenterHeightM.toFixed(3)} m |\n| Rear tyre friction work | ${rear.dissipatedJ.toFixed(1)} J |\n| Rear tyre wear / tread | ${(rear.wear*100).toFixed(2)}% / ${(rear.treadDepthM*1000).toFixed(3)} mm |\n| Cached / recomputed, 1200 world ticks | ${c.toFixed(3)} / ${r.toFixed(3)} ms |\n| Ratio within this run | ${(r/c).toFixed(3)}x |\n| Same state hash and work counts | all 11 pairs |\n\n`+report.notes.map(n=>'- '+n).join('\n')+'\n';
await writeFile(`${out}/report.md`,md);console.log(md);
if(process.env.GITHUB_STEP_SUMMARY){const {appendFile}=await import('node:fs/promises');await appendFile(process.env.GITHUB_STEP_SUMMARY,md);}
