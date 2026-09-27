import test from 'node:test';
import assert from 'node:assert/strict';
import {Scene} from '../dist/scene/scene.js';
import {DeformationAttachment} from '../dist/physics/deformation-field.js';
import {ForceFrame} from '../dist/physics/force-frame.js';
import {spawnVehicle} from '../dist/vehicles/scene-vehicle.js';
import {sceneFixture} from '../tools/vehicle-scene-fixture.mjs';
const near=(a,b,e=1e-8)=>assert.ok(Math.abs(a-b)<e,`${a} != ${b}`);
const tick=(scene,n)=>{for(let i=0;i<n;i++)scene.step(1/120);};

test('a scene vehicle has one authoritative mass, render-only glass and automatic final-pose projection',()=>{
 const f=sceneFixture();assert.equal(f.scene.physics.bodies.size,1);assert.equal(f.scene.entities.get('test-car').body,f.car.body);
 const glass=f.scene.entities.get('test-car/glass');assert.equal(glass.material.kind,'glass');assert.equal(glass.body,undefined);
 const wing=f.scene.entities.get('test-car/wing.left'),body=f.scene.entities.get('test-car/body');
 tick(f.scene,20);assert.deepEqual(wing.position,f.car.body.position);assert.equal(f.scene.renderMoverIds().has(body.id),true);
 assert.equal(f.car.body.mass,f.blueprint.massKg);f.handle.dispose();assert.equal(f.scene.entities.size,0);assert.equal(f.scene.physics.bodies.size,0);
});

test('the existing Scene integrator lifts the winged car; no scripted position or second world',()=>{
 const f=sceneFixture({damage:false});f.car.setControls({throttle:1});tick(f.scene,1800);f.car.setControls({flap:1});tick(f.scene,180);
 assert.ok(f.car.body.position[1]>1.3);assert.equal(f.car.part('rear.left').loadN,0);
 assert.deepEqual(f.scene.entities.get('test-car/wing.left').position,f.car.body.position);f.handle.dispose();
});

test('real collider impact changes the shared skin field and bends wing mounts without a health multiplier',()=>{
 const f=sceneFixture({crash:true}),skin=f.scene.entities.get('test-car/body'),rest=skin.mesh.positions;
 tick(f.scene,30);
 const field=f.scene.deformation.field('test-car');assert.ok(field.revision>0);assert.equal(field,f.scene.deformation.field('test-car'));
 assert.ok(f.scene.deformation.inspect().plasticWorkJ>1000);assert.notDeepEqual(skin.mesh.positions,rest);
 f.car.setAir({densityKgM3:1.225,wind:[-60,0,0]});f.car.setControls({flap:1});f.car.evaluate(1/120);
 const bent=structuredClone(f.car.part('wing.left'));assert.equal(bent.wear,0);assert.equal(bent.failed,false);
 // Isolate the structural cause at the EXACT same rigid pose/velocity/air/control.
 f.car.bindDeformation();f.car.evaluate(1/120);const unbound=structuredClone(f.car.part('wing.left'));
 assert.notDeepEqual(bent.localNormal,unbound.localNormal);assert.ok(bent.liftN<unbound.liftN*.98);
 assert.notEqual(bent.alphaRad,unbound.alphaRad);assert.equal(f.car.body.mass,f.blueprint.massKg);f.handle.dispose();
 assert.throws(()=>field.sample([0,0,0],[0,0,0]),/disposed/);
});

test('rendered skin vertices and mount queries consume exactly the same plastic field',()=>{
 const f=sceneFixture({crash:true});tick(f.scene,30);const field=f.scene.deformation.field('test-car'),skin=f.scene.entities.get('test-car/body');
 const com=f.blueprint.centerOfMass,out=[0,0,0],base=f.geometry.body.positions;
 for(let i=0;i<base.length;i+=3){field.sample([base[i]-com[0],base[i+1]-.75-com[1],base[i+2]-com[2]],out);
  near(skin.mesh.positions[i],out[0]+com[0],1e-9);near(skin.mesh.positions[i+1],out[1]+.75+com[1],1e-9);near(skin.mesh.positions[i+2],out[2]+com[2],1e-9);}
 f.handle.dispose();
});

test('fixed structural state is sampled once, not by HUD/audio/renderer readers or every physics tick',()=>{
 const f=sceneFixture({crash:true});tick(f.scene,30);f.scene.remove('striker');f.car.evaluate(1/120);
 const reads=f.car.deformationSamples,builds=f.car.deformationBuilds,p=f.car.part('wing.left');
 for(let i=0;i<10000;i++){void f.car.part('wing.left').localNormal;void p.liftN;void p.alphaRad;}
 for(let i=0;i<100;i++)f.car.evaluate(1/120);
 assert.equal(f.car.deformationSamples,reads);assert.equal(f.car.deformationBuilds,builds);f.handle.dispose();
});

