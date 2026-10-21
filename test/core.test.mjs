import test from 'node:test';
import assert from 'node:assert/strict';
import {FixedClock,SpatialHash,EngineKernel,Scene,encodeScene,decodeScene,renderAudio,fracturePlate,deriveSurfaceState,resolveEnvironment,resolveEnvironmentAt,environmentHistorySteps,material,validateScene} from '../dist/index.js';

test('fixed clock keeps delayed time as bounded debt',()=>{
  const clock=new FixedClock(10,100,4);let steps=0;clock.reset(0);
  assert.equal(clock.advance(35,()=>steps++),3);assert.equal(steps,3);
  assert.equal(clock.advance(45,()=>steps++),1);assert.equal(steps,4);
});

test('spatial hash deduplicates multi-cell members',()=>{
  const index=new SpatialHash(10),item={x:10,z:10,w:20,l:20};index.add(item,15);
  assert.deepEqual(index.near(10,10,20),[item]);
});

test('kernel order is stable and cadence is exact',()=>{
  const kernel=new EngineKernel(60);const calls=[];
  kernel.use({id:'b',phase:'simulate',rateHz:30,reads:[],writes:['b'],run:()=>{calls.push('b');}});
  kernel.use({id:'a',phase:'simulate',rateHz:60,reads:[],writes:['a'],run:()=>{calls.push('a');}});
  kernel.run(1,{});assert.deepEqual(calls,['a']);calls.length=0;kernel.run(2,{});assert.deepEqual(calls,['a','b']);
});

test('reflection probe authoring binds to scene entities without semantic renderer knowledge',()=>{
  const spec={version:1,entities:[{id:'hero',mesh:{kind:'box'}},{id:'ground',mesh:{kind:'box'}}],rendering:{reflectionProbe:{entity:'hero',offset:[0,1,0],radius:30,exclude:['hero'],facesPerFrame:1}}};
  const valid=validateScene(spec);assert.equal(valid.rendering.reflectionProbe.entity,'hero');
  assert.throws(()=>validateScene({...spec,rendering:{reflectionProbe:{entity:'missing'}}}),/references missing entity/);
  assert.throws(()=>validateScene({...spec,rendering:{reflectionProbe:{entity:'hero',position:[0,0,0]}}}),/exactly one/);
  assert.throws(()=>validateScene({...spec,rendering:{reflectionProbe:{entity:'hero',facesPerFrame:1.5}}}),/must be integer/);
});

test('scene physics is deterministic across equal runs',()=>{
  const spec={version:1,entities:[{id:'ball',position:[0,3,0],mesh:{kind:'sphere',radius:.5},body:{mass:1,restitution:.5}}]};
  const a=new Scene(spec),b=new Scene(spec);for(let i=0;i<180;i++){a.step(1/60);b.step(1/60);}assert.deepEqual(a.snapshot(),b.snapshot());assert.ok(a.entities.get('ball').position[1]>=.5-1e-6);
});

test('scene URL codec round-trips unicode ids',()=>{
  const scene={version:1,entities:[{id:'машина',position:[1,2,3],mesh:{kind:'box'}}]};assert.deepEqual(decodeScene(encodeScene(scene)),scene);
});


test('high-detail render mesh never changes physical mass or collision source',()=>{
  const scene=new Scene({version:1,gravity:[0,0,0],entities:[{
    id:'visual-split',
    mesh:{kind:'box',size:[1,1,1]},
    renderMesh:{kind:'box',size:[40,12,8]},
    material:{kind:'steel'},
    body:{velocity:[1,0,0]},
  }]});
  const entity=scene.entities.get('visual-split');
  assert.equal(entity.mesh.kind,'box');
  assert.equal(entity.renderMesh.kind,'box');
  assert.deepEqual(entity.mesh.size,[1,1,1]);
  assert.deepEqual(entity.renderMesh.size,[40,12,8]);
  assert.ok(Math.abs(entity.body.mass-7850)<1e-6,`physics mass must come from the 1 m³ proxy, got ${entity.body.mass}`);
});

test('render mesh is validated with the same geometry rules as physical mesh',()=>{
  assert.throws(()=>new Scene({version:1,entities:[{
    id:'bad-visual',
    mesh:{kind:'box',size:[1,1,1]},
    renderMesh:{kind:'triangle-mesh',positions:[0,0,0],normals:[0,1,0],indices:[0,1,2]},
  }]}),/bad-visual\.renderMesh/);
});


