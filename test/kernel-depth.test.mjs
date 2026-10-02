import test from 'node:test';
import assert from 'node:assert/strict';
import {DepthVariantRegistry,ENGINE_DEPTH,ENGINE_DEPTH_AXES,ENGINE_DOMAINS,ENGINE_SLOTS,EngineKernel,Scene,simulationProfile} from '../dist/index.js';

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
 coarse.setSimulationProfile({defaultDepth:ENGINE_DEPTH.dormant,axes:{physics:128}});
 full.setSimulationProfile({defaultDepth:ENGINE_DEPTH.dormant,axes:{physics:ENGINE_DEPTH.active}});
 const coarseBuilds=coarse.kernel.diagnostics.compileBuilds,fullBuilds=full.kernel.diagnostics.compileBuilds;
 for(let i=0;i<ticks;i++)coarse.step(1/60);
 for(let i=0;i<ticks;i++)full.step(1/60);
 assert.equal(coarse.kernel.diagnostics.compileBuilds,coarseBuilds,'steady-state stepping must execute the precompiled program directly');
 assert.equal(full.kernel.diagnostics.compileBuilds,fullBuilds,'steady-state stepping must execute the precompiled program directly');
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


test('one depth variant compiler serves physics render audio network world and economics slots',()=>{
 const registry=new DepthVariantRegistry();
 registry.usePlugin({id:'fixture.multi-domain',variants:[
  {id:'physics.aggregate',slot:ENGINE_SLOTS.physicsStep,depth:{axis:ENGINE_DOMAINS.physics,min:64,max:159},value:'physics-aggregate'},
  {id:'physics.full',slot:ENGINE_SLOTS.physicsStep,depth:{axis:ENGINE_DOMAINS.physics,min:160},value:'physics-full'},
  {id:'render.proxy',slot:ENGINE_SLOTS.renderFrame,depth:{axis:ENGINE_DOMAINS.render,min:64,max:159},value:'render-proxy'},
  {id:'render.full',slot:ENGINE_SLOTS.renderFrame,depth:{axis:ENGINE_DOMAINS.render,min:160},value:'render-full'},
  {id:'audio.events',slot:ENGINE_SLOTS.audioMix,depth:{axis:ENGINE_DOMAINS.audio,min:64},value:'audio-events'},
  {id:'network.aggregate',slot:ENGINE_SLOTS.networkProject,depth:{axis:ENGINE_DOMAINS.network,min:64,max:159},value:'network-aggregate'},
  {id:'network.full',slot:ENGINE_SLOTS.networkProject,depth:{axis:ENGINE_DOMAINS.network,min:160},value:'network-full'},
  {id:'world.tiles',slot:ENGINE_SLOTS.worldMaterialize,depth:{axis:ENGINE_DOMAINS.world,min:64},value:'world-tiles'},
  {id:'economics.aggregate',slot:ENGINE_SLOTS.economicsSimulate,depth:{axis:ENGINE_DOMAINS.economics,min:64},value:'economics-aggregate'},
 ]});
 const compiled=registry.compile({defaultDepth:0,axes:{physics:255,render:96,audio:64,network:160,world:64,economics:64}});
 assert.equal(compiled.require(ENGINE_SLOTS.physicsStep),'physics-full');
 assert.equal(compiled.require(ENGINE_SLOTS.renderFrame),'render-proxy');
 assert.equal(compiled.require(ENGINE_SLOTS.audioMix),'audio-events');
 assert.equal(compiled.require(ENGINE_SLOTS.networkProject),'network-full');
 assert.equal(compiled.require(ENGINE_SLOTS.worldMaterialize),'world-tiles');
 assert.equal(compiled.require(ENGINE_SLOTS.economicsSimulate),'economics-aggregate');
 assert.equal(registry.compile({axes:{audio:64,economics:64,network:160,physics:255,render:96,world:64},defaultDepth:0}),compiled,'profile key must be canonical across axis insertion order');
});


