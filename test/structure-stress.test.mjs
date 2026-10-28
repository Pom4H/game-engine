import test from 'node:test';
import assert from 'node:assert/strict';
import {StructuralBody} from '../dist/physics/structure.js';

function member(){
 const body=new StructuralBody({nodes:[{position:[0,0,0],mass:1},{position:[1,0,0],mass:1}],constraints:[{kind:'distance',a:0,b:1,areaM2:1e-4,material:{youngModulusPa:1e7,yieldStressPa:1e5,failureStrain:1,plasticity:1,brittle:false}}],iterations:10,internalDamping:0,plasticityMode:'stress',sleepDelay:10});
 body.wake();return body;
}
test('stress return remains elastic below the physical yield force in both directions',()=>{
 for(const sign of [-1,1]){
  const b=member(),dt=1/240;
  for(let i=0;i<240;i++){b.addForce(0,[-sign*2,0,0]);b.addForce(1,[sign*2,0,0]);b.step(dt,[0,0,0]);}
  assert.equal(b.distanceRestScale(0),1);assert.equal(b.plasticWorkJ,0);assert.equal(b.stats.broken,0);
  assert.ok(Math.abs(b.lambda[0]/dt**2)<b.yieldForce[0]);
 }
});
test('stress return caps member force at yield and conserves momentum during plastic flow',()=>{
 for(const sign of [-1,1])for(const dt of [1/120,1/240]){
  const b=member();b.velocity[0]=-sign*2;b.velocity[3]=sign*2;const energy=b.kineticEnergy();
  for(let i=0;i<.1/dt;i++){b.step(dt,[0,0,0]);assert.ok(Math.abs(b.lambda[0]/dt**2)<=b.yieldForce[0]+1e-7);assert.ok(Math.abs(b.linearMomentum()[0])<1e-10);}
  assert.ok((b.distanceRestScale(0)-1)*sign>.1);assert.ok(b.plasticWorkJ>0);assert.ok(b.plasticWorkJ+b.kineticEnergy()<=energy+1e-8);
 }
});

test('constitutive sound source observes actual dissipated work without changing it',()=>{
 const b=member(),dt=1/240;b.velocity[0]=-2;b.velocity[3]=2;let work=0,sources=0;
 for(let i=0;i<24;i++){
  const before=b.plasticWorkJ;b.step(dt,[0,0,0]);const source=b.dissipation;
  assert.ok(Math.abs(source.workJ-(b.plasticWorkJ-before))<1e-10);
  work+=source.workJ;
  if(source.workJ>0){sources++;assert.ok(source.point.every(Number.isFinite));assert.ok(source.areaM2>0);assert.equal(source.seconds,dt);}
 }
 assert.ok(sources>0);assert.ok(Math.abs(work-b.plasticWorkJ)<1e-10);
 b.bake();b.step(dt,[0,0,0]);assert.equal(b.dissipation.workJ,0);
 const elastic=member();elastic.addForce(0,[-2,0,0]);elastic.addForce(1,[2,0,0]);elastic.step(dt,[0,0,0]);assert.equal(elastic.dissipation.workJ,0);
});

test('phased prediction/projection/finalisation is identical to the complete structural step',()=>{
 const a=member(),b=member(),dt=1/240;
 const contact=core=>{core.position[0]=Math.max(-.05,core.position[0]);};
 for(let i=0;i<120;i++){
  for(const core of [a,b]){core.addForce(0,[-30,0,0]);core.addForce(1,[30,0,0]);}
  a.step(dt,[0,0,0],contact);b.predictStep(dt,[0,0,0],contact);
  for(let iteration=0;iteration<10;iteration++)b.projectStep(contact,iteration);
  b.completeStep();
  assert.deepEqual(a.position,b.position);assert.deepEqual(a.velocity,b.velocity);
  assert.equal(a.plasticWorkJ,b.plasticWorkJ);assert.deepEqual(a.dissipation,b.dissipation);
 }
});

test('two contacting graphs share an energy budget and conserve their combined momentum',()=>{
 const a=member(),b=member(),dt=1/240;
 for(let i=0;i<2;i++){b.position[i*3]+=1.1;b.previous[i*3]+=1.1;a.velocity[i*3]=2;}
 const initial=a.kineticEnergy()+b.kineticEnergy();a.shareMechanicalEnergy(b);
 for(let step=0;step<240;step++){
  a.predictStep(dt,[0,0,0]);b.predictStep(dt,[0,0,0]);
  for(let iteration=0;iteration<10;iteration++){
   a.projectStep();b.projectStep();const gap=b.position[0]-a.position[3];
   if(gap<0){const lambda=-gap/(a.inverseMass[1]+b.inverseMass[0]);a.position[3]-=lambda*a.inverseMass[1];b.position[0]+=lambda*b.inverseMass[0];}
  }
  a.completeStep();b.completeStep();
  assert.ok(Math.abs(a.linearMomentum()[0]+b.linearMomentum()[0]-4)<1e-8);
  assert.ok(a.plasticWorkJ+b.plasticWorkJ+a.kineticEnergy()+b.kineticEnergy()<=initial+1e-7);
 }
 assert.ok(a.plasticWorkJ>0);assert.ok(b.plasticWorkJ>0);
 a.leaveMechanicalEnergyGroup();b.leaveMechanicalEnergyGroup();
});