function fireAtGlass(thickness,speed=30){
  const scene=new Scene({
    version:1,gravity:[0,0,0],
    entities:[
      {id:'glass',position:[0,1,0],mesh:{kind:'box',size:[thickness,1.4,1.2]},material:{kind:'glass'}},
      {id:'ball',position:[-1,1,0],mesh:{kind:'sphere',radius:.11},material:{kind:'steel'},body:{mass:3.8,velocity:[speed,0,0]}},
    ],
  });
  const events=[];for(let i=0;i<30;i++){scene.step(1/60);events.push(...scene.drainEvents());}
  return{scene,events};
}

test('material physics decides penetration vs rebound from glass thickness',()=>{
  const thin=fireAtGlass(.01),thick=fireAtGlass(.20);
  assert.equal(thin.scene.entities.has('glass'),false,'10 mm glass should fracture under this impact');
  assert.ok(thin.events.some(event=>event.type==='fracture'));
  assert.equal(thick.scene.entities.has('glass'),true,'200 mm glass should survive the same impact');
  assert.ok(thick.scene.entities.get('ball').body.velocity[0]<0,'surviving glass should return collision impulse to the ball');
});

test('fracture creates engine-owned shards and procedural audio',()=>{
  const {scene,events}=fireAtGlass(.01);
  const shards=[...scene.entities.keys()].filter(id=>id.startsWith('glass:shard:'));
  assert.ok(shards.length>=10);
  const audio=renderAudio(events,.5);
  let peak=0;for(const sample of audio.left)peak=Math.max(peak,Math.abs(sample));
  assert.ok(peak>.01,'fracture events should synthesize audible output');
});


test('glass crack topology is deterministic and conserves plate area',()=>{
  const input={width:1.5,height:2,thickness:.01,impact:[.12,-.18],energyRatio:4.2,seed:123456};
  const a=fracturePlate(input),b=fracturePlate(input);
  assert.deepEqual(a,b);
  assert.ok(a.radialRays>=6&&a.rings>=2);
  assert.ok(a.fragments.length>=10);
  const area=a.fragments.reduce((sum,fragment)=>sum+fragment.area,0);
  assert.ok(Math.abs(area-3)<1e-6,`fragment area ${area} must conserve the 3 m² source plate`);
});

test('glass runtime uses exact polygon-prism fragments',()=>{
  const {scene}=fireAtGlass(.01);
  const shards=[...scene.entities.values()].filter(entity=>entity.id.startsWith('glass:shard:'));
  assert.ok(shards.length>=10);
  assert.ok(shards.every(entity=>entity.mesh?.kind==='polygon-prism'));
  const mass=shards.reduce((sum,entity)=>sum+(entity.body?.mass??0),0);
  assert.ok(Math.abs(mass-2500*.01*1.4*1.2)<.05,`fragment mass ${mass} should conserve glass mass`);
});


test('rotating debris settles on an explicit concrete surface',()=>{
  const scene=new Scene({
    version:1,
    gravity:[0,-9.81,0],
    ground:-100,
    entities:[
      {id:'floor',position:[0,-.1,0],mesh:{kind:'box',size:[10,.2,10]},material:{kind:'concrete'}},
      {id:'shard',position:[0,1.2,0],rotation:[.7,.4,.25],mesh:{kind:'box',size:[.28,.018,.2]},material:{kind:'glass'},body:{mass:.18,velocity:[.8,-.2,.35],angularVelocity:[9,7,11]}},
    ],
  });
  const shard=scene.entities.get('shard');
  shard.body.fracturable=false;
  shard.body.collisionClass='debris';
  const events=[],samples=[];
  for(let i=0;i<720;i++){scene.step(1/60);events.push(...scene.drainEvents());if((i+1)%120===0)samples.push({t:(i+1)/60,pos:[...shard.position],v:Math.hypot(...shard.body.velocity),w:Math.hypot(...shard.body.angularVelocity),sleep:shard.body.sleepTimer});}
  assert.equal(shard.body.sleeping,true,`debris should eventually enter rest state on concrete: samples=${JSON.stringify(samples)} pos=${JSON.stringify(shard.position)} v=${JSON.stringify(shard.body.velocity)} w=${JSON.stringify(shard.body.angularVelocity)} sleepTimer=${shard.body.sleepTimer}`);
  assert.deepEqual(shard.body.velocity,[0,0,0]);
  assert.deepEqual(shard.body.angularVelocity,[0,0,0]);
  assert.ok(events.some(event=>event.type==='impact'&&event.materialA==='glass'&&event.materialB==='concrete'),'contact acoustics should see glass ↔ concrete');
});


