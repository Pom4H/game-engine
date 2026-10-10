import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {PhysicsWorld,RigidBody} from '../dist/physics/world.js';
import {createWasmRigidContactKernel} from '../dist/physics/rigid-wasm.js';
import {Scene} from '../dist/scene/scene.js';
import {material} from '../dist/materials/catalog.js';

const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
const path=resolve(root,'kernels/world-rigid/target/wasm32-unknown-unknown/release/world_rigid_kernel.wasm');
const wasm=await WebAssembly.compile(new Uint8Array(readFileSync(path)));

function car(id,x,z,vx,rotation=0){
  return new RigidBody({
    id,shape:{kind:'box',half:[2.15,.72,1.0]},
    position:[x,4,z],rotation:[0,rotation,0],
    velocity:[vx,0,0],angularVelocity:[0,.02,0],
    mass:1700,restitution:.22,friction:.9,material:material('steel'),
  });
}
function sceneFixtures(type){
  const world=new PhysicsWorld([0,0,0],-100);
  if(type==='cars-head-on'){
    world.add(car('carA',-2.3,0,9,.09));
    world.add(car('carB',2.3,.1,-8,-.06));
  }else if(type==='cars-side'){
    const a=car('carA',-.9,0,2,.36);
    a.velocity=[3,0,2.1];world.add(a);
    const b=car('carB',2.3,1.05,-2,-.28);
    b.velocity=[-4,0,-1];world.add(b);
  }else if(type==='rotated-rail'){
    world.add(new RigidBody({id:'rail',position:[0,4,0],rotation:[0,Math.PI/2,0],shape:{kind:'box',half:[2,.25,.25]},material:material('steel')}));
    world.add(new RigidBody({id:'mover',position:[.4,4,1.7],velocity:[-4,0,0],mass:3,shape:{kind:'box',half:[.3,.3,.3]},friction:.35}));
  }else if(type==='sphere-box'){
    world.add(new RigidBody({id:'cube',position:[0,4,0],shape:{kind:'box',half:[1,1,1]},mass:3,velocity:[-1,0,0],rotation:[0,.18,.05]}));
    world.add(new RigidBody({id:'sphere',position:[1.4,4.2,0],shape:{kind:'sphere',radius:.55},mass:2,velocity:[-3,-.4,0],friction:.6}));
  }else if(type==='sphere-sphere'){
    world.add(new RigidBody({id:'s1',position:[-.49,4,0],shape:{kind:'sphere',radius:.5},mass:2,velocity:[4,0,0],restitution:.3}));
    world.add(new RigidBody({id:'s2',position:[.49,4,0],shape:{kind:'sphere',radius:.5},mass:2,velocity:[-2,0,0],restitution:.3}));
  }else if(type==='many'){
    for(let i=0;i<16;i++){
      const body=car('car'+i,(i%4)*3.1,Math.floor(i/4)*1.85,
        (i%2===0?1:-1)*2.5,(i%3-.5)*.13);
      world.add(body);
    }
  }else throw new Error('unknown fixture');
  return world;
}

function near(a,b,path,tick){
  assert.ok(Number.isFinite(a)&&Number.isFinite(b),'non-finite '+path+' tick '+tick);
  const error=Math.abs(a-b),budget=1e-8+Math.max(Math.abs(a),Math.abs(b))*1e-9;
  assert.ok(error<=budget,'tick '+tick+' '+path+': '+a+' != '+b+' diff='+error);
}
function parity(reference,candidate,tick){
  assert.equal(candidate.steps,reference.steps);
  assert.equal(candidate.substeps,reference.substeps);
  assert.equal(candidate.bodies.size,reference.bodies.size);
  assert.equal(candidate.contacts.length,reference.contacts.length,'contact count '+tick);
  for(const [id,a] of reference.bodies){
    const b=candidate.bodies.get(id);
    assert.ok(b,'missing '+id);
    assert.equal(b.sleeping,a.sleeping,'sleep '+id+' '+tick);
    for(const key of ['position','rotation','velocity','angularVelocity','collisionHalf','crushPositive','crushNegative']){
      const av=a[key],bv=b[key];
      if(!av)continue;
      for(let i=0;i<3;i++)near(av[i],bv[i],id+'.'+key+'['+i+']',tick);
    }
  }
  for(let i=0;i<reference.contacts.length;i++){
    const a=reference.contacts[i],b=candidate.contacts[i];
    assert.equal(b.a,a.a);assert.equal(b.b,a.b);assert.equal(b.mode,a.mode);
    for(const field of ['penetration','impulse','normalEnergy','normalSpeed']){
      near(a[field],b[field],'contacts['+i+'].'+field,tick);
    }
    for(const key of ['normal','point'])for(let axis=0;axis<3;axis++){
      near(a[key][axis],b[key][axis],key+'['+axis+']',tick);
    }
  }
}

