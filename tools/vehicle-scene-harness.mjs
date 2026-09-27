import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {mkdir,writeFile,appendFile} from 'node:fs/promises';
import os from 'node:os';
import {sceneFixture} from './vehicle-scene-fixture.mjs';
const out='artifacts/vehicle-scene';await mkdir(out,{recursive:true});
const dt=1/120,steps=480;
const sample=f=>({position:[...f.car.body.position],rotation:[...f.car.body.rotation],velocity:[...f.car.body.velocity],omega:[...f.car.body.angularVelocity],force:[...f.car.force],torque:[...f.car.torque],parts:f.blueprint.parts.map(p=>{const s=structuredClone(f.car.part(p.source.id));delete s.derivedBuilds;return s;})});
const hash=o=>{const h=createHash('sha256'),b=Buffer.alloc(8);const visit=v=>{if(typeof v==='number'){assert.ok(Number.isFinite(v));b.writeDoubleLE(v);h.update('n').update(b);}else if(v&&typeof v==='object'){h.update(Array.isArray(v)?'[':'{');for(const k of Object.keys(v)){h.update(k+'\0');visit(v[k]);}h.update(']');}else h.update(JSON.stringify(v));};visit(o);return h.digest('hex');};
function prepare(reuseDerived=true){const f=sceneFixture({crash:true,reuseDerived});for(let i=0;i<30;i++)f.scene.step(dt);f.scene.remove('striker');f.car.setAir({densityKgM3:1.225,wind:[-40,0,0]});f.car.setControls({flap:1});return f;}
function trial(reuse){const f=prepare(reuse);const start=performance.now();for(let i=0;i<steps;i++)f.scene.step(dt);const ms=performance.now()-start;
 const result={ms,hash:hash(sample(f)),skinHash:hash(f.scene.entities.get('test-car/body').mesh),wingHash:hash(f.scene.entities.get('test-car/wing.left').mesh),work:{...f.car.diagnostics,worldSubsteps:f.scene.physics.substeps},deformationBuilds:f.car.deformationBuilds,deformationSamples:f.car.deformationSamples,wingMeshBuilds:f.handle.diagnostics.wingMeshBuilds};f.handle.dispose();return result;}
for(let i=0;i<4;i++){trial(false);trial(true);}
const cached=[],reference=[];for(let i=0;i<11;i++)for(const reuse of i%2?[true,false]:[false,true])(reuse?cached:reference).push(trial(reuse));
for(let i=0;i<11;i++){assert.equal(cached[i].hash,reference[i].hash);assert.equal(cached[i].skinHash,reference[i].skinHash);assert.equal(cached[i].wingHash,reference[i].wingHash);assert.deepEqual(cached[i].work,reference[i].work);}
const median=a=>[...a].sort((a,b)=>a-b)[Math.floor(a.length/2)];
const recordScene=async(name,f)=>{
 const pos=f.car.body.position;
 const entities=[...f.scene.entities.values()].filter(e=>e.mesh).map(e=>{
  const {profile,surface,...material}=e.material;
  return {id:e.id,position:[...e.position],rotation:[...e.rotation],scale:[...e.scale],mesh:e.mesh,material,collision:'none'};
 });
 entities.push({id:'runway',mesh:{kind:'box',size:[100,.08,45]},position:[pos[0],-.04,pos[2]],material:{kind:'asphalt',color:[.12,.14,.16,1],roughness:.88},collision:'none'});
 for(let i=-3;i<=3;i++)entities.push({id:`mark-${i}`,mesh:{kind:'box',size:[3,.002,.12]},position:[pos[0]+i*7,.002,pos[2]-6],material:{kind:'plastic',color:[.9,.86,.7,1]},collision:'none'});
 const scene={version:1,entities,environment:{temperatureC:20,sunlight:1,humidity:0,groundMoisture:0,precipitation:'arid',snowfall:'none'},
  camera:{position:[pos[0]+8,4.1,pos[2]-10],target:[pos[0],.8,pos[2]],fov:45},
  rendering:{sunDirection:[.4,.8,-.3],sunIntensity:2.5,sunColor:[1,.97,.92],skyColor:[.35,.45,.60],exposure:1,shadowExtent:25,fogDensity:0}};
 await writeFile(`${out}/${name}.scene.json`,JSON.stringify(scene));return {time:f.scene.time,physical:sample(f),bodyCount:f.scene.physics.bodies.size};
};
const f=sceneFixture({damage:false});const parked=await recordScene('parked',f);f.car.setControls({throttle:1});
for(let i=0;i<1800;i++)f.scene.step(dt);f.car.setControls({flap:1});let airborneAt=null;const trace=[];
for(let i=0;i<360;i++){f.scene.step(dt);const support=['front.left','front.right','rear.left','rear.right'].reduce((n,id)=>n+f.car.part(id).loadN,0);
 if(support===0&&airborneAt===null)airborneAt=f.scene.time;if(i%12===0)trace.push({time:f.scene.time,height:f.car.body.position[1],supportN:support});if(i===179)await recordScene('airborne',f);}
