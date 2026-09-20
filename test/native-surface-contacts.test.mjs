import test from 'node:test';
import assert from 'node:assert/strict';
import {Scene} from '../dist/index.js';
import {SnowSurface} from '../dist/environment/snow-surface.js';
import {SurfaceContactSystem} from '../dist/environment/surface-contacts.js';

const snowy=(id='path',position=[0,0,0],rotation=[0,0,0])=>({id,position,rotation,mesh:{kind:'box',size:[8,.2,2.4]},material:{kind:'concrete'},environmental:{surfaceUse:'generic',snowDepthM:.06}});
const makeScene=entities=>new Scene({version:1,environment:{temperatureC:-3,snowfall:'none',sunlight:0,precipitation:'arid'},entities});
const foot=(id,x,z=0,grounded=true)=>({id,position:[x,.14,z],grounded,yaw:0});
const wheel=(id,x,z=0,grounded=true)=>({id,position:[x,.002,z],velocity:[3,0,0],grounded,lateral:[0,0,1]});

test('native contact pipeline deforms two authored snow surfaces and publishes exactly one sound record per planting',()=>{
 const scene=makeScene([snowy('north'),snowy('south',[0,0,5])]),contacts=new SurfaceContactSystem(scene);
 const north=contacts.addSnowSurface('north'),south=contacts.addSnowSurface('south');
 contacts.step(1/60,1/60,[foot('a:left',-1),foot('b:left',1,5)]);
 const events=contacts.drainFootsteps();assert.equal(events.length,2);assert.deepEqual(events.map(e=>e.surfaceId),['north','south']);
 assert.ok(north.height(-.968,0)<north.sample(-.968,0)-.018);assert.ok(south.height(1.032,5)<south.sample(1.032,5)-.018);
 contacts.step(1/60,2/60,[foot('a:left',-1),foot('b:left',1,5)]);assert.equal(contacts.drainFootsteps().length,0);
 contacts.step(1/60,3/60,[foot('a:left',-1,0,false)]);contacts.step(1/60,4/60,[foot('a:left',0)]);assert.equal(contacts.drainFootsteps().length,1);
 assert.equal(scene.resources.get('engine:surface-contacts').footprints,3);assert.ok(contacts.inspect().detailedTiles>0);
 contacts.dispose();assert.equal(scene.entities.size,2);assert.equal(scene.resources.has('engine:surface-contacts'),false);
});

test('airborne feet and warm bare paths produce neither imprints nor crunch records; removed sources clean their meshes',()=>{
 const bare={...snowy(),environmental:{surfaceUse:'generic',snowDepthM:0}},scene=makeScene([bare]),contacts=new SurfaceContactSystem(scene);contacts.addSnowSurface('path');
 assert.equal(scene.entities.size,1);contacts.step(1/60,1/60,[foot('left',0)]);assert.equal(contacts.drainFootsteps().length,0);
 const snowyScene=makeScene([snowy()]),other=new SurfaceContactSystem(snowyScene);other.addSnowSurface('path');
 other.step(1/60,1/60,[foot('left',0,0,false)]);other.step(1/60,2/60,[{...foot('left',0),position:[0,.5,0]}]);assert.equal(other.footprints.snapshot().length,0);
 snowyScene.remove('path');other.step(1/60,3/60,[]);assert.equal(snowyScene.entities.size,0);assert.equal(other.inspect().surfaces,0);
});

test('snow terrain is rotated with its source; bounded stamp eviction removes old geometry and detail budgets hold',()=>{
 const surface=new SnowSurface({id:'terrain',center:[3,5],size:[12,2],yaw:Math.PI/2,height:.16,snowDepth:.06,capacity:2,maxDetailedTiles:2});
 assert.equal(surface.contains(3,10),true);assert.equal(surface.contains(8,5),false);surface.drainMeshes();
 const stamp=(sequence,z)=>({sequence,foot:'left',position:[3,.14,z],yaw:Math.PI/2,time:sequence,depth:.025});
 surface.stamp(stamp(0,1));const h=surface.height(3,1.032);assert.ok(h<.15);
 surface.stamp(stamp(1,5));surface.stamp(stamp(2,9));assert.equal(surface.stamps.length,2);assert.ok(surface.height(3,1.032)>.15);assert.ok(surface.detailedTiles<=2);
 const meshes=surface.drainMeshes();assert.ok(meshes.length>0);assert.ok(meshes.every(m=>m.mesh.positions.every(Number.isFinite)));assert.ok(surface.tileCount<=6);
 assert.throws(()=>new SnowSurface({id:'bad',center:[0,0],size:[1000,1000],height:0,maxTiles:10}));
});

