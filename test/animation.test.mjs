import test from 'node:test';
import assert from 'node:assert/strict';
import {AnimationSystem,solveTwoBone,sampleWalker,bindHumanoid} from '../dist/animation/locomotion.js';
import {clothLoftMesh} from '../dist/procedural/cloth.js';
import {Scene} from '../dist/index.js';
const distance=(a,b)=>Math.hypot(...a.map((v,i)=>v-b[i]));
const near=(actual,expected,tolerance=1e-9)=>assert.ok(Math.abs(actual-expected)<tolerance,`${actual} != ${expected}`);

test('two-bone IK preserves lengths, handles unreachable targets and parallel pole',()=>{
 for(const target of [[0,0,0],[.1,-.6,.2],[3,-4,1],[0,-.01,0]])for(const pole of [[0,-1,0],[1,0,0]]){
  const result=solveTwoBone([0,0,0],target,.425,.42,pole);
  near(distance([0,0,0],result.joint),.425);near(distance(result.joint,result.end),.42);
  assert.ok([...result.joint,...result.end].every(Number.isFinite));
 }
 assert.throws(()=>solveTwoBone([0,0,0],[0,0,1],0,.4,[1,0,0]));
});

test('walking uses fixed world stance anchors, terrain heights and constant leg lengths in any heading',()=>{
 for(const heading of [0,.73,Math.PI,-Math.PI/2]){
  const walker={id:'hiker',root:[10,.2,-3],heading,speed:.86,period:1.3},terrain=p=>({height:.23+(p[0]-10)*.025,snowDepth:.05});let previous;
  for(let tick=0;tick<300;tick++){
   const pose=sampleWalker(walker,tick/60,terrain);
   for(const side of ['left','right']){const j=pose.joints;near(distance(j[side+'Hip'],j[side+'Knee']),.425);near(distance(j[side+'Knee'],j[side+'Ankle']),.42);}
   for(const foot of pose.feet){
    const old=previous?.feet.find(f=>f.id===foot.id);
    if(foot.grounded){near(foot.position[1],terrain(foot.position).height-.02);if(old?.grounded)assert.deepEqual(foot.position,old.position);}
    else assert.ok(foot.position[1]>=terrain(foot.position).height-.020001);
   }
   previous=pose;
  }
 }
});

test('engine animation owns transforms, supports multiple actors and wheel rolling without userland tick code',()=>{
 const scene=new Scene({version:1,entities:[{id:'a-thigh'},{id:'b-head'},{id:'body'},{id:'wheel'}]});
 const animation=new AnimationSystem(),a={id:'a',root:[0,0,0],speed:.8,bindings:[{entity:'a-thigh',joint:'leftHip',boneTo:'leftKnee',scale:[.2,1,.2]}]},b={id:'b',root:[5,0,3],speed:.4,heading:Math.PI/2,bindings:[{entity:'b-head',joint:'head',scale:[.2,.2,.2]}]};
 animation.addWalker(a);animation.addWalker(b);animation.addVehicle({id:'car',velocity:[2,0,0],parts:[{id:'body',origin:[-3,0,0]},{id:'wheel',origin:[-2,.3,.8],wheel:true,radius:.3}]});
 a.root[0]=999;animation.step(1,scene.entities);
 near(animation.pose('a').position[0],.8);near(animation.pose('b').position[2],2.6);near(scene.entities.get('a-thigh').scale[1],.425);near(scene.entities.get('body').position[0],-1);near(scene.entities.get('wheel').rotation[2],-2/.3);
 assert.equal(animation.feet.length,4);assert.throws(()=>animation.pose('a').joints.head[0]=12);assert.throws(()=>animation.feet.push({}));
 const copy=new AnimationSystem();copy.addWalker({...a,root:[0,0,0]});copy.addWalker(b);copy.addVehicle({id:'car',velocity:[2,0,0],parts:[{id:'body',origin:[-3,0,0]},{id:'wheel',origin:[-2,.3,.8],wheel:true,radius:.3}]});
 for(let tick=1;tick<=60;tick++)copy.step(tick/60,scene.entities);assert.deepEqual(copy.pose('a'),animation.pose('a'));
 animation.remove('a');assert.equal(animation.feet.length,2);assert.equal(animation.pose('a'),undefined);assert.throws(()=>animation.step(.5,scene.entities));
});

