import test from 'node:test';
import assert from 'node:assert/strict';
import {ENGINE_DEPTH,EngineKernel,Scene,simulationProfile} from '../dist/index.js';

test('kernel compiles plugin variants and depth decisions out of the hot path',()=>{
 const calls=[],kernel=new EngineKernel(60);
 kernel.use({
  id:'physics.full',slot:'physics',phase:'simulate',rateHz:60,reads:[],writes:['physics'],
  depth:{axis:'physics',min:ENGINE_DEPTH.active},
  run:()=>{calls.push('full');},
 });
 kernel.usePlugin({id:'fixture.rocket-league',modules:[
  {
   id:'physics.aggregate.rl',slot:'physics',phase:'simulate',rateHz:30,reads:[],writes:['physics'],
   depth:{axis:'physics',min:ENGINE_DEPTH.aggregate,max:ENGINE_DEPTH.active-1},
   run:()=>{calls.push('aggregate');},
  },
  {
   id:'rules.rl',phase:'plan',rateHz:60,reads:[],writes:['rules'],
   depth:{axis:'physics',min:ENGINE_DEPTH.aggregate},
   run:()=>{calls.push('rules');},
  },
 ]});
 const shallowProfile={defaultDepth:ENGINE_DEPTH.dormant,axes:{physics:96}};
 const shallow=kernel.compile(shallowProfile),same=kernel.compile({axes:{physics:96},defaultDepth:0});
 assert.equal(shallow,same,'equivalent profiles must reuse one immutable compiled program');
 assert.deepEqual(shallow.selectedModules.map(m=>m.id).sort(),['physics.aggregate.rl','rules.rl']);
 shallow.run(2,{});assert.deepEqual(calls,['rules','aggregate']);
 calls.length=0;
 const deep=kernel.compile({defaultDepth:0,axes:{physics:ENGINE_DEPTH.detailed}});
 assert.deepEqual(deep.selectedModules.map(m=>m.id).sort(),['physics.full','rules.rl']);
 deep.run(2,{});assert.deepEqual(calls,['rules','full']);
 assert.equal(kernel.diagnostics.plugins,1);
 assert.ok(kernel.diagnostics.compiledPrograms>=2);
});

test('depth axes are independent: detailed physics can run with dormant agents',()=>{
 const spec={version:1,gravity:[0,-9.81,0],ground:-100,entities:[
  {id:'probe',position:[0,10,0],mesh:{kind:'sphere',radius:.5},body:{mass:1}},
 ]};
 const physicsOnly=new Scene(spec),frozen=new Scene(spec);
 const y0=physicsOnly.entities.get('probe').position[1];
 physicsOnly.step(1/60,{defaultDepth:ENGINE_DEPTH.dormant,axes:{physics:ENGINE_DEPTH.detailed,agents:ENGINE_DEPTH.dormant}});
 frozen.step(1/60,{defaultDepth:ENGINE_DEPTH.dormant,axes:{physics:ENGINE_DEPTH.dormant,agents:ENGINE_DEPTH.detailed}});
 assert.ok(physicsOnly.entities.get('probe').position[1]<y0,'physics axis must advance the body independently');
 assert.equal(frozen.entities.get('probe').position[1],y0,'dormant physics must not advance even when agents are detailed');
 assert.ok(physicsOnly.lastExecution.includes('engine:physics'));
 assert.ok(!physicsOnly.lastExecution.includes('engine:animation'));
 assert.ok(frozen.lastExecution.includes('engine:animation'));
 assert.ok(!frozen.lastExecution.includes('engine:physics'));
});

test('physics depth selects a lower-cadence solver variant without a hot-path branch',()=>{
 const make=()=>new Scene({version:1,gravity:[0,-9.81,0],ground:-100,entities:[
  {id:'ball',position:[0,10,0],mesh:{kind:'sphere',radius:.5},body:{mass:1}},
 ]});
 const coarse=make(),full=make(),ticks=60;
 for(let i=0;i<ticks;i++)coarse.step(1/60,{defaultDepth:ENGINE_DEPTH.dormant,axes:{physics:128}});
 for(let i=0;i<ticks;i++)full.step(1/60,{defaultDepth:ENGINE_DEPTH.dormant,axes:{physics:ENGINE_DEPTH.active}});
 assert.equal(coarse.physics.steps,30,'coarse slot variant must execute at 30 Hz');
 assert.equal(full.physics.steps,60,'full slot variant must execute at 60 Hz');
 assert.ok(coarse.lastExecution.includes('engine:physics.coarse'));
 assert.ok(full.lastExecution.includes('engine:physics'));
 const expected=(h)=>10+.5*(-9.81)*1*(1+h);
 assert.ok(Math.abs(coarse.entities.get('ball').position[1]-expected(1/30))<1e-9,{actual:coarse.entities.get('ball').position[1],expected:expected(1/30)});
 assert.ok(Math.abs(full.entities.get('ball').position[1]-expected(1/60))<1e-9,{actual:full.entities.get('ball').position[1],expected:expected(1/60)});
 assert.ok(coarse.entities.get('ball').position[1]<full.entities.get('ball').position[1],'coarser symplectic Euler must expose its larger known trajectory defect');
});

test('scene plugins flatten into the same compiled kernel program',()=>{
 const scene=new Scene({version:1,gravity:[0,0,0],entities:[{id:'ball',position:[0,0,0],mesh:{kind:'sphere',radius:.5},body:{mass:1}}]});
 scene.usePlugin({id:'fixture.rules',modules:[{
  id:'fixture:rules:velocity',phase:'plan',rateHz:60,reads:[],writes:['commands'],
  depth:{axis:'physics',min:ENGINE_DEPTH.active},
  run:()=>[{type:'velocity',id:'ball',value:[3,0,0]}],
 }]});
 scene.step(1/60,{defaultDepth:ENGINE_DEPTH.dormant,axes:{physics:ENGINE_DEPTH.detailed}});
 assert.deepEqual(scene.entities.get('ball').body.velocity,[3,0,0]);
 assert.ok(scene.lastExecution.includes('fixture:rules:velocity'));
});

test('legacy tiers normalize to stable depth profiles',()=>{
 assert.deepEqual(simulationProfile('dormant'),{defaultDepth:0,axes:{}});
 assert.deepEqual(simulationProfile('aggregate'),{defaultDepth:64,axes:{}});
 assert.deepEqual(simulationProfile('active'),{defaultDepth:160,axes:{}});
 assert.deepEqual(simulationProfile('detailed'),{defaultDepth:255,axes:{}});
});