test('wheel water spray queries real polygon interiors and suppresses dry, stationary and airborne contacts',()=>{
 const puddle={id:'odd-water',position:[0,0,0],rotation:[0,Math.PI/4,0],mesh:{kind:'polygon-prism',axis:1,thickness:.002,points:[[-2,-2],[2,-2],[-2,2]]},environmental:{surfaceUse:'road',waterDepthM:.004},material:{kind:'asphalt'}};
 const scene=makeScene([puddle]),contacts=new SurfaceContactSystem(scene,{particleCapacity:8});
 const outside=wheel('one',1.7,0);for(let i=1;i<=10;i++)contacts.step(1/60,i/60,[],[outside]);assert.equal(contacts.sprayEmitted,0);assert.equal(contacts.wetness,0);
 for(let i=11;i<=20;i++)contacts.step(1/60,i/60,[],[wheel('one',-1,0,false)]);assert.equal(contacts.sprayEmitted,0);
 for(let i=21;i<=30;i++)contacts.step(1/60,i/60,[],[{...wheel('one',-1),velocity:[0,0,0]}]);assert.equal(contacts.sprayEmitted,0);
 for(let i=31;i<=90;i++)contacts.step(1/60,i/60,[],[wheel('one',-1)]);assert.ok(contacts.sprayEmitted>10);assert.ok(contacts.wetness>.9);assert.ok(contacts.inspect().particleEntities<=8);assert.ok(contacts.inspect().particles<=8);
 for(let i=91;i<=150;i++)contacts.step(1/60,i/60,[],[]);assert.equal(contacts.wetness,0);assert.equal(contacts.inspect().particles,0);
 contacts.dispose();assert.equal(scene.entities.size,1);
});

test('surface contact simulation is deterministic and rejects a malformed contact frame atomically',()=>{
 const run=()=>{const scene=makeScene([snowy(),{id:'water',position:[10,0,0],mesh:{kind:'box',size:[4,.004,2]},environmental:{surfaceUse:'road',waterDepthM:.004}}]),contacts=new SurfaceContactSystem(scene,{particleCapacity:12});contacts.addSnowSurface('path');
  for(let i=1;i<=60;i++)contacts.step(1/60,i/60,[foot('left',i<30?-1:1,0,i%30!==0)],[wheel('wheel',10)]);return{events:contacts.drainFootsteps(),stats:contacts.inspect(),particles:[...scene.entities.values()].filter(e=>e.id.includes(':spray:')).map(e=>e.position)};};
 assert.deepEqual(run(),run());
 const scene=makeScene([snowy()]),contacts=new SurfaceContactSystem(scene);contacts.addSnowSurface('path');const before=contacts.inspect();
 assert.throws(()=>contacts.step(1/60,1/60,[foot('left',0)],[{...wheel('wheel',0),velocity:[NaN,0,0]}]));assert.deepEqual(contacts.inspect(),before);assert.equal(contacts.drainFootsteps().length,0);
 contacts.step(1/60,1/60,[foot('left',0)]);assert.equal(contacts.drainFootsteps().length,1);
});

test('Scene.step alone orders weather, rig placement, physics, snow impressions and water spray at one authoritative time',()=>{
 const scene=new Scene({version:1,environment:{temperatureC:-3,snowfall:'moderate',sunlight:0,clock:{hoursPerSecond:.05}},entities:[
  snowy(),
  {id:'walker-head',mesh:{kind:'sphere',radius:.12}},
  {id:'car-mesh',position:[-2,.6,5],mesh:{kind:'box',size:[2,1,1]}},
  {id:'tyre-contact',position:[-2,.354,5],mesh:{kind:'sphere',radius:.35},body:{motion:'kinematic',mass:390,velocity:[1,0,0],shape:'sphere'}},
  {id:'puddle-arbitrary-id',position:[0,.002,5],mesh:{kind:'box',size:[10,.004,2]},material:{kind:'asphalt'},environmental:{surfaceUse:'road',waterDepthM:.004}},
 ]});
 scene.contacts.addSnowSurface('path');scene.contacts.addWheelContact('tyre-contact',{lateral:[0,0,1]});
 scene.animation.addWalker({id:'walker',root:[-2,.14,0],speed:.6,bindings:[{entity:'walker-head',joint:'head'}]});
 scene.animation.addVehicle({id:'car',velocity:[1,0,0],parts:[{id:'car-mesh',origin:[-2,.6,5]}]});
 let previous;const records=[];
 for(let tick=0;tick<180;tick++){
  scene.step();records.push(...scene.contacts.drainFootsteps());
  for(const foot of scene.animation.feet){const old=previous?.find(p=>p.id===foot.id);if(old?.grounded&&foot.grounded)assert.deepEqual(foot.position,old.position);if(foot.grounded)assert.ok(Math.abs(foot.position[1]-(scene.contacts.sample(foot.position).height-.02))<.003);}
  previous=scene.animation.feet;
 }
 assert.ok(Math.abs(scene.entities.get('car-mesh').position[0]-1)<1e-10);assert.ok(Math.abs(scene.entities.get('tyre-contact').position[0]-1)<1e-10);
 assert.deepEqual(scene.entities.get('walker-head').position,scene.animation.pose('walker').joints.head);
 assert.ok(records.length>=5);assert.deepEqual(records.map(({surfaceId,wetness,slush,temperatureC,...record})=>record),scene.contacts.footprints.snapshot());
 assert.ok(records.every(r=>r.surfaceId==='path'&&r.time>0&&r.time<=scene.time));assert.ok(scene.contacts.sprayEmitted>20);assert.ok(scene.contacts.wetness>.1);assert.ok(scene.surfaces.surface('path').snowDepthM>.0605);
 const order=scene.lastExecution;for(const [before,after] of [['surfaces','animation'],['animation','physics'],['physics','surface-contacts'],['surface-contacts','events'],['events','clock']])assert.ok(order.indexOf('engine:'+before)<order.indexOf('engine:'+after));
 assert.equal(scene.resources.get('engine:surface-contacts').time,scene.time);assert.ok(scene.contacts.inspect().particleEntities<=96);
});