test('invalid rig and invalid terrain never partially move a scene',()=>{
 const scene=new Scene({version:1,entities:[{id:'head',position:[1,2,3]}]}),animation=new AnimationSystem();
 animation.addWalker({id:'person',root:[0,0,0],speed:1,bindings:[{entity:'head',joint:'head'},{entity:'missing',joint:'pelvis'}]});
 assert.throws(()=>animation.step(1,scene.entities));assert.deepEqual(scene.entities.get('head').position,[1,2,3]);assert.equal(animation.feet.length,0);
 assert.throws(()=>sampleWalker({id:'x',root:[0,0,0],speed:1},0,()=>({height:NaN})));assert.throws(()=>animation.addWalker({id:'person',root:[0,0,0],speed:1}));
});

test('actor removal respects exact ownership when IDs contain colons',()=>{
 const animation=new AnimationSystem();animation.addWalker({id:'a',root:[0,0,0],speed:.5});animation.addWalker({id:'a:b',root:[2,0,0],speed:.5});
 animation.step(1,new Map());const keep=animation.pose('a:b');assert.equal(animation.feet.length,4);
 animation.remove('a');assert.equal(animation.pose('a'),undefined);assert.equal(animation.pose('a:b'),keep);assert.deepEqual(animation.feet,keep.feet);
 animation.remove('missing');assert.deepEqual(animation.feet,keep.feet);animation.remove('a:b');assert.equal(animation.feet.length,0);
});

test('detaching scene entities preserves partial rigs and releases fully removed actors',()=>{
 const scene=new Scene({version:1,entities:[{id:'head'},{id:'coat'},{id:'car-body'},{id:'car-wheel'}]}),animation=new AnimationSystem();
 animation.addWalker({id:'walker',root:[0,0,0],speed:.7,bindings:[{entity:'head',joint:'head'},{entity:'coat',joint:'chest'}]});
 animation.addVehicle({id:'car',velocity:[1,0,0],parts:[{id:'car-body',origin:[0,0,0]},{id:'car-wheel',origin:[0,.3,0],wheel:true,radius:.3}]});
 animation.step(.5,scene.entities);animation.detachEntity('head');scene.entities.delete('head');animation.detachEntity('car-wheel');scene.entities.delete('car-wheel');
 animation.step(1,scene.entities);assert.equal(animation.feet.length,2);near(scene.entities.get('coat').position[0],.709);near(scene.entities.get('car-body').position[0],1);
 animation.detachEntity('unknown');animation.detachEntity('coat');scene.entities.delete('coat');assert.equal(animation.pose('walker'),undefined);assert.equal(animation.feet.length,0);
 animation.detachEntity('car-body');scene.entities.delete('car-body');assert.doesNotThrow(()=>animation.step(2,scene.entities));
 // Both IDs can be registered again: no empty actor remains to reserve them.
 assert.doesNotThrow(()=>animation.addWalker({id:'walker',root:[0,0,0],speed:0}));assert.doesNotThrow(()=>animation.addVehicle({id:'car',velocity:[0,0,0],parts:[]}));
});

test('Scene.step integrates an animated kinematic wheel once and exposes real contact velocity',()=>{
 const scene=new Scene({version:1,environment:{temperatureC:3,sunlight:0,precipitation:'arid'},entities:[
  {id:'tyre',position:[-2,.304,0],mesh:{kind:'sphere',radius:.3},body:{motion:'kinematic',mass:300,velocity:[17,0,0],angularVelocity:[0,0,9]}},
  {id:'optical-cover',position:[-2,.4,0],mesh:{kind:'box',size:[.2,.05,.1]},material:{kind:'glass'}},
  {id:'water',position:[0,.002,0],mesh:{kind:'box',size:[8,.004,2]},environmental:{surfaceUse:'road',waterDepthM:.004}},
 ]});
 scene.animation.addVehicle({id:'vehicle',velocity:[1.5,0,0],parts:[{id:'tyre',origin:[-2,.304,0],wheel:true,radius:.3},{id:'optical-cover',origin:[-2,.4,0]}]});scene.contacts.addWheelContact('tyre',{lateral:[0,0,1]});
 for(let tick=0;tick<120;tick++){
  scene.step();const tyre=scene.entities.get('tyre');near(tyre.position[0],-2+scene.time*1.5,1e-10);near(tyre.rotation[2],-scene.time*5,1e-10);near(tyre.body.velocity[0],1.5,1e-10);near(tyre.body.angularVelocity[2],-5,1e-10);
  assert.equal(tyre.position,tyre.body.position);assert.equal(tyre.rotation,tyre.body.rotation);near(scene.entities.get('optical-cover').position[0],tyre.position[0],1e-10);
 }
 near(scene.time,2,1e-10);near(scene.entities.get('tyre').position[0],1,1e-10);assert.ok(scene.contacts.sprayEmitted>15);assert.ok(scene.contacts.wetness>.5);
});

