import test from 'node:test';
import assert from 'node:assert/strict';
import {Scene,EngineKernel,validateScene,primitiveKey} from '../dist/index.js';
import {WebGPURenderer} from '../dist/render/webgpu.js';
const empty={version:1,entities:[]};
test('scene runs extension cadence and publishes committed resources',()=>{
 const scene=new Scene(empty);let calls=0,published;
 scene.use({id:'extension',phase:'plan',rateHz:30,reads:[],writes:['counter'],run:(_,frame)=>{calls++;assert.equal(frame.deltaSeconds,1/30);return[{type:'resource',key:'counter',value:calls}];}});
 scene.use({id:'observer',phase:'publish',rateHz:60,reads:['counter'],writes:[],run:c=>{published=c.resources.get('counter');}});
 for(let i=0;i<60;i++)scene.step();assert.equal(calls,30);assert.equal(published,30);assert.ok(scene.lastExecution.includes('engine:physics'));assert.ok(scene.systemRuntime.actions.includes('surfaces'));
});
test('built-in resource graph exposes surface-state and no winter resource',()=>{
 const scene=new Scene(empty),modules=scene.kernel.scheduler.plan(2).flatMap(batch=>batch.modules);
 assert.ok(modules.some(module=>module.reads.includes('surface-state')||module.writes.includes('surface-state')));
 assert.equal(modules.some(module=>module.reads.includes('winter')||module.writes.includes('winter')),false);
});
test('kernel commits producer before consumer independent of alphabetical IDs',()=>{
 const kernel=new EngineKernel();let seen;
 kernel.use({id:'a-reader',phase:'simulate',rateHz:60,reads:['value'],writes:[],after:['z-writer'],run:c=>{seen=c.nested.value;}});
 kernel.use({id:'z-writer',phase:'simulate',rateHz:60,reads:[],writes:['value'],run:()=>[1]});
 kernel.run(1,{nested:{value:0}},'detailed',{commit:cmd=>({nested:{value:cmd[0]}})});assert.equal(seen,1);
});
test('kernel rejects ambiguous hazards, cycles and mutation of nested state',()=>{
 const module=(id,after)=>({id,after,phase:'plan',rateHz:60,reads:[],writes:['same'],run:()=>[]});
 const k=new EngineKernel().use(module('a')).use(module('b'));assert.throws(()=>k.run(1,{}),/Ambiguous/);
 const cyclic=new EngineKernel().use(module('a',['b'])).use(module('b',['a']));assert.throws(()=>cyclic.run(1,{}),/cycle/);
 const immutable=new EngineKernel().use({...module('m'),run:c=>{assert.throws(()=>c.nested.value=3,TypeError);assert.throws(()=>c.map.set('x',3),/read-only/);}});
 const context={nested:{value:0},map:new Map()};immutable.run(1,context);assert.equal(context.nested.value,0);assert.equal(context.map.size,0);
});
test('invalid mesh/body data fails at both authoring boundaries with field paths',()=>{
 for(const entity of [{id:'bad',mesh:{kind:'sphere',radius:-1}},{id:'bad',body:{velocity:[null,0,0]}},{id:'bad',mesh:{kind:'unknown'}},{id:'bad',scale:[1,0,1]}]){
  assert.throws(()=>validateScene({...empty,entities:[entity]}),/bad\./);const scene=new Scene(empty);assert.throws(()=>scene.add(entity),/bad\./);assert.equal(scene.entities.size,0);
 }
 assert.throws(()=>validateScene({...empty,environment:{weather:[{hour:2,sunlight:NaN}]}}),/sunlight/);
});
const surfaceScene=(height=0)=>new Scene({version:1,ground:-100,environment:{temperatureC:-6,snowfall:'heavy',sunlight:0},entities:[
 {id:'road',position:[0,-.1,0],mesh:{kind:'box',size:[12,.2,8]},material:{kind:'asphalt'},environmental:{surfaceUse:'road'}},
 {id:'sled',position:[-3,.25+height,1.5],mesh:{kind:'box',size:[1,.5,1]},material:{kind:'steel'},body:{mass:1500,motion:'kinematic',velocity:[3,0,0]}}
]});
test('surface state follows supported footprints, excludes airborne motion and releases fields',()=>{
 const scene=surfaceScene(),air=surfaceScene(1);for(let i=0;i<60;i++){scene.step();air.step();}
 const on=scene.surfaces.sample('road',-1.5,1.5),off=scene.surfaces.sample('road',-1.5,-1.5);
 assert.ok(on.trackMelt>0);assert.equal(off.trackMelt,0);assert.equal(air.surfaces.surface('road').trackMelt,0);
 assert.ok(on.snowDepthM<off.snowDepthM);assert.ok(on.frictionScale<off.frictionScale);
 const body=scene.physics.bodies.get('road');assert.equal(scene.physics.surfaceFrictionAt(body,[-1.5,0,1.5]),body.friction*on.frictionScale);
 scene.remove('road');assert.equal(scene.surfaces.field('road'),undefined);
});
test('renderer releases object/unique mesh resources but retains shared geometry',()=>{
 // Exercise the real cache collector; resource handles record actual destroy calls.
 const renderer=Object.create(WebGPURenderer.prototype),destroyed=[];
 const handle=id=>({destroy:()=>destroyed.push(id)});
 renderer.objects=new Map([['alive',{uniform:handle('live-u'),texture:handle('live-t')}],['dead',{uniform:handle('dead-u'),texture:handle('dead-t') }]]);
 const box={kind:'box'},sphere={kind:'sphere'};
 renderer.meshes=new Map([[primitiveKey(box),{vertex:handle('box-v'),color:handle('box-c'),index:handle('box-i')}],[primitiveKey(sphere),{vertex:handle('sphere-v'),color:handle('sphere-c'),index:handle('sphere-i') }]]);
 renderer.collect({entities:new Map([['alive',{id:'alive',mesh:box,material:{color:[1,1,1,1]}}]])});
 assert.deepEqual(destroyed,['dead-u','dead-t','sphere-v','sphere-c','sphere-i']);assert.equal(renderer.meshes.size,1);assert.equal(renderer.objects.size,1);
 renderer.collect({entities:new Map()});assert.equal(renderer.objects.size,0);assert.equal(renderer.meshes.size,0);assert.equal(destroyed.length,10);
});


