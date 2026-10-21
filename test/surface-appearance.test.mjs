import test from 'node:test';
import assert from 'node:assert/strict';
import {Scene} from '../dist/scene/scene.js';
import {WebGPURenderer} from '../dist/render/webgpu.js';
import {MATERIAL_UNIFORM_WORDS,MATERIAL_UNIFORM_BYTES} from '../dist/render/material-layout.js';
import {compose} from '../dist/math.js';

const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-6,`${a} != ${b}`);
function rendererFor(scene){
 const writes=[],model=compose([0,0,0],[0,0,0],[1,1,1]),object={uniform:{},width:0,height:0},renderer=Object.create(WebGPURenderer.prototype);
 Object.assign(renderer,{lastScene:scene,object:()=>object,mesh:()=>({}),previousModels:{get:()=>model},surfaceTextures:{get:()=>undefined},profiler:{addUpload(){}},device:{queue:{writeBuffer(_b,_o,data){writes.push(new Float32Array(data));},writeTexture(){}}}});
 return{prepare:e=>renderer.prepare(e,model),writes};
}
test('external wetness and final roughness reach the actual uniform producer without changing contact state',()=>{
 const scene=new Scene({version:1,environment:{humidity:.95,precipitation:'frequent',groundMoisture:.9},entities:[{id:'road',mesh:{kind:'box'},body:{mass:2},material:{kind:'asphalt',roughness:.94,surfaceAppearance:{wetness:0,darkening:0}}}]}),entity=scene.entities.get('road'),physical=entity.material.surface,body=entity.body,friction=body.friction,fixture=rendererFor(scene);
 assert.ok(physical.wetness>.2);fixture.prepare(entity);const dry=fixture.writes.at(-1);assert.equal(dry.length,MATERIAL_UNIFORM_WORDS);assert.equal(dry.byteLength,MATERIAL_UNIFORM_BYTES);assert.equal(dry[37],0);assert.equal(dry[39],0);near(dry[68],.94);assert.deepEqual([...dry.slice(92,96)],[1,1,0,0]);
 scene.patchAppearance({materials:[{id:'road',set:{roughness:.274,surfaceAppearance:{wetness:.9,darkening:.378}}}]});fixture.prepare(entity);const wet=fixture.writes.at(-1);near(wet[37],.9);near(wet[39],.378);near(wet[68],.274);assert.deepEqual([...wet.slice(92,96)],[1,1,0,0]);
 assert.equal(entity.body,body);assert.equal(body.friction,friction);assert.equal(entity.material.surface,physical);assert.equal(scene.tick,0);assert.equal(scene.time,0);
 scene.patchAppearance({materials:[{id:'road',set:{roughness:.94,surfaceAppearance:{wetness:0,darkening:0}}}]});fixture.prepare(entity);assert.deepEqual(fixture.writes.at(-1),dry);
 scene.patchAppearance({materials:[{id:'road',set:{surfaceAppearance:undefined}}]});fixture.prepare(entity);near(fixture.writes.at(-1)[37],physical.wetness);assert.deepEqual([...fixture.writes.at(-1).slice(92,96)],[0,0,0,0]);assert.equal(body.friction,friction);
});
test('ordinary physical materials keep the former surface uniforms and have no projection flags',()=>{
 const scene=new Scene({version:1,entities:[{id:'road',mesh:{kind:'box'},material:{kind:'asphalt'}}]}),entity=scene.entities.get('road'),fixture=rendererFor(scene);fixture.prepare(entity);const words=fixture.writes[0];near(words[37],entity.material.surface.wetness);near(words[39],entity.material.surface.darkening);assert.deepEqual([...words.slice(92,96)],[0,0,0,0]);
});

