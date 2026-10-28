import test from 'node:test';
import assert from 'node:assert/strict';
import {StructuralBody} from '../dist/physics/structure.js';
import {SolidBody,SolidWorld,Vadd,Vsub,Vscale,Vcross,Vdot,Qeuler} from '../dist/physics/compound.js';
const metal={youngModulusPa:190e9,yieldStressPa:210e6,failureStressPa:420e6,failureStrain:.65,plasticity:.8,brittle:false};
const beam=(moment)=>new StructuralBody({nodes:[{position:[0,0,0],mass:1e6},{position:[1,0,0],mass:1}],constraints:[{kind:'distance',a:0,b:1,areaM2:.00005,material:metal,...(moment?{secondMomentM4:moment}:{})}],plasticityMode:'stress',iterations:10,internalDamping:0});
test('a newly coupled member with no previous step cannot poison mechanical work',()=>{
 const a=beam(1e-13),b=beam(1e-13);a.shareMechanicalEnergy(b);a.wake();a.velocity[3]=-96;a.step(1/120,[0,0,0]);assert.ok(Number.isFinite(a.plasticWorkJ));assert.ok(a.plasticWorkJ>0);b.leaveMechanicalEnergyGroup();b.wake();b.step(1/120,[0,0,0]);assert.ok(Number.isFinite(b.plasticWorkJ));
});
test('thin members buckle in compression without interpreting folding as tensile rupture',()=>{
 const thin=beam(1e-13);thin.wake();thin.velocity[3]=-96;thin.step(1/120,[0,0,0]);assert.equal(thin.broken[0],0);assert.ok(thin.plasticWorkJ>0);assert.ok(thin.position[3]<.3);
 const axial=beam();axial.wake();axial.velocity[3]=-96;axial.step(1/120,[0,0,0]);assert.equal(axial.broken[0],1);
 thin.position[3]=2;thin.velocity.fill(0);thin.step(1/120,[0,0,0]);assert.equal(thin.broken[0],1);
});
test('scalar rigid impulse, point velocity and inverse response retain the original arithmetic',()=>{
 for(let i=0;i<200;i++){
  const b=new SolidBody({p:[Math.sin(i),1,Math.cos(i)],q:Qeuler(i*.1,i*.03,i*.07),half:[.7,.025,.4],mass:12}),p=[1+i*.01,.9,Math.cos(i*.02)],j=[Math.sin(i)*100,-i*.4,Math.cos(i)*10],n=[.3,.8,.2];b.v=[i*.1,-2,4];b.w=[2,i*.02,-3];
  const speed=Vadd(b.v,Vcross(b.w,Vsub(p,b.p))),r=Vsub(p,b.p),effective=b.invMass+Vdot(n,Vcross(b.inertia(Vcross(r,n)),r)),v=Vadd(b.v,Vscale(j,b.invMass)),w=Vadd(b.w,b.inertia(Vcross(r,j)));
  assert.deepEqual(b.pointVelocity(p),speed);for(let a=0;a<3;a++)assert.equal(b.pointVelocityAxis(p,a),speed[a]);assert.equal(b.inverseEffectiveMass(p,n),effective);b.impulse(j,p);assert.deepEqual(b.v,v);assert.deepEqual(b.w,w);
 }
});
test('opted-in thin material is refined before its static collision prediction',()=>{
 const world=new SolidWorld({gravity:[0,0,0]}),b=world.add(new SolidBody({p:[0,1,0],half:[.5,.025,.4],mass:12}));world.add(new SolidBody({p:[0,1,.95],half:[1,1,.1]}));b.v=[0,0,60];let refined=0,advances=0;
 b.deformable={active:false,refineStaticsBeforePrediction:true,advance(){advances++;},pointVelocity(){return[0,0,0];},inverseEffectiveMass(){return 1/12;},impulse(){},force(){},torque(){}};b.contactRefinement=()=>{refined++;b.deformable.active=true;};world.step(1/120);assert.ok(refined>0);assert.ok(advances>0);
});
test('separate swept collision volumes keep their own substeps, while joints and supports retain coupling',()=>{
 const make=(coupled=false,support=false)=>{const a=new SolidBody({p:[0,1,0],half:[.025,.5,.5],mass:2}),b=new SolidBody({p:[1.5,1,0],half:[.3,.3,.3],mass:20}),w=new SolidWorld({gravity:[0,0,0],policies:support?{supports:body=>body===b?[a]:[]}: {}});w.add(a);w.add(b);a.w=[0,0,60];if(coupled)w.constraint(a,b,{solve(){}});w.step(1/120);return w.metrics;};
 const separate=make();assert.equal(separate.islands,2);assert.ok(separate.bodySubsteps<separate.substeps*2);assert.equal(make(true).islands,1);assert.equal(make(false,true).islands,1);
});