test('native snow inherits the authored environmental texture while explicit surface material overrides it',()=>{
 const authored={...snowy(),environmental:{...snowy().environmental,snowMaterial:{kind:'snow',texture:{url:'/assets/snow.jpg',sizeM:1.8,bumpStrength:.9}}}};
 const scene=makeScene([authored]),surface=scene.contacts.addSnowSurface('path');
 const skinEntity=scene.entities.get(surface.ids()[0]);assert.equal(skinEntity.material.texture.url,'/assets/snow.jpg');assert.equal(skinEntity.material.texture.sizeM,1.8);
 authored.environmental.snowMaterial.texture.sizeM=99;assert.equal(surface.options.material.texture.sizeM,1.8);assert.throws(()=>surface.options.material.texture.sizeM=9);
 const other=makeScene([authored]),override=other.contacts.addSnowSurface('path',{material:{kind:'snow',roughness:.83}});assert.equal(override.options.material.texture,undefined);assert.equal(other.entities.get(override.ids()[0]).material.roughness,.83);
});

test('Scene.remove immediately clears native source geometry and wheel registration without stale bindings',()=>{
 const scene=makeScene([snowy(),{id:'wheel',position:[0,.35,4],mesh:{kind:'sphere',radius:.35},body:{motion:'kinematic',mass:10,velocity:[1,0,0]}}]);
 scene.contacts.addSnowSurface('path');scene.contacts.addWheelContact('wheel');assert.ok(scene.entities.size>2);assert.equal(scene.contacts.inspect().wheelContacts,1);
 scene.remove('path');assert.equal(scene.entities.size,1);assert.equal(scene.contacts.inspect().surfaces,0);
 scene.remove('wheel');assert.equal(scene.contacts.inspect().wheelContacts,0);assert.equal(scene.entities.size,0);scene.step();assert.equal(scene.contacts.wetness,0);assert.equal(scene.contacts.inspect().sprayEmitted,0);
});

test('generated surface namespaces skip authored collisions and reserve distinct identities before any effects spawn',()=>{
 const authored=[{id:'__contacts:snow:0:0:0',position:[71,72,73],mesh:{kind:'box'}},{id:'__contacts:spray:0',position:[81,82,83],mesh:{kind:'box'}}];
 const scene=makeScene([snowy(),...authored,{id:'water',position:[0,.002,4],mesh:{kind:'box',size:[8,.004,2]},environmental:{surfaceUse:'road',waterDepthM:.004}},{id:'wheel',position:[-2,.354,4],mesh:{kind:'sphere',radius:.35},body:{motion:'kinematic',mass:10,velocity:[1,0,0]}}]);
 const originals=authored.map(e=>scene.entities.get(e.id));const skin=scene.contacts.addSnowSurface('path');scene.contacts.addWheelContact('wheel');
 assert.ok(skin.ids().every(id=>id.startsWith('__contacts#1:')));
 const extraA=new SurfaceContactSystem(scene),extraB=new SurfaceContactSystem(scene),a=extraA.addSnowSurface('path'),b=extraB.addSnowSurface('path');assert.notEqual(a.ids()[0],b.ids()[0]);
 for(let tick=0;tick<20;tick++)scene.step();assert.ok(scene.contacts.sprayEmitted>0);
 for(let i=0;i<authored.length;i++){assert.equal(scene.entities.get(authored[i].id),originals[i]);assert.deepEqual(originals[i].position,authored[i].position);}
 scene.contacts.dispose();extraA.dispose();extraB.dispose();for(let i=0;i<authored.length;i++)assert.equal(scene.entities.get(authored[i].id),originals[i]);
});