test('environment derives concrete moss without renderer controls',()=>{
  const concrete=material('concrete');
  const dry=deriveSurfaceState(concrete,{finish:'rough',ageYears:12,treatment:'none'},resolveEnvironment({humidity:.28,temperatureC:24,precipitation:'rare',sunlight:.9,groundMoisture:.15}));
  const humid=deriveSurfaceState(concrete,{finish:'rough',ageYears:12,treatment:'none'},resolveEnvironment({humidity:.9,temperatureC:13,precipitation:'frequent',sunlight:.28,groundMoisture:.82}));
  const protectedSurface=deriveSurfaceState(concrete,{finish:'rough',ageYears:12,treatment:'biocide'},resolveEnvironment({humidity:.9,temperatureC:13,precipitation:'frequent',sunlight:.28,groundMoisture:.82}));
  assert.ok(humid.wetness>dry.wetness);
  assert.ok(humid.moss>.25,`humid aged concrete should grow moss, got ${humid.moss}`);
  assert.ok(humid.moss>dry.moss*3);
  assert.ok(protectedSurface.moss<humid.moss*.2,'biocide is a semantic cause that suppresses moss');
  assert.ok(humid.frictionScale<dry.frictionScale,'wet/mossy concrete should alter contact friction');
});


test('weather timeline moves from freezing night to thawing day',()=>{
  const environment={
    clock:{startHour:2,hoursPerSecond:.3},
    weather:[
      {hour:2,temperatureC:-10,snowfall:'heavy',sunlight:0},
      {hour:7.4,temperatureC:0,snowfall:'moderate',sunlight:.18},
      {hour:13,temperatureC:4,snowfall:'none',sunlight:.88},
    ],
  };
  const night=resolveEnvironmentAt(environment,0),morning=resolveEnvironmentAt(environment,18),day=resolveEnvironmentAt(environment,36.6666667);
  assert.equal(night.temperatureC,-10);assert.equal(night.snowfall,'heavy');assert.equal(night.sunlight,0);
  assert.ok(Math.abs(morning.temperatureC)<1e-6);assert.equal(morning.snowfall,'moderate');assert.ok(morning.sunlight>.1);
  assert.ok(day.temperatureC>3.9);assert.equal(day.snowfall,'none');assert.ok(day.sunlight>.8);
});

test('finite weather history integrates before t=0 with adaptive phase steps',()=>{
  const environment={
    temperatureC:-3,snowfall:'none',clock:{startHour:12,hoursPerSecond:0},
    history:[
      {hoursAgo:48,temperatureC:-10,snowfall:'moderate',sunlight:.05},
      {hoursAgo:45,snowfall:'none'},
      {hoursAgo:10,temperatureC:.8,sunlight:.55},
      {hoursAgo:6,temperatureC:-6,sunlight:.03},
    ],
  };
  const steps=environmentHistorySteps(environment);
  assert.ok(steps.length>20);
  assert.ok(steps.some(step=>step.durationSeconds===600),'snowfall/freeze-thaw intervals should refine to ten-minute steps');
  assert.ok(Math.abs(steps.reduce((sum,step)=>sum+step.durationSeconds,0)-48*3600)<1e-6);
  assert.ok(steps[0].hoursAgo>steps.at(-1).hoursAgo);
  assert.throws(()=>validateScene({version:1,environment:{history:[{hoursAgo:24},{hoursAgo:24}]},entities:[]}),/duplicated/);
});

test('weather history emerges as layered snowpack rather than authored snow type',()=>{
  const scene=new Scene({
    version:1,ground:-100,
    environment:{
      temperatureC:-3,snowfall:'none',sunlight:.15,humidity:.72,clock:{startHour:8,hoursPerSecond:0},
      history:[
        {hoursAgo:36,temperatureC:-9,snowfall:'moderate',sunlight:.04,wind:[2.5,0,.4]},
        {hoursAgo:33.5,snowfall:'none',temperatureC:-7},
        {hoursAgo:12,temperatureC:.65,sunlight:.42},
        {hoursAgo:8,temperatureC:-7,sunlight:.02},
        {hoursAgo:3,temperatureC:-8,snowfall:'light',wind:[1.2,0,.2]},
        {hoursAgo:1.5,snowfall:'none'},
      ],
    },
    entities:[{id:'snow-ground',position:[0,-.05,0],mesh:{kind:'box',size:[6,.1,4]},material:{kind:'concrete'},environmental:{surfaceUse:'sidewalk'}}],
  });
  const pack=scene.surfaces.surface('snow-ground').snowpack;
  assert.ok(pack.layers.length>=2,`expected old+fresh layers, got ${JSON.stringify(pack)}`);
  assert.ok(pack.freshness>.35,'recent snowfall should remain optically fresh');
  assert.ok(pack.grainSizeMm>.2,'older layer metamorphism should increase aggregate grain size');
  assert.ok(pack.crust>0,'thaw followed by refreeze should leave a measurable crust signal');
  assert.ok(['fresh-dry','wind-packed','settled','compacted','wet','slush','crust','granular','dirty-road'].includes(pack.classification));
});