test('uncached and cached physical attachment frames preserve the exact crash trajectory and geometry',()=>{
 const a=sceneFixture({crash:true}),b=sceneFixture({crash:true,reuseDerived:false});tick(a.scene,48);tick(b.scene,48);
 assert.deepEqual(a.car.body.position,b.car.body.position);assert.deepEqual(a.car.body.velocity,b.car.body.velocity);
 for(const p of a.blueprint.parts){const x=structuredClone(a.car.part(p.source.id)),y=structuredClone(b.car.part(p.source.id));delete x.derivedBuilds;delete y.derivedBuilds;assert.deepEqual(x,y);}
 assert.deepEqual(a.scene.entities.get('test-car/body').mesh,b.scene.entities.get('test-car/body').mesh);
 assert.deepEqual(a.scene.entities.get('test-car/wing.left').mesh,b.scene.entities.get('test-car/wing.left').mesh);
 assert.ok(b.car.deformationSamples>a.car.deformationSamples*2);a.handle.dispose();b.handle.dispose();
});

test('intact wings do not regenerate meshes while their owning body moves',()=>{
 const f=sceneFixture({damage:false});const left=f.scene.entities.get('test-car/wing.left'),mesh=left.mesh,builds=f.handle.diagnostics.wingMeshBuilds;
 f.car.setControls({throttle:1});tick(f.scene,180);assert.equal(left.mesh,mesh);assert.equal(f.handle.diagnostics.wingMeshBuilds,builds);
 f.car.setControls({flap:1});tick(f.scene,1);assert.notEqual(left.mesh,mesh);f.handle.dispose();
});

test('tyre wear changes the rendered tyre radius, never the alloy rim or wheel mesh topology',()=>{
 const f=sceneFixture({damage:false,wearEnergyJ:30000});f.car.body.velocity[0]=30;f.car.setControls({throttle:1,brake:1});
 const tire=f.scene.entities.get('test-car/tire-rear-left'),rim=f.scene.entities.get('test-car/rim-rear-left'),mesh=tire.mesh;
 tick(f.scene,120);assert.ok(f.car.part('rear.left').wear>0);near(tire.scale[0],f.car.part('rear.left').effectiveRadiusM/.346);
 assert.deepEqual(rim.scale,[1,1,1]);assert.equal(tire.mesh,mesh);f.handle.dispose();
});

test('removing a vehicle root releases projections and exact owned visuals, preserving replacements',()=>{
 const f=sceneFixture(),id='test-car/glass';f.scene.remove(id);const replacement=f.scene.add({id,collision:'none',mesh:{kind:'box'}});
 tick(f.scene,2);f.scene.remove('test-car');assert.equal(f.scene.entities.size,1);assert.equal(f.scene.entities.get(id),replacement);assert.equal(f.scene.physics.bodies.size,0);
 f.handle.dispose();tick(f.scene,5);assert.equal(f.scene.entities.get(id),replacement);
});

test('duplicate scene installation and invalid presentation fail without removing existing objects',()=>{
 const f=sceneFixture();const count=f.scene.entities.size;
 assert.throws(()=>spawnVehicle(f.scene,f.blueprint,f.geometry,{modelOriginM:[0,.75,0]}));assert.equal(f.scene.entities.size,count);assert.equal(f.scene.physics.bodies.size,1);
 const scene=new Scene({version:1,entities:[]});assert.throws(()=>scene.add({id:'bad',collision:'none',body:{mass:1},mesh:{kind:'box'}}));assert.equal(scene.entities.size,0);f.handle.dispose();
});

test('borrowed vectors cannot be used to mutate force or geometry state',()=>{
 const f=sceneFixture();const p=f.car.part('wing.left');assert.throws(()=>{p.force[0]=1e20;});assert.throws(()=>{p.localNormal[0]=33;});assert.deepEqual([...p.localNormal],[0,1,0]);f.handle.dispose();
});

test('a deformation attachment preserves a rigid transform while stripping local stretch/shear',()=>{
 const frame=new ForceFrame();frame.update([.2,.1,-.3]);const mount=new DeformationAttachment([1,2,3]);let calls=0;
 const field={revision:1,sample(p,out){calls++;frame.rotate([p[0]*2,p[1]*3,p[2]*4],out);out[0]+=4;}};
 mount.update(field);for(let i=0;i<9;i++)near(mount.basis[i],frame.basis[i]);assert.equal(calls,7);
 for(let i=0;i<100;i++)mount.update(field);assert.equal(calls,7);field.revision++;mount.update(field);assert.equal(calls,14);
});

test('bad field evaluations cannot poison the revision cache; collapsed fields stay finite and invalid',()=>{
 const mount=new DeformationAttachment([0,0,0]);let bad=true;
 const f={revision:1,sample(p,out){out.splice(0,3,p[0],bad?NaN:p[1],p[2]);}};
 assert.throws(()=>mount.update(f));assert.equal(mount.builds,0);bad=false;mount.update(f);assert.equal(mount.builds,1);assert.equal(mount.valid,true);
 mount.update({revision:2,sample(_p,out){out.fill(0);}});assert.equal(mount.valid,false);assert.ok(mount.basis.every(Number.isFinite));
});
