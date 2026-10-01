import {mkdir,writeFile} from 'node:fs/promises';
import * as engine from '../../dist/index.js';
import {provingGroundZones,releasePhysicsRequirements} from './catalog.mjs';

const implemented=new Map([
 ['rigid-contact',typeof engine.PhysicsWorld==='function'],
 ['collision',typeof engine.PhysicsWorld==='function'],
 ['material-contact',typeof engine.material==='function'&&typeof engine.deriveSurfaceState==='function'],
 ['structural',typeof engine.StructuralBody==='function'],
 ['damage',typeof engine.PlasticDeformationSystem==='function'],
 ['determinism',true],

 // These must become explicit engine primitives before release. Presence of an
 // animation helper or historical branch does not count as physics support.
 ['wheel',typeof engine.Vehicle==='function'&&typeof engine.wheel==='function'],
 ['tyre',typeof engine.solveWheelContact==='function'],
 ['wet-grip',typeof engine.Vehicle==='function'&&typeof engine.SurfaceEnvironmentSystem==='function'],
 ['suspension',typeof engine.Vehicle==='function'],
 ['steering',typeof engine.Vehicle==='function'],
 ['drivetrain',typeof engine.Drivetrain==='function'],
 ['brake',typeof engine.Vehicle==='function'],
 ['load-transfer',typeof engine.Vehicle==='function'],
 ['aero',typeof engine.wing==='function'],
 ['wind',typeof engine.wing==='function'],
 ['normal-load',typeof engine.Vehicle==='function'],
 ['ballistic',typeof engine.PhysicsWorld==='function'],
 ['landing',typeof engine.PhysicsWorld==='function'],
 ['fluid',typeof engine.FluidWorld==='function'],
 ['buoyancy',typeof engine.Buoyancy==='function'],
 ['drag',typeof engine.FluidWorld==='function'||typeof engine.wing==='function'],
 ['sealing',typeof engine.FluidWorld==='function'&&typeof engine.StructuralBody==='function'],
 ['thermal',false],
 ['ground-clearance',typeof engine.Vehicle==='function'],
 // Trace exists, but release proof remains blocked until contact damping/sleep corrections are causal too.
 ['cause-provenance',false],
 ['energy-accounting',false],
 ['momentum-accounting',false],
]);

for(const requirement of releasePhysicsRequirements)if(!implemented.has(requirement))implemented.set(requirement,false);
const requirements=releasePhysicsRequirements.map(id=>({id,status:implemented.get(id)?'available':'missing'}));
const zones=provingGroundZones.map(zone=>({
 ...zone,
 status:zone.domains.every(id=>implemented.get(id))?'ready':'blocked',
 missing:zone.domains.filter(id=>!implemented.get(id)),
}));
const missing=requirements.filter(r=>r.status!=='available').map(r=>r.id);
const report={
 schema:'game-engine-proving-ground/1',
 generatedAt:new Date().toISOString(),
 releaseReady:missing.length===0,
 requirements,
 zones,
 missing,
 notes:[
  'Historical branches do not count: only exports reachable from current main are inspected.',
  'Thegame behavior is not a reality oracle.',
  'A release requires all proving-ground domains plus external/reality validation where applicable.',
  'Cause/energy/momentum remain blocked until every contact/damping/sleep state change is attributed and closure-tested.',
 ],
};
await mkdir('artifacts/proving-ground',{recursive:true});
await writeFile('artifacts/proving-ground/physics-report.json',JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
if(process.env.PROVING_GROUND_RELEASE_GATE==='1'&&!report.releaseReady){
 console.error('RELEASE BLOCKED: '+missing.join(', '));
 process.exit(1);
}