test('snow rebuild and cleanup never replace or remove an authored entity inserted under a former generated ID',()=>{
 const scene=makeScene([snowy()]),skin=scene.contacts.addSnowSurface('path'),id=skin.ids()[0];scene.remove(id);
 const authored=scene.add({id,position:[10,20,30],mesh:{kind:'box'}});
 assert.throws(()=>scene.contacts.step(1/60,1/60,[foot('left',-3)]),/unowned entity/);assert.equal(scene.entities.get(id),authored);assert.deepEqual(authored.position,[10,20,30]);
 scene.contacts.removeSnowSurface('path');assert.equal(scene.entities.get(id),authored);
 const next=scene.contacts.addSnowSurface('path');assert.ok(!next.ids().includes(id));scene.contacts.dispose();assert.equal(scene.entities.get(id),authored);
});

test('particle reuse verifies object ownership instead of trusting a generated-looking ID',()=>{
 const scene=makeScene([{id:'water',position:[0,0,0],mesh:{kind:'box',size:[8,.004,2]},environmental:{surfaceUse:'road',waterDepthM:.004}}]),contacts=new SurfaceContactSystem(scene,{particleCapacity:1});
 for(let tick=1;tick<=4;tick++)contacts.step(1/60,tick/60,[],[wheel('wheel',0)]);
 const id=[...scene.entities.keys()].find(id=>id.includes(':spray:'));assert.ok(id);scene.remove(id);const authored=scene.add({id,position:[4,5,6],mesh:{kind:'box'}});
 assert.throws(()=>contacts.step(1/60,5/60,[],[wheel('wheel',0)]),/collides with an authored entity/);assert.deepEqual(authored.position,[4,5,6]);contacts.dispose();assert.equal(scene.entities.get(id),authored);
});


test('bound wheel contact work distinguishes rolling from locked slip without coarse body double-counting',()=>{
 const radius=.35,speed=3;
 const scene=new Scene({version:1,ground:-100,environment:{temperatureC:-2,snowfall:'none',sunlight:0,precipitation:'arid'},entities:[
  {id:'road',position:[0,-.1,0],mesh:{kind:'box',size:[18,.2,6]},material:{kind:'asphalt'},environmental:{surfaceUse:'road',snowDepthM:.02}},
  {id:'rolling',position:[-2,radius,-1],mesh:{kind:'sphere',radius},body:{motion:'kinematic',mass:100,velocity:[speed,0,0],angularVelocity:[0,0,-speed/radius],friction:.7}},
  {id:'locked',position:[-2,radius,1],mesh:{kind:'sphere',radius},body:{motion:'kinematic',mass:100,velocity:[speed,0,0],angularVelocity:[0,0,0],friction:.7}},
 ]});
 scene.contacts.addWheelContact('rolling',{radius,lateral:[0,0,1]});
 scene.contacts.addWheelContact('locked',{radius,lateral:[0,0,1]});
 for(let i=0;i<60;i++)scene.step(1/60);
 const rolling=scene.surfaces.sample('road',0,-1),locked=scene.surfaces.sample('road',0,1);
 assert.ok(rolling&&locked);
 assert.ok(locked.trackMelt>rolling.trackMelt*10,`locked tyre must deposit much more slip work: rolling=${rolling.trackMelt} locked=${locked.trackMelt}`);
 assert.ok(locked.trafficHeatC>rolling.trafficHeatC*10,`locked tyre must heat its local patch more: rolling=${rolling.trafficHeatC} locked=${locked.trafficHeatC}`);
 assert.ok(locked.dirt>=rolling.dirt);
});

test('removing a wheel binding releases the body back to generic surface work',()=>{
 const radius=.35,scene=new Scene({version:1,ground:-100,environment:{temperatureC:-2,snowfall:'none',sunlight:0,precipitation:'arid'},entities:[
  {id:'road',position:[0,-.1,0],mesh:{kind:'box',size:[12,.2,4]},material:{kind:'asphalt'},environmental:{surfaceUse:'road',snowDepthM:.02}},
  {id:'wheel',position:[-2,radius,0],mesh:{kind:'sphere',radius},body:{motion:'kinematic',mass:100,velocity:[2,0,0],angularVelocity:[0,0,-2/radius],friction:.7}},
 ]});
 scene.contacts.addWheelContact('wheel',{radius});for(let i=0;i<30;i++)scene.step(1/60);
 const before=scene.surfaces.surface('road').trackMelt;
 scene.contacts.removeWheelContact('wheel');for(let i=0;i<30;i++)scene.step(1/60);
 assert.ok(scene.surfaces.surface('road').trackMelt>before,'unclaimed moving body should re-enter the generic fallback contact path');
});
