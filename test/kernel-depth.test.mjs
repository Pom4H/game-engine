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
