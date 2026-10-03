import test from 'node:test';
import assert from 'node:assert/strict';
import {Scene} from '../dist/index.js';
import {CAUSAL_RENDER_CONTRACT_VERSION,MemoryContentStore,defineCausalRenderObservation} from '../dist/render-ir/index.js';
import {projectSceneRenderFrame} from '../dist/execution/index.js';

test('scene projection preserves authoritative physics separately from visual geometry',()=>{
 const scene=new Scene({version:1,gravity:[0,0,0],entities:[{
  id:'road-car',mesh:{kind:'box',size:[2,1,4]},renderMesh:{kind:'sphere',radius:2},material:{kind:'steel'},
  environmental:{surfaceUse:'road',snowDepthM:.03,waterDepthM:.002},body:{motion:'kinematic',mass:1200,velocity:[3,0,1],angularVelocity:[0,.2,0]},
 }]});
 const store=new MemoryContentStore(),projected=projectSceneRenderFrame(scene,store,{epoch:3n,frame:9n}),frame=projected.frame;
 assert.equal(frame.observation.kind,'observation');
 assert.ok(frame.resources.resources.some(ref=>ref.kind==='observation'&&ref.hash===frame.observation.hash));
 const observation=store.require(frame.observation.hash);
 assert.equal(observation.contractVersion,CAUSAL_RENDER_CONTRACT_VERSION);
 assert.equal(observation.simulationTick,0n);assert.equal(observation.simulationTimeSeconds,0);
 assert.deepEqual(observation.world,{handedness:'right',up:'+Y',positionUnit:'m',timeUnit:'s',angleUnit:'rad',radiance:'scene-linear'});
 assert.equal(observation.surfaces.length,1);
 const surface=observation.surfaces[0];
 assert.equal(surface.identity.entityId,'road-car');assert.equal(surface.identity.surfaceId,'road-car');
 assert.equal(surface.visualGeometry.hash,frame.objects[0].mesh.hash);
 assert.notEqual(surface.physicalGeometry.hash,surface.visualGeometry.hash,'physics and render geometry must remain distinct when renderMesh is authored');
 assert.deepEqual(surface.linearVelocityMps,[3,0,1]);assert.deepEqual(surface.angularVelocityRadps,[0,.2,0]);
 assert.equal(surface.surface.snowDepthM,.03);assert.equal(surface.surface.waterDepthM,.002);
});

test('causal render contract rejects invalid semantic resources and non-finite motion',()=>{
 const base={schema:1,contractVersion:CAUSAL_RENDER_CONTRACT_VERSION,simulationTick:0n,simulationTimeSeconds:0,world:{handedness:'right',up:'+Y',positionUnit:'m',timeUnit:'s',angleUnit:'rad',radiance:'scene-linear'},surfaces:[]};
 assert.ok(Object.isFrozen(defineCausalRenderObservation(base)));
 assert.throws(()=>defineCausalRenderObservation({...base,surfaces:[{identity:{entityId:'x',surfaceId:'x'},visualGeometry:{kind:'material',hash:'bad:1'},material:{kind:'material',hash:'mat:1'},transform:[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],linearVelocityMps:[0,0,0],angularVelocityRadps:[0,0,0]}]}),/resource kinds/);
 assert.throws(()=>defineCausalRenderObservation({...base,surfaces:[{identity:{entityId:'x',surfaceId:'x'},visualGeometry:{kind:'mesh',hash:'mesh:1'},material:{kind:'material',hash:'mat:1'},transform:[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],linearVelocityMps:[Infinity,0,0],angularVelocityRadps:[0,0,0]}]}),/finite/);
});