assert.ok(airborneAt>15&&airborneAt<17);const airborne={airborneAt,trace};f.handle.dispose();
const crash=sceneFixture({crash:true});for(let i=0;i<30;i++)crash.scene.step(dt);crash.scene.remove('striker');
const deformation=crash.scene.deformation.inspect(),damaged=await recordScene('damaged',crash);
crash.car.setAir({densityKgM3:1.225,wind:[-60,0,0]});crash.car.setControls({flap:1});crash.car.evaluate(dt);const bent=sample(crash);
crash.car.bindDeformation();crash.car.evaluate(dt);const unbound=sample(crash);crash.handle.dispose();
const c=median(cached.map(s=>s.ms)),r=median(reference.map(s=>s.ms));
const report={schema:1,commit:process.env.GITHUB_SHA??'local-working-tree',node:process.version,cpu:os.cpus()[0]?.model,platform:process.platform,parked,airborne,damaged,deformation,causalProbe:{bent,unbound},
 benchmark:{steps,warmups:4,samples:11,cachedMedianMs:c,referenceMedianMs:r,speedup:r/c,cached,reference},
 notes:['Reduced plastic contact field reused from the existing Scene; not thegame coupled node/beam integration or BeamNG equivalence.',
 'Mounted wing geometry follows a rigidized material patch; part mass/inertia remain the existing lumped approximation, no separated debris or joint dynamics.',
 'Captured scenes are exact runtime transforms/meshes for the real engine renderer, not generated images.',
 'Same-process alternating paired trials; timing includes Scene physics and presentation, excludes construction and GPU rendering. Counters include 30 untimed crash-preparation steps.',
 'A causal probe re-evaluates forces at one fixed pose/velocity/air/control with/without the field; it is not a second driven trajectory.',
 'Tyre wear remains work-driven and its radius is projected by scaling only the rubber mesh; rim geometry does not shrink. Not a full carcass/thermal model.']};
await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));
const a=bent.parts.find(p=>p.id==='wing.left'),b=unbound.parts.find(p=>p.id==='wing.left');
const md=`# Vehicle Scene evidence\n\n${report.node}, ${report.cpu}, ${report.platform}.\n\n`+
`Scene takeoff: ${airborneAt.toFixed(6)} s.\n\nReal collider damage: ${deformation.plasticWorkJ.toFixed(2)} J.\nAt the same pose/air/control, left-wing lift with bent mount: ${a.liftN.toFixed(2)} N; field disconnected: ${b.liftN.toFixed(2)} N. Wear=${a.wear}, failed=${a.failed}.\n\n`+
`| ${steps} Scene steps | Reference | Cached |\n|---|---:|---:|\n| Median ms | ${r.toFixed(3)} | ${c.toFixed(3)} |\n| Field samples (including preparation) | ${reference[0].deformationSamples} | ${cached[0].deformationSamples} |\n| Wing mesh builds | ${reference[0].wingMeshBuilds} | ${cached[0].wingMeshBuilds} |\n\nAll 11 physical state/skin/wing hashes and work counters match. Ratio: ${(r/c).toFixed(3)}x, not FPS.\n\n`+report.notes.map(n=>'- '+n).join('\n')+'\n';
await writeFile(`${out}/report.md`,md);console.log(md);if(process.env.GITHUB_STEP_SUMMARY)await appendFile(process.env.GITHUB_STEP_SUMMARY,md);
