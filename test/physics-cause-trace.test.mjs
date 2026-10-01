import test from 'node:test';
import assert from 'node:assert/strict';
import {PhysicsWorld,RigidBody} from '../dist/physics/world.js';
import {PhysicsCauseTrace,physicsCause,PHYSICS_CAUSE_TRACE_SCHEMA,PHYSICS_CAUSE_TRACE_VERSION} from '../dist/physics/cause-trace.js';
import {fixture} from '../tools/vehicle-runtime-fixture.mjs';

const run=(world,seconds)=>{for(let i=0;i<Math.round(seconds*120);i++)world.step(1/120);};
const frameKey=record=>record.tick===undefined?'':record.tick+'.'+record.substep;
const activeByFrame=records=>{
 const out=new Map();
 for(const r of records){
  if(r.type!=='physics.contribution')continue;
  const key=frameKey(r),set=out.get(key)??new Set();set.add(r.component_id+'\0'+r.law_id);out.set(key,set);
 }
 return out;
};

test('proof mode rejects any force that has no declared cause contribution',()=>{
 const world=new PhysicsWorld([0,0,0],-100),body=world.add(new RigidBody({id:'body',mass:10,position:[0,10,0],shape:{kind:'box',half:[1,1,1]}}));
 const driver={maxStepSeconds:1/120,force:[12,0,0],torque:[0,0,0],evaluate(){}};
 world.drive(body,driver);const trace=world.traceCauses({runId:'hidden-force'});
 assert.throws(()=>world.step(1/120),/Unattributed physics wrench/);
 assert.equal(trace.snapshot().filter(r=>r.type==='physics.contribution'&&r.law_id==='gravity.v1').length,1);
});

test('custom force drivers use the same small cause API and close their wrench exactly',()=>{
 const world=new PhysicsWorld([0,0,0],-100),body=world.add(new RigidBody({id:'probe',mass:2,position:[0,10,0],shape:{kind:'sphere',radius:1}}));
 const cause=physicsCause('thruster','constant-thrust.v1','other',['force','torque']);
 const force=[4,0,0],torque=[0,0,0];
 const driver={
  maxStepSeconds:1/120,force,torque,
  declareCauses(manifest){manifest.component({componentId:'thruster',bodyId:'probe',kind:'other',parentComponentId:'probe'});manifest.law('probe',cause);},
  evaluate(_dt,writer){writer?.contribute(cause,{kind:'internal',id:'fixture.thruster'},{forceN:force,torqueNm:torque});},
 };
 world.drive(body,driver);const trace=world.traceCauses({runId:'declared-force'});world.step(1/120);
 assert.equal(body.velocity[0],4/2/120);
 assert.equal(trace.proof.maxForceResidualN,0);assert.equal(trace.proof.maxTorqueResidualNm,0);
 const records=trace.snapshot(),header=records[0];assert.equal(header.schema,PHYSICS_CAUSE_TRACE_SCHEMA);assert.equal(header.schema_version,PHYSICS_CAUSE_TRACE_VERSION);
 assert.ok(records.some(r=>r.type==='manifest.law'&&r.component_id==='thruster'&&r.law_id==='constant-thrust.v1'));
 assert.ok(records.some(r=>r.type==='physics.state-mutation'&&r.writer_id==='PhysicsWorld.integrate'));
 for(const line of trace.toJSONL().trim().split('\n'))assert.doesNotThrow(()=>JSON.parse(line));
});

test('component ids are body-scoped, so identical assemblies can share stable local ids',()=>{
 const trace=new PhysicsCauseTrace({runId:'two-bodies'});
 for(const bodyId of ['a','b']){
  trace.component({componentId:bodyId,bodyId,kind:'body'});
  trace.component({componentId:'wing.left',bodyId,kind:'wing',parentComponentId:bodyId});
  trace.law(bodyId,physicsCause('wing.left','finite-wing.v1','aerodynamics',['force','torque']));
 }
 assert.equal(trace.proof.components,4);assert.equal(trace.proof.laws,2);
});

test('winged-car liftoff removes contact causes without adding aircraft laws or state writers',()=>{
 const f=fixture({incidenceRad:0});f.car.setControls({throttle:1});run(f.world,15);
 assert.ok(f.car.body.velocity[0]>50);assert.ok(f.car.body.position[1]<1);
 const trace=f.world.traceCauses({runId:'winged-car-liftoff',maxRecords:50_000});
 f.car.setControls({flap:1});
 let airborne=false;
 for(let i=0;i<300;i++){
  f.world.step(1/120);
  airborne=['front.left','front.right','rear.left','rear.right'].every(id=>!f.car.part(id).contact);
  if(airborne&&i>20)break;
 }
 assert.equal(airborne,true);

 const records=trace.snapshot(),firstFrame=records.find(r=>r.type==='frame.begin');assert.ok(firstFrame);
 const lateManifest=records.filter(r=>(r.type==='manifest.component'||r.type==='manifest.law')&&r.seq>firstFrame.seq);assert.deepEqual(lateManifest,[]);
 const frames=activeByFrame(records),entries=[...frames.entries()];
 const before=entries.find(([,laws])=>[...laws].some(x=>x.endsWith('\0wheel-contact.v1'))&&[...laws].some(x=>x.endsWith('\0finite-wing.v1')));
 const after=[...entries].reverse().find(([,laws])=>![...laws].some(x=>x.endsWith('\0wheel-contact.v1'))&&[...laws].some(x=>x.endsWith('\0finite-wing.v1')));
 assert.ok(before,'expected a supported frame with wheel and wing causes');assert.ok(after,'expected an airborne frame with wing causes and no wheel contact');
 const additions=[...after[1]].filter(law=>!before[1].has(law));assert.deepEqual(additions,[],'liftoff may remove contact causes but must not activate a new physics law');

 const manifestComponents=new Set(records.filter(r=>r.type==='manifest.component'&&r.body_id==='vehicle').map(r=>r.component_id));
 for(const r of records.filter(r=>r.type==='physics.contribution'&&r.body_id==='vehicle'))assert.ok(manifestComponents.has(r.component_id),r.component_id);
 const writers=new Set(records.filter(r=>r.type==='physics.state-mutation'&&r.body_id==='vehicle').map(r=>r.writer_id));
 assert.deepEqual([...writers],['PhysicsWorld.integrate']);
 for(const r of records.filter(r=>r.type==='physics.wrench'&&r.body_id==='vehicle')){
  assert.equal(r.residual.force_N,0);assert.equal(r.residual.torque_Nm,0);
 }
 assert.equal(trace.proof.maxForceResidualN,0);assert.equal(trace.proof.maxTorqueResidualNm,0);
 f.car.dispose();
});