test('built-in systems run at declared cadence without losing simulated time',()=>{
 const scene=new Scene({version:1,entities:[]}),counts=new Map();
 for(let i=0;i<60;i++){
  scene.step(1/60);
  for(const id of scene.lastExecution)counts.set(id,(counts.get(id)??0)+1);
 }
 assert.equal(counts.get('engine:weather'),10);
 assert.equal(counts.get('engine:surfaces'),30);
 assert.equal(counts.get('engine:animation'),60);
 assert.equal(counts.get('engine:physics'),60);
 assert.equal(counts.get('engine:deformation'),60);
 assert.equal(counts.get('engine:cleanup'),10);
 assert.equal(counts.get('engine:clock'),60);
 assert.ok(Math.abs(scene.time-1)<1e-12);
});

test('aggregate and dormant tiers skip expensive local simulation but keep world time',()=>{
 const spec={version:1,gravity:[0,0,0],ground:-100,entities:[
  {id:'body',position:[0,1,0],mesh:{kind:'box',size:[1,1,1]},body:{mass:1,velocity:[3,0,0]}},
  {id:'road',position:[0,-.1,0],mesh:{kind:'box',size:[10,.2,6]},material:{kind:'asphalt'},environmental:{surfaceUse:'road'}},
 ]};
 const aggregate=new Scene(spec),start=aggregate.entities.get('body').position[0];let surfaceRuns=0;
 for(let i=0;i<60;i++){aggregate.step(1/60,'aggregate');if(aggregate.lastExecution.includes('engine:surfaces'))surfaceRuns++;}
 assert.equal(aggregate.entities.get('body').position[0],start,'aggregate tier must not run rigid-body integration');
 assert.equal(surfaceRuns,30,'aggregate tier keeps coarse environmental evolution');
 assert.ok(Math.abs(aggregate.time-1)<1e-12);

 const dormant=new Scene(spec);let expensive=0;
 for(let i=0;i<60;i++){dormant.step(1/60,'dormant');if(dormant.lastExecution.some(id=>['engine:surfaces','engine:animation','engine:physics','engine:deformation','engine:surface-contacts'].includes(id)))expensive++;}
 assert.equal(expensive,0);
 assert.equal(dormant.entities.get('body').position[0],start);
 assert.ok(Math.abs(dormant.time-1)<1e-12);
});