test('native snow history projects to the existing GPU snow kernel without adding a body or disabling instance eligibility',()=>{
 const snow={snowDepthM:.07,waterDepthM:.001,iceDepthM:.002,slush:.12,freshness:.8,liquidFraction:.1,crust:.2,grainSizeMm:.6};
 const scene=new Scene({version:1,entities:[{id:'roof',mesh:{kind:'box'},renderOnly:true,material:{kind:'concrete',surfaceAppearance:{wetness:.1,darkening:.02,snow}}}]}),entity=scene.entities.get('roof'),fixture=rendererFor(scene),mesh=entity.mesh;
 snow.snowDepthM=9;assert.equal(entity.material.surfaceAppearance.snow.snowDepthM,.07);assert(Object.isFrozen(entity.material.surfaceAppearance.snow));
 fixture.prepare(entity);const u=fixture.writes.at(-1);near(u[44],.07);near(u[45],.001);near(u[46],.12);near(u[47],.002);
 near(u[84],.8);near(u[85],.1);near(u[86],.2);near(u[87],.6/4.5);
 assert.equal(scene.physics.bodies.size,0);assert.equal(scene.tick,0);assert.equal(scene.surfaces.hasRenderState(entity.id),false);assert.equal(scene.renderSurfaceStatePresence(entity.id),false);
 scene.patchAppearance({materials:[{id:'roof',set:{surfaceAppearance:{wetness:0,darkening:0}}}]});fixture.prepare(entity);assert.deepEqual([...fixture.writes.at(-1).slice(44,48)],[0,0,0,0]);assert.equal(entity.mesh,mesh);
 const physical=new Scene({version:1,entities:[{id:'native',mesh:{kind:'box'},environmental:{surfaceUse:'generic',snowDepthM:.03},material:{surfaceAppearance:{wetness:0,darkening:0,snow:{...snow,snowDepthM:.4}}}}]});
 const actual=rendererFor(physical);actual.prepare(physical.entities.get('native'));near(actual.writes.at(-1)[44],.03);
 for(const invalid of [{...snow,snowDepthM:NaN},{...snow,snowDepthM:-1},{...snow,freshness:2},{snowDepthM:.03}])assert.throws(()=>scene.patchAppearance({materials:[{id:'roof',set:{surfaceAppearance:{wetness:0,darkening:0,snow:invalid}}}]}),/surfaceAppearance/);
});
test('surface appearance is owned and validated before a patch changes rendering or another material',()=>{
 const appearance={wetness:.3,darkening:.1},scene=new Scene({version:1,entities:[{id:'one',mesh:{kind:'box'},renderOnly:true,material:{surfaceAppearance:appearance}},{id:'two',mesh:{kind:'box'},renderOnly:true}]}),first=scene.entities.get('one'),second=scene.entities.get('two'),original=first.material;
 appearance.wetness=1;assert.equal(first.material.surfaceAppearance.wetness,.3);assert.ok(Object.isFrozen(first.material.surfaceAppearance));
 for(const invalid of [{wetness:NaN,darkening:0},{wetness:1.1,darkening:0},{wetness:0},{wetness:0,darkening:0,frictionScale:0}]){
  assert.throws(()=>new Scene({version:1,entities:[{id:'bad',mesh:{kind:'box'},material:{surfaceAppearance:invalid}}]}),/surfaceAppearance/);
  assert.throws(()=>scene.patchAppearance({rendering:{exposure:2},materials:[{id:'two',set:{roughness:.1}},{id:'one',set:{surfaceAppearance:invalid}}]}),/surfaceAppearance/);
  assert.equal(first.material,original);assert.equal(second.material.roughness,undefined);assert.equal(scene.spec.rendering,undefined);
 }
 const patch={wetness:.8,darkening:.2};scene.patchAppearance({materials:[{id:'one',set:{surfaceAppearance:patch}}]});patch.darkening=0;assert.equal(first.material.surfaceAppearance.darkening,.2);assert.ok(Object.isFrozen(first.material.surfaceAppearance));assert.equal(scene.physics.bodies.size,0);
});
