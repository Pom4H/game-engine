import test from 'node:test';
import assert from 'node:assert/strict';
import {Scene,validateScene,encodeScene,decodeScene,sceneURL,sceneFromURL} from '../dist/index.js';
import {BrowserRuntime} from '../dist/runtime/browser.js';
const authored=()=>({version:1,ground:-10,environment:{temperatureC:-2,sunlight:0,snowfall:'none'},entities:[
 {id:'walk',position:[0,.05,1],mesh:{kind:'box',size:[6,.1,1.6]},material:{kind:'concrete'},environmental:{surfaceUse:'generic',snowDepthM:.06}},
 {id:'road',position:[0,-.05,-1],mesh:{kind:'box',size:[6,.1,2]},material:{kind:'asphalt'},environmental:{surfaceUse:'road',waterDepthM:.004}},
 {id:'coat',mesh:{kind:'box',size:[.3,.6,.4]}},
 {id:'car',position:[-1,.4,-1],mesh:{kind:'box',size:[.8,.4,.6]}},
 {id:'wheel',position:[-1,.3,-1],mesh:{kind:'sphere',radius:.3},body:{motion:'kinematic',mass:1,velocity:[.5,0,0]}},
],animation:{walkers:[{id:'person',root:[-1,.14,1],speed:.4,bindings:[{entity:'coat',joint:'pelvis'}]}],vehicles:[{id:'vehicle',velocity:[.5,0,0],parts:[{id:'car',origin:[-1,.4,-1]}]}]},surfaceContacts:{snow:[{surfaceId:'walk',seed:53,maxTiles:16,maxDetailedTiles:4}],wheels:[{entityId:'wheel',radius:.3,lateral:[0,0,1]}]}});
const advance=(scene,ticks=120)=>{for(let i=0;i<ticks;i++)scene.step();return scene;};
const state=scene=>({snapshot:scene.snapshot(),contacts:scene.contacts.inspect(),feet:scene.animation.feet,footprints:scene.contacts.footprints.snapshot()});

test('SceneSpec roundtrip reconstructs native actors, snow deformation and wheel contact without player callbacks',async()=>{
 const source=authored(),scene=advance(new Scene(source));assert.equal(scene.contacts.inspect().surfaces,1);assert.equal(scene.contacts.inspect().wheelContacts,1);assert.ok(scene.contacts.footprints.snapshot().length>=3);assert.ok(scene.contacts.sprayEmitted>0);assert.ok(scene.contacts.inspect().detailedTiles>0);assert.ok(Math.abs(scene.entities.get('car').position[0])<1e-9);
 const decoded=decodeScene(encodeScene(source)),fromURL=(await sceneFromURL(sceneURL(source))).scene;
 assert.deepEqual(state(advance(new Scene(decoded))),state(scene));assert.deepEqual(state(advance(new Scene(fromURL))),state(scene));
 source.animation.walkers[0].root[0]=100;source.animation.vehicles[0].parts[0].origin[0]=100;source.surfaceContacts.snow[0].seed=999;
 assert.equal(scene.spec.animation.walkers[0].root[0],-1);assert.equal(scene.spec.animation.vehicles[0].parts[0].origin[0],-1);assert.equal(scene.spec.surfaceContacts.snow[0].seed,53);
});

test('BrowserRuntime.reset reconstructs authored native systems and repeats their deterministic contact history',()=>{
 const spec=authored(),runtime=Object.create(BrowserRuntime.prototype);runtime.initial=structuredClone(spec);runtime.scene=advance(new Scene(spec));let rendered=0;runtime.renderer={render:()=>rendered++,inspect:()=>({})};
 const expected=state(runtime.scene);runtime.reset();assert.equal(runtime.scene.tick,0);assert.equal(runtime.scene.contacts.inspect().surfaces,1);assert.equal(runtime.scene.contacts.inspect().wheelContacts,1);assert.equal(rendered,1);assert.deepEqual(state(advance(runtime.scene)),expected);
});

test('declarative binding validation rejects missing, conflicting, excessive and invalid rig/contact authoring',()=>{
 const mutations=[
  s=>s.animation.walkers[0].bindings[0].entity='missing',s=>s.animation.walkers[0].bindings[0].joint='unknown',s=>s.animation.walkers[0].bindings[0].boneTo='unknown',s=>s.animation.walkers[0].bindings[0].foot='third',s=>s.animation.walkers[0].bindings[0].scale=[1,0,1],s=>s.animation.walkers[0].period=null,
  s=>s.animation.vehicles[0].parts[0].id='coat',s=>s.animation.vehicles[0].parts[0].wheel='yes',s=>s.animation.vehicles[0].parts[0].wheel=true,s=>s.animation.vehicles[0].parts=[],s=>s.animation.vehicles[0].startTime=NaN,s=>s.animation.vehicles[0].id='person',s=>s.entities.find(e=>e.id==='car').body={mass:2},
  s=>s.animation.walkers=Array.from({length:129},(_,i)=>({id:'p'+i,root:[0,0,0],speed:0})),
  s=>s.surfaceContacts.snow[0].surfaceId='missing',s=>s.surfaceContacts.snow[0].surfaceId='coat',s=>s.surfaceContacts.snow.push({...s.surfaceContacts.snow[0]}),s=>s.surfaceContacts.snow[0].maxTiles=1,s=>s.surfaceContacts.snow[0].coarseCellSize=null,s=>s.surfaceContacts.snow[0].detailedCellSize=.001,s=>s.surfaceContacts.snow[0].material={texture:{url:'data:image/png,a'}},
  s=>s.surfaceContacts.wheels[0].entityId='car',s=>s.surfaceContacts.wheels[0].radius=-1,s=>s.surfaceContacts.wheels[0].pressureKPa=20,s=>s.surfaceContacts.wheels[0].widthM=.01,s=>s.surfaceContacts.wheels[0].tyreMassKg=0,s=>s.surfaceContacts.wheels[0].lateral=[NaN,0,0],s=>s.surfaceContacts.wheels.push({...s.surfaceContacts.wheels[0]}),s=>s.surfaceContacts.wheels=Array.from({length:513},()=>({entityId:'wheel'})),
 ];
 for(const mutate of mutations){const spec=authored();mutate(spec);assert.throws(()=>validateScene(spec));assert.throws(()=>new Scene(spec));}
 assert.doesNotThrow(()=>new Scene({version:1,entities:[]}));
});
