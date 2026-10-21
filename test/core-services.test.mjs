import test from 'node:test';
import assert from 'node:assert/strict';
import {SpatialHash,ELASTIC_MATERIALS,plateMechanics,panelExcitation,contactPulse,ContactImpulseEnvelope,createStructuralState,structuralMaterial,stepStructuralGraph,applyStructuralImpulse,bindPointToStructure,deformBoundPoint} from '../dist/index.js';

test('large caller-owned spatial outputs do not exceed the JavaScript argument stack',()=>{
 const index=new SpatialHash(),count=140000;for(let id=0;id<count;id++)index.add({id,x:1,z:1},0);
 const output=[{id:-1,x:0,z:0}];assert.equal(index.near(1,1,0,output),output);assert.equal(output.length,count);assert.equal(output[0].id,0);assert.equal(output.at(-1).id,count-1);
 output.pop();assert.equal(index.near(1,1,0).length,count);assert.equal(index.diagnostics.cachedQueries,0);index.clear();assert.equal(index.diagnostics.cells,0);
});

test('plate/contact model preserves physical scaling, finite energy allocation and total pulse momentum',()=>{
 const plate={...ELASTIC_MATERIALS.steel,width:1,height:1,thickness:.001},a=plateMechanics(plate),b=plateMechanics({...plate,thickness:.002});
 assert.ok(Math.abs(a.mass-7.85)<1e-12);assert.equal(b.mass/a.mass,2);assert.equal(b.rigidity/a.rigidity,8);assert.equal(b.bend/a.bend,2);
 const contact={impulse:4,effectiveMass:2,speed:3,area:.002},excitation=panelExcitation(plate,ELASTIC_MATERIALS.wood,contact);
 assert.ok(excitation.contactSeconds>=.0004&&excitation.contactSeconds<=.03);assert.ok(excitation.vibrationEnergy>=0&&excitation.vibrationEnergy<=excitation.availableEnergy);assert.equal(excitation.availableEnergy,9);
 for(const rate of [16000,44100,48000,96000]){const pulse=contactPulse(excitation.impulse,excitation.contactSeconds,rate);assert.equal(pulse[0],0);assert.equal(pulse.at(-1),0);assert.ok(pulse.every(v=>Number.isFinite(v)&&v>=0));assert.ok(Math.abs(pulse.reduce((a,b)=>a+b,0)-excitation.impulse)<1e-12);}
 assert.throws(()=>plateMechanics({...plate,thickness:0}),RangeError);assert.throws(()=>contactPulse(1,.001,0),RangeError);
});

test('a contact envelope retains one complete manifold cause across later support-only frames',()=>{
 const envelope=new ContactImpulseEnvelope(),peak=envelope.peak;
 envelope.observe(2,.1,1,1,.002,[0,0,0]);envelope.observe(3,.2,2,1,.005,[1,0,0]);assert.equal(peak.impulse,5);assert.equal(peak.effectiveMass,6.25);assert.equal(peak.speed,2);assert.equal(peak.area,.005);assert.ok(Math.abs(peak.point[0]-.6)<1e-12);
 envelope.observe(100,.1,0,1.1,1,[100,0,0]);assert.equal(peak.impulse,5);assert.equal(peak.area,.005);assert.equal(peak.speed,2);
 envelope.reset();assert.equal(envelope.peak,peak);assert.equal(peak.impulse,0);assert.deepEqual(peak.point,[0,0,0]);
});

test('reduced structural graph yields, fractures, binds geometry, conserves impulse and returns to sleep',()=>{
 const material=structuralMaterial({stiffness:.72,damping:.08,yieldTension:.05,yieldCompression:.035,fractureTension:.34,fractureCompression:.42,plasticity:.55}),template={nodes:[{position:[0,0,0],mass:0},{position:[1,0,0],mass:10}],links:[{a:0,b:1,material}]},state=createStructuralState(template);
 state.positions[1][0]=.72;stepStructuralGraph(template,state,1/120);assert.ok(state.restLengths[0]<1&&state.restLengths[0]>.72);assert.equal(state.broken[0],0);
 const binding=bindPointToStructure(template,[1,0,0]);assert.deepEqual(deformBoundPoint(template,state,binding),state.positions[1]);
 state.positions[1][0]=state.restLengths[0];state.velocities[1]=[0,0,0];for(let i=0;i<80;i++)stepStructuralGraph(template,state,1/120,{sleepAfter:.2});assert.equal(state.sleeping,true);
 applyStructuralImpulse(template,state,[1,0,0],[120,0,0],.5);assert.equal(state.sleeping,false);assert.equal(state.velocities[1][0]*10,120);
 state.positions[1][0]=2;stepStructuralGraph(template,state,1/120,{iterations:1});assert.equal(state.broken[0],1);assert.ok(state.revision>0);assert.throws(()=>stepStructuralGraph(template,state,.1),RangeError);
});