test('snow and meltwater initialize as slush before the first simulation tick',()=>{
  const scene=new Scene({
    version:1,ground:-100,environment:{temperatureC:-.35,snowfall:'none',sunlight:.8},
    entities:[{id:'road',position:[0,-.05,0],mesh:{kind:'box',size:[20,.1,7]},material:{kind:'asphalt'},environmental:{surfaceUse:'road',snowDepthM:.0048,waterDepthM:.0016,iceDepthM:.00018}}],
  });
  const state=scene.surfaces.sample('road',0,0);
  assert.ok(state.slush>.20,{slush:state.slush});
  assert.ok(state.wetness>.5,{wetness:state.wetness});
  assert.ok(state.puddle>.15,{puddle:state.puddle});
});

test('traffic turns road snow into dirty slush while sidewalk keeps snow',()=>{
  const scene=new Scene({
    version:1,ground:-100,
    environment:{
      humidity:.88,groundMoisture:.7,clock:{startHour:2,hoursPerSecond:.3},
      weather:[
        {hour:2,temperatureC:-10,snowfall:'heavy',sunlight:0,wind:[2,0,.5]},
        {hour:7.4,temperatureC:0,snowfall:'moderate',sunlight:.18,wind:[1,0,.2]},
        {hour:13,temperatureC:4,snowfall:'none',sunlight:.88,wind:[1,0,0]},
      ],
    },
    entities:[
      {id:'road',position:[0,-.1,0],mesh:{kind:'box',size:[80,.2,8]},material:{kind:'asphalt'},environmental:{surfaceUse:'road'}},
      {id:'sidewalk',position:[0,.08,5.5],mesh:{kind:'box',size:[80,.16,3]},material:{kind:'concrete'},environmental:{surfaceUse:'sidewalk'}},
      {id:'curb',position:[0,.16,4.15],mesh:{kind:'box',size:[80,.32,.35]},material:{kind:'concrete'},environmental:{surfaceUse:'curb'}},
      {id:'traffic',position:[-18,.65,0],mesh:{kind:'box',size:[4.5,1.3,1.9]},material:{kind:'steel'},body:{motion:'kinematic',mass:1500,velocity:[8,0,0]}},
    ],
  });
  for(let i=0;i<360;i++)scene.step(1/60);
  const road=scene.surfaces.surface('road'),sidewalk=scene.surfaces.surface('sidewalk'),body=scene.surfaces.body('traffic');
  assert.ok(road&&sidewalk&&body);
  assert.ok(scene.surfaces.sample('road',0,0).trackMelt>0,'contacted cells retain thermal history');
  assert.equal(scene.surfaces.sample('road',0,3.5).trackMelt,0,'off-path cells receive no traffic work');
  assert.ok(scene.surfaces.sample('road',0,0).slush>0,'contacted cells contain local slush during subzero snowfall');
  const deformation=scene.surfaces.field('road').deformation.cells;
  assert.ok(Math.min(...deformation.map(cell=>cell.displacementM))<-.0001,'contact must create a negative rut');
  assert.ok(Math.max(...deformation.map(cell=>cell.displacementM))>.00005,'displaced material must create a positive rim');
  assert.ok(deformation.some(cell=>cell.compaction>0),'contact must persist compaction history');
  assert.ok(sidewalk.snowDepthM>road.snowDepthM,'untouched sidewalk should retain more fresh snow than trafficked asphalt');
  assert.ok(body.snowCoverage>.05,'snowfall should adhere to moving bodies');
  assert.ok(body.rearSnow>.05,'wake/spray should accumulate snow on rear-facing body surfaces');
  assert.ok([...scene.entities.keys()].some(id=>id.startsWith('__surface:snowdrift:curb:')),'curb snow mass should generate snowdrift geometry');

  const nightSnow=road.snowDepthM;
  for(let i=0;i<2100;i++)scene.step(1/60);
  const dayRoad=scene.surfaces.surface('road');
  assert.ok(scene.environment.temperatureC>2.5&&scene.environment.sunlight>.7,'timeline should reach a sunny above-freezing day');
  assert.ok(dayRoad.temperatureC>0,'asphalt surface should thaw above zero');
  assert.ok(dayRoad.snowDepthM<nightSnow,'daytime energy balance should melt accumulated road snow');
  assert.ok(dayRoad.waterDepthM>0||dayRoad.puddle>.02,'melted snow should create water/puddle state');
});