test('animated kinematic targets are deferred to physics while dynamic pose conflicts fail atomically',()=>{
 const scene=new Scene({version:1,entities:[{id:'kinematic',position:[0,1,0],mesh:{kind:'sphere',radius:.2},body:{motion:'kinematic',velocity:[3,0,0]}},{id:'dynamic',position:[2,1,0],mesh:{kind:'sphere',radius:.2},body:{mass:1}}]}),animation=new AnimationSystem();
 animation.addVehicle({id:'drive',velocity:[2,0,0],parts:[{id:'kinematic',origin:[0,1,0]}]});animation.step(.1,scene.entities);assert.deepEqual(scene.entities.get('kinematic').position,[0,1,0]);assert.deepEqual(scene.entities.get('kinematic').body.velocity,[2,0,0]);scene.physics.step(.1);near(scene.entities.get('kinematic').position[0],.2);
 animation.addVehicle({id:'invalid',velocity:[1,0,0],parts:[{id:'dynamic',origin:[2,1,0]}]});const before=[...scene.entities.values()].map(e=>({position:[...e.position],velocity:[...e.body.velocity],rotation:[...e.rotation]}));
 assert.throws(()=>animation.step(.2,scene.entities),/Dynamic body dynamic owns its pose/);assert.deepEqual([...scene.entities.values()].map(e=>({position:[...e.position],velocity:[...e.body.velocity],rotation:[...e.rotation]})),before);
 animation.remove('invalid');assert.doesNotThrow(()=>animation.step(.2,scene.entities));scene.physics.step(.1);near(scene.entities.get('kinematic').position[0],.4);
});

test('cloth loft is closed, bounded and has normalized normals derived from actual folds',()=>{
 const options={rings:[[-.5,.4,.4],[0,.5,.5],[.5,.3,.4]],radialSegments:48,subdivisions:5,folds:.025,seed:2},mesh=clothLoftMesh(options),flat=clothLoftMesh({...options,folds:0});
 assert.deepEqual(mesh,clothLoftMesh(options));assert.notDeepEqual(mesh.positions,flat.positions);assert.equal(mesh.positions.length,mesh.normals.length);
 for(let i=0;i<mesh.normals.length;i+=3)near(Math.hypot(...mesh.normals.slice(i,i+3)),1,1e-8);
 const edges=new Map();for(let i=0;i<mesh.indices.length;i+=3)for(let j=0;j<3;j++){const a=mesh.indices[i+j],b=mesh.indices[i+(j+1)%3],key=[a,b].sort((x,y)=>x-y).join(':');edges.set(key,(edges.get(key)??0)+1);}assert.ok([...edges.values()].every(count=>count===2));
 assert.throws(()=>clothLoftMesh({...options,radialSegments:10000}));
 const pose=sampleWalker({id:'x',root:[0,0,0],speed:0},0);assert.ok(bindHumanoid(pose,[{entity:'head',joint:'head'}])[0].position.every(Number.isFinite));
 const small=sampleWalker({id:'small',root:[0,0,0],speed:0,heightScale:.5},0),rig=bindHumanoid(small,[{entity:'head',joint:'head',scale:[.2,.2,.2]},{entity:'leg',joint:'leftHip',boneTo:'leftKnee',scale:[.2,1,.2]}]);assert.deepEqual(rig[0].scale,[.1,.1,.1]);near(rig[1].scale[1],.425*.5);
});
