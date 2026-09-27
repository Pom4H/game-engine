import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {performance} from 'node:perf_hooks';
import {VehicleCompiler,compileVehicle,vehiclePart} from '../dist/vehicles/index.js';
import {M3_VEHICLE_DEFINITION} from '../dist/vehicles/m3.js';
import {PICKUP_CANOPY_VEHICLE_DEFINITION,generateDoubleCabPickupBody,generateDoubleCabPickupGlass} from '../dist/vehicles/pickup.js';
import {generateDetailedThreeBoxBody,generateDetailedThreeBoxGlass} from '../dist/vehicles/m3-detailed-procedural.js';
import {detailedRoadWheelMeshes} from '../dist/vehicles/passenger-wheel.js';
import {passengerPartMaterial} from '../dist/vehicles/passenger.js';

/** Pre-framework assembly oracle. Unchanged shape generators, four wheel builds,
 * no sharing/caching. Deliberately test-only: do not use this in scene authoring. */
export function legacyVehicle(definition) {
  const sedan = definition.family==='three-box';
  const d = sedan ? definition.body.dimensions : definition.dimensions;
  const body = sedan ? generateDetailedThreeBoxBody(definition.body) : generateDoubleCabPickupBody(definition);
  const glass = sedan ? generateDetailedThreeBoxGlass(definition.body) : generateDoubleCabPickupGlass(definition);
  const parts = [
    {id:'body',role:'paint',mesh:body,position:[0,0,0],material:passengerPartMaterial('paint')},
    {id:'glass',role:'glass',mesh:glass,position:[0,0,0],material:passengerPartMaterial('glass')},
  ];
  for (const [axle,x] of [['front',d.wheelbase/2+d.axleOffset],['rear',-d.wheelbase/2+d.axleOffset]]) {
    for (const [side,z,sign] of [['left',-d.track/2,-1],['right',d.track/2,1]]) {
      const wheel = detailedRoadWheelMeshes({radius:d.wheelRadius,...definition.wheel},sign);
      for (const role of ['tire','rim']) parts.push({id:`${role}-${axle}-${side}`,role,mesh:wheel[role],position:[x,d.wheelRadius,z],wheel:true,material:passengerPartMaterial(role)});
    }
  }
  return {definition,parts,body,bodyTriangles:body.indices.length/3,generatedTriangles:parts.reduce((n,p)=>n+p.mesh.indices.length/3,0)};
}

// IEEE-754 bytes, including signed zero, not a lossy screenshot or rounded metric.
export function geometryHash(vehicle) {
  const hash = createHash('sha256');
  for (const part of vehicle.parts) {
    hash.update(JSON.stringify([part.id,part.role,part.material]));
    for (const values of [part.position,part.mesh.positions,part.mesh.normals,part.mesh.indices]) {
      const bytes = Buffer.allocUnsafe(values.length*8);
      values.forEach((value,index)=>bytes.writeDoubleLE(value,index*8));
      hash.update(bytes);
    }
  }
  return hash.digest('hex');
}

const uniqueMeshes = vehicle => [...new Set(vehicle.parts.map(part=>part.mesh))];
const sourceScalars = meshes => meshes.reduce((n,m)=>n+m.positions.length+m.normals.length+m.indices.length,0);
const median = values => [...values].sort((a,b)=>a-b)[Math.floor(values.length/2)];
function measure(run,count=7) {
  const samples=[];
  for (let i=0;i<count;i++) {
    global.gc?.();
    const start=performance.now();
    const result=run(i);
    samples.push(performance.now()-start);
    assert.ok(result.generatedTriangles>0);
  }
  return {medianMs:median(samples),samplesMs:samples};
}

// Traverse emitted ESM, where TypeScript-only imports have already disappeared.
export async function importFootprint(entry) {
  const files = new Map();
  const visit = async file => {
    file=resolve(file);
    if (files.has(file)) return;
    const source=await readFile(file,'utf8');
    files.set(file,Buffer.byteLength(source));
    for (const match of source.matchAll(/(?:^|\n)\s*(?:import|export)\s+(?:[^;]*?\sfrom\s*)?['"](\.[^'"]+)['"]/g)) {
      await visit(resolve(dirname(file),match[1]));
    }
  };
  await visit(entry);
  return {modules:files.size,sourceBytes:[...files.values()].reduce((a,b)=>a+b,0),files:[...files.keys()]};
}