test('material ontology owns mechanical thermal optical and acoustic causes',()=>{
  const glass=material('glass'),steel=material('steel'),asphalt=material('asphalt'),concrete=material('concrete');
  const rubber=material('rubber'),plastic=material('plastic'),aluminum=material('aluminum'),mirror=material('mirror');
  assert.equal(glass.mechanical.brittle,true);
  assert.ok(glass.optical.transmission>.8&&glass.optical.ior>1);
  assert.ok(steel.optical.metalness>.8);
  assert.ok(rubber.friction>.9&&rubber.acoustic.damping>.7,'tyre rubber must be high-grip and strongly damped');
  assert.ok(plastic.mechanical.plasticity>.4&&!plastic.mechanical.brittle,'automotive plastic trim must deform without glass-like fracture');
  assert.ok(aluminum.density<steel.density&&aluminum.optical.metalness>.9,'wheel aluminum must stay light and metallic');
  assert.ok(mirror.mechanical.brittle&&mirror.optical.metalness>.9&&mirror.optical.roughness<.08,'mirror must couple brittle failure with reflective optics');
  assert.ok(asphalt.thermal.solarAbsorptivity>concrete.thermal.solarAbsorptivity);
  assert.ok(asphalt.thermal.specificHeatJkgK>0&&concrete.thermal.conductivityWmK>0);
  assert.equal('brittle' in glass,false,'legacy mechanical fields must not live at the material root');
  assert.equal('failureStressPa' in glass,false);
});

test('evolving surface state is the shared render physics and acoustic projection',()=>{
  const scene=new Scene({
    version:1,ground:-100,
    environment:{temperatureC:-1,snowfall:'none',sunlight:.35,humidity:.82,groundMoisture:.75,precipitation:'frequent'},
    entities:[
      {id:'road',position:[0,-.1,0],mesh:{kind:'box',size:[18,.2,6]},material:{kind:'asphalt'},environmental:{surfaceUse:'road',waterDepthM:.003}},
      {id:'traffic',position:[-4,.65,0],mesh:{kind:'box',size:[4.5,1.3,1.9]},material:{kind:'steel'},body:{motion:'kinematic',mass:1500,velocity:[6,0,0]}},
    ],
  });
  const authored=scene.entities.get('road').material.surface;
  for(let i=0;i<75;i++)scene.step(1/60);
  const live=scene.surfaces.surface('road'),contact=scene.surfaces.sample('road',0,0);
  assert.ok(live&&contact);
  assert.ok(contact.dirt>authored.dirt,'contact work must evolve dirt beyond the authored baseline');
  assert.ok(contact.wetness>=authored.wetness,'water phase must project into wetness');
  assert.ok(contact.acousticDamping>=material('asphalt').acoustic.damping,'wet contact must damp the same acoustic state consumed by events');
  assert.ok(contact.roughness>=.02&&contact.roughness<=1);
  assert.ok(contact.frictionScale<authored.frictionScale,'water/phase state must reduce effective friction from the same surface record');
});

test('thermal response comes from material profile rather than a renderer/material-name branch',()=>{
  const scene=new Scene({
    version:1,ground:-100,
    environment:{temperatureC:0,snowfall:'none',sunlight:1,humidity:.2,groundMoisture:.1,precipitation:'arid'},
    entities:[
      {id:'asphalt',position:[-3,-.1,0],mesh:{kind:'box',size:[4,.2,4]},material:{kind:'asphalt'},environmental:{surfaceUse:'generic'}},
      {id:'concrete',position:[3,-.1,0],mesh:{kind:'box',size:[4,.2,4]},material:{kind:'concrete'},environmental:{surfaceUse:'generic'}},
    ],
  });
  for(let i=0;i<600;i++)scene.step(1/60);
  const asphalt=scene.surfaces.surface('asphalt'),concrete=scene.surfaces.surface('concrete');
  assert.ok(asphalt.temperatureC>concrete.temperatureC, `expected dark high-absorptivity asphalt to warm more: ${asphalt.temperatureC} <= ${concrete.temperatureC}`);
});