for(const fixture of ['cars-head-on','cars-side','rotated-rail','sphere-box','sphere-sphere','many']){
  test('Rust/TypeScript full PhysicsWorld tick parity: '+fixture,async()=>{
    const expected=sceneFixtures(fixture);
    const actual=sceneFixtures(fixture);
    const kernel=await createWasmRigidContactKernel(wasm);
    actual.setRigidContactKernel(kernel);
    try{
      assert.equal(actual.rigidContactBackend,'wasm');
      let contacts=0;
      for(let tick=0;tick<90;tick++){
        expected.step(1/120);actual.step(1/120);
        parity(expected,actual,tick);
        contacts+=actual.contacts.length;
      }
      assert.ok(contacts>0,'fixture must exercise narrowphase and point impulses');
    }finally{actual.setRigidContactKernel(null);kernel.dispose();}
  });
}

test('material penetration callback executes in JS with Rust narrowphase and identical state',async()=>{
  const build=()=>{const w=new PhysicsWorld([0,0,0],-100);
    w.add(new RigidBody({id:'thin',shape:{kind:'box',half:[.02,1,1]},position:[0,3,0],mass:2,velocity:[0,0,0]}));
    w.add(new RigidBody({id:'bullet',shape:{kind:'sphere',radius:.2},position:[-.20,3,0],mass:1,velocity:[10,0,0]}));
    return w;};
  const a=build(),b=build();
  const kernel=await createWasmRigidContactKernel(wasm);
  b.setRigidContactKernel(kernel);
  const seenA=[],seenB=[];
  try{
    for(let i=0;i<10;i++){
      a.step(1/120,c=>{seenA.push(c.normalEnergy);return{mode:'penetrate',energyLoss:c.normalEnergy*.4};});
      b.step(1/120,c=>{seenB.push(c.normalEnergy);return{mode:'penetrate',energyLoss:c.normalEnergy*.4};});
      parity(a,b,i);
    }
    assert.ok(seenA.length>0);
    assert.equal(seenA.length,seenB.length);
    seenA.forEach((value,i)=>near(value,seenB[i],'penetrationEnergy',i));
  }finally{kernel.dispose();}
});

test('cause trace bypasses native collisions, preserving provenance and energy closure',async()=>{
  const a=sceneFixtures('cars-head-on');
  const kernel=await createWasmRigidContactKernel(wasm);
  const b=sceneFixtures('cars-head-on');
  b.setRigidContactKernel({
    test(){throw new Error('native should be bypassed while tracing');},
    resolve(){throw new Error('native should be bypassed while tracing');},
    dispose(){},
  });
  const trace=a.traceCauses(),trace2=b.traceCauses();
  for(let tick=0;tick<10;tick++){
    a.step(1/120);b.step(1/120);parity(a,b,tick);
  }
  assert.ok(trace&&trace2);
  b.stopCauseTrace(trace2);
  b.setRigidContactKernel(kernel);
  b.step(1/120);a.step(1/120);
  parity(a,b,11);
  kernel.dispose();
});

test('Scene material fracture laws run with optional Rust backend',async()=>{
 const spec={version:1,gravity:[0,0,0],ground:-100,entities:[
  {id:'glass',position:[0,8,0],mesh:{kind:'box',size:[.01,1.4,1.2]},material:{kind:'glass'}},
  {id:'ball',position:[-.8,8,0],mesh:{kind:'sphere',radius:.11},material:{kind:'steel'},body:{mass:3.8,velocity:[30,0,0]}},
 ]};
 const baseline=new Scene(spec),native=new Scene(spec);
 const kernel=await createWasmRigidContactKernel(wasm);
 native.physics.setRigidContactKernel(kernel);
 try{
  for(let tick=0;tick<18;tick++){
   baseline.step(1/120);native.step(1/120);
   assert.deepEqual([...native.entities.keys()],[...baseline.entities.keys()],'same authored/fractured entities');
   for(const key of ['glass','ball']){
    const a=baseline.entities.get(key),b=native.entities.get(key);
    if(a&&b)for(let i=0;i<3;i++)near(a.position[i],b.position[i],key+'.position',tick);
   }
  }
  assert.equal(native.entities.has('glass'),false,'real material law must fracture');
 }finally{kernel.dispose();}
});