test('a physics plugin replaces the compiled physics slot without owning a second pose',()=>{
 const scene=new Scene({version:1,gravity:[0,-9.81,0],ground:-100,entities:[
  {id:'ball',position:[0,10,0],mesh:{kind:'sphere',radius:.5},body:{mass:1}},
 ]});
 let pluginSteps=0;
 scene.usePlugin({
  id:'fixture.physics-plugin',
  systems:[{id:'fixture.physics-plugin.step',run:(host,frame)=>{pluginSteps++;host.physics.step(frame.dt);}}],
  modules:[{
   id:'fixture:physics:rocket-like',slot:ENGINE_SLOTS.physicsStep,phase:'simulate',rateHz:60,
   reads:['surface-state','animation'],writes:['entities','contacts'],after:[ENGINE_SLOTS.agentsSimulate],
   depth:{axis:'physics',min:200},context:'none',
   run:(_context,frame)=>[{type:'system',action:'fixture.physics-plugin.step',deltaSeconds:frame.deltaSeconds}],
  }],
 });
 const body=scene.entities.get('ball').body,identity=body;
 scene.step(1/60,{defaultDepth:0,axes:{physics:220}});
 assert.equal(pluginSteps,1);
 assert.equal(scene.physics.steps,1);
 assert.equal(scene.entities.get('ball').body,identity,'plugin must operate on the authoritative Scene body');
 assert.ok(scene.lastExecution.includes('fixture:physics:rocket-like'));
 assert.ok(!scene.lastExecution.includes('engine:physics'),'compiled slot must contain exactly one physics implementation');
 assert.ok(body.position[1]<10);
});


test('canonical domains are the exact built-in depth axes',()=>{
 assert.equal(ENGINE_DEPTH_AXES,ENGINE_DOMAINS);
 assert.equal(ENGINE_DEPTH_AXES.economics,'economics');
 assert.equal(ENGINE_SLOTS.physicsStep,'physics.step');
});


test('aggregate destruction preserves fracture outcome without materializing debris',()=>{
 const run=destruction=>{
  const scene=new Scene({
   version:1,gravity:[0,0,0],ground:-100,
   entities:[
    {id:'glass',position:[0,1,0],mesh:{kind:'box',size:[.01,1.4,1.2]},material:{kind:'glass'}},
    {id:'ball',position:[-1,1,0],mesh:{kind:'sphere',radius:.11},material:{kind:'steel'},body:{mass:3.8,velocity:[30,0,0]}},
   ],
  });
  scene.setSimulationProfile({defaultDepth:ENGINE_DEPTH.dormant,axes:{physics:ENGINE_DEPTH.active,destruction}});
  const events=[];for(let i=0;i<30;i++){scene.step(1/60);events.push(...scene.drainEvents());}
  return{scene,fracture:events.find(event=>event.type==='fracture'),shards:[...scene.entities.keys()].filter(id=>id.startsWith('glass:shard:'))};
 };
 const aggregate=run(ENGINE_DEPTH.aggregate),full=run(ENGINE_DEPTH.active);
 assert.equal(aggregate.scene.entities.has('glass'),false,'aggregate LOD must preserve the broken/not-broken outcome');
 assert.ok(aggregate.fracture,'aggregate LOD must preserve the fracture event');
 assert.equal(aggregate.fracture.shardCount,0,'aggregate LOD must not materialize debris');
 assert.equal(aggregate.shards.length,0);
 assert.equal(full.scene.entities.has('glass'),false);
 assert.ok(full.fracture&&full.fracture.shardCount>0,'full destruction must materialize fracture detail');
 assert.ok(full.shards.length>=10);
});

test('aggregate agents select a lower-cadence implementation in the same ownership slot',()=>{
 const scene=new Scene({version:1,gravity:[0,0,0],entities:[]});
 const aggregate=scene.kernel.compile({defaultDepth:0,axes:{agents:ENGINE_DEPTH.aggregate}});
 const full=scene.kernel.compile({defaultDepth:0,axes:{agents:ENGINE_DEPTH.active}});
 assert.ok(aggregate.selectedModules.some(module=>module.id==='engine:animation.aggregate'));
 assert.ok(!aggregate.selectedModules.some(module=>module.id==='engine:animation'));
 assert.ok(full.selectedModules.some(module=>module.id==='engine:animation'));
 assert.ok(!full.selectedModules.some(module=>module.id==='engine:animation.aggregate'));
});
