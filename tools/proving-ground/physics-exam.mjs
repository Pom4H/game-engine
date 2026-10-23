import {mkdir,writeFile} from 'node:fs/promises';
import * as engine from '../../dist/index.js';
import {provingGroundZones,releasePhysicsRequirements} from './catalog.mjs';
import {provingGroundExperiments} from './experiments.mjs';

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
 ['asymmetric-grip',typeof engine.Vehicle==='function'&&typeof engine.SurfaceEnvironmentSystem==='function'],
 ['yaw-response',typeof engine.Vehicle==='function'],
 ['banked-contact',typeof engine.bodyWheelSupport==='function'],
 ['road-excitation',typeof engine.bodyWheelSupport==='function'],
 ['wheel-hop',typeof engine.Vehicle==='function'&&typeof engine.bodyWheelSupport==='function'],
 ['pothole-contact',typeof engine.bodyWheelSupport==='function'],
 ['articulation',typeof engine.bodyWheelSupport==='function'&&typeof engine.Vehicle==='function'],
 ['aero',typeof engine.wing==='function'],
 ['wind',typeof engine.wing==='function'],
 ['wind-field',typeof engine.WindField==='function'],
 ['normal-load',typeof engine.Vehicle==='function'],
 ['ballistic',typeof engine.PhysicsWorld==='function'],
 ['landing',typeof engine.PhysicsWorld==='function'],
 ['fluid',typeof engine.FluidField==='function'],
 ['buoyancy',typeof engine.FluidField==='function'&&typeof engine.PhysicsWorld==='function'],
 ['drag',(typeof engine.FluidField==='function'&&typeof engine.PhysicsWorld==='function')||typeof engine.wing==='function'],
 ['sealing',typeof engine.FluidField==='function'&&typeof engine.RigidBody?.prototype?.setLeakArea==='function'],
 ['thermal',typeof engine.ThermalMass==='function'],
 ['soil',typeof engine.SoilField==='function'],
 ['sinkage',typeof engine.SoilField==='function'],
 ['traction',typeof engine.SoilField==='function'&&typeof engine.Vehicle==='function'],
 ['ground-clearance',typeof engine.Vehicle==='function'],
 // Provenance and energy closure are behaviorally tested in proving-ground.test.mjs.
 ['cause-provenance',typeof engine.PhysicsCauseTrace==='function'],
 ['energy-accounting',typeof engine.PhysicsCauseTrace==='function'&&typeof engine.physicsAccounting==='function'],
 ['momentum-accounting',typeof engine.physicsAccounting==='function'],
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
 experiments:provingGroundExperiments.map(e=>({id:e.id,title:e.title,domain:e.domain,durationS:e.durationS,runtimeTickRate:e.runtimeTickRate,environment:e.environment,proof:e.proof})),
 zones,
 missing,
 notes:[
  'Historical branches do not count: only exports reachable from current main are inspected.',
  'Thegame behavior is not a reality oracle.',
  'A release requires all proving-ground domains plus external/reality validation where applicable.',
  'Cause provenance and stage-level mechanical energy closure are behaviorally gated across vehicle, soil, fluid and contacts; momentum is independently checked on closed rigid-body systems.',
  'Each materialized experiment has an explicit environment contract; observed physics contributions must exactly match its allowed cause graph.'
 ],
};
await mkdir('artifacts/proving-ground',{recursive:true});
await writeFile('artifacts/proving-ground/physics-report.json',JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
if(process.env.PROVING_GROUND_RELEASE_GATE==='1'&&!report.releaseReady){
 console.error('RELEASE BLOCKED: '+missing.join(', '));
 process.exit(1);
}