async function main() {
  const rows=[];
  for (const definition of [M3_VEHICLE_DEFINITION,PICKUP_CANOPY_VEHICLE_DEFINITION]) {
    const legacy=legacyVehicle(definition),compiler=new VehicleCompiler(),current=compiler.compile(definition);
    assert.equal(geometryHash(current),geometryHash(legacy),'Geometry drift');
    assert.deepEqual(current,legacy);
    const coldDiagnostics=compiler.diagnostics;
    const variant={...definition,wheel:{...definition.wheel,spokes:definition.wheel.spokes+1}};
    const edited=compiler.compile(variant);
    assert.equal(edited.body,current.body);
    assert.equal(vehiclePart(edited,'glass').mesh,vehiclePart(current,'glass').mesh);
    assert.equal(geometryHash(edited),geometryHash(legacyVehicle(variant)));
    assert.equal(compiler.diagnostics.bodyBuilds,1);
    const legacyCold=measure(()=>legacyVehicle(definition));
    const frameworkCold=measure(()=>compileVehicle(definition));
    const oldEdits=measure(i=>legacyVehicle({...definition,wheel:{...definition.wheel,spokes:definition.wheel.spokes+1+(i%2)}}));
    const editCompiler=new VehicleCompiler(); editCompiler.compile(definition);
    const edits=measure(i=>editCompiler.compile({...definition,wheel:{...definition.wheel,spokes:definition.wheel.spokes+1+(i%2)}}));
    // Prime the stable variant before timing unchanged authoring data.
    editCompiler.compile({...definition,wheel:{...definition.wheel,spokes:definition.wheel.spokes+1}});
    const stable=measure(()=>editCompiler.compile({...definition,wheel:{...definition.wheel,spokes:definition.wheel.spokes+1}}));
    rows.push({id:definition.id,geometryHash:geometryHash(current),geometryIdentical:true,
      parts:current.parts.length,triangles:current.generatedTriangles,
      coldBuilds:{legacy:{body:1,glass:1,wheels:4},framework:coldDiagnostics},
      wheelEditBuilds:{body:compiler.diagnostics.bodyBuilds-coldDiagnostics.bodyBuilds,glass:compiler.diagnostics.glassBuilds-coldDiagnostics.glassBuilds,wheels:compiler.diagnostics.wheelBuilds-coldDiagnostics.wheelBuilds},
      uniqueAuthoringMeshes:{legacy:uniqueMeshes(legacy).length,framework:uniqueMeshes(current).length},
      uniqueAuthoringScalars:{legacy:sourceScalars(uniqueMeshes(legacy)),framework:sourceScalars(uniqueMeshes(current))},
      timings:{legacyCold,frameworkCold,legacyWheelEdit:oldEdits,frameworkWheelEdit:edits,unchanged:stable},
      wheelEditSpeedup:oldEdits.medianMs/edits.medianMs});
  }
  const root=await importFootprint('dist/index.js'),domain=await importFootprint('dist/vehicles/index.js'),wheel=await importFootprint('dist/vehicles/wheels.js');
  const compact=({modules,sourceBytes})=>({modules,sourceBytes});
  const report={schema:1,node:process.version,platform:process.platform,arch:process.arch,
    commit:process.env.GITHUB_SHA??null,samples:7,
    notes:['CPU authoring compilation only; no FPS/GPU-speed claim.','Legacy oracle reproduces pre-framework assembly using unchanged generators.','Unique source arrays before Scene ownership/copying, not measured heap or GPU residency.','Import footprint is unbundled emitted ESM, not gzip or a production bundle.'],
    imports:{root:compact(root),vehicles:compact(domain),wheels:compact(wheel)},vehicles:rows};
  const md=['# Vehicle domain harness','',`Node ${report.node}; ${report.platform}/${report.arch}; median of ${report.samples} samples.`,
    '', '| Model | Exact geometry | Wheel builds cold | Body rebuilds on wheel edit | Wheel-edit median, old → new | Speedup |',
    '|---|---|---:|---:|---|---:|',
    ...rows.map(r=>`| ${r.id} | SHA-256 identical | 4 → ${r.coldBuilds.framework.wheelBuilds} | 1 → ${r.wheelEditBuilds.body} | ${r.timings.legacyWheelEdit.medianMs.toFixed(3)} → ${r.timings.frameworkWheelEdit.medianMs.toFixed(3)} ms | ${r.wheelEditSpeedup.toFixed(2)}× |`),
    '',`ESM footprint: root ${root.modules} modules / ${root.sourceBytes} bytes; vehicles ${domain.modules} / ${domain.sourceBytes}; wheels ${wheel.modules} / ${wheel.sourceBytes}.`,
    '',...report.notes.map(note=>`- ${note}`),''].join('\n');
  await mkdir('artifacts/vehicle-domain',{recursive:true});
  await writeFile('artifacts/vehicle-domain/report.json',JSON.stringify(report,null,2)+'\n');
  await writeFile('artifacts/vehicle-domain/report.md',md);
  if(process.env.GITHUB_STEP_SUMMARY) await writeFile(process.env.GITHUB_STEP_SUMMARY,md,{flag:'a'});
  console.log(md);
  console.log('VEHICLE_DOMAIN_REPORT '+JSON.stringify(report));
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) await main();
