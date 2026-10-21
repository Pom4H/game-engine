import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {FACADE_SURFACE_WGSL} from '../dist/render/facade-surface.js';
import {Scene} from '../dist/scene/scene.js';
import {WebGPURenderer} from '../dist/render/webgpu.js';
import {compose} from '../dist/math.js';
import {writeSurfaceWeather,writeProbeSurfaceWeather} from '../dist/render/rain-surface.js';
import {FRAME_UNIFORM_WORDS} from '../dist/render/lighting.js';

test('continuous frame night validates atomically and preserves render geometry and temporal revisions',()=>{
 const scene=new Scene({version:1,rendering:{facadeNight:.311},entities:[{id:'wall',mesh:{kind:'box'},renderOnly:true,material:{facade:{kind:'masonry',night:.8}}}]}),entity=scene.entities.get('wall'),material=entity.material,structure=scene.renderStructureRevision,appearance=scene.appearanceRevision;
 for(const facadeNight of [NaN,Infinity,-.01,1.01,'night',null]){
  assert.throws(()=>new Scene({version:1,rendering:{facadeNight},entities:[]}),/facadeNight/);
  const before=scene.spec.rendering;
  assert.throws(()=>scene.patchAppearance({rendering:{facadeNight,exposure:3},materials:[{id:'wall',set:{roughness:.1}}]}),/facadeNight/);
  assert.equal(scene.spec.rendering,before);assert.equal(entity.material,material);
 }
 for(const facadeNight of [0,.311,.312,1,undefined]){
  scene.patchAppearance({rendering:{facadeNight}});assert.equal(scene.spec.rendering.facadeNight,facadeNight);
  assert.equal(entity.material,material);assert.equal(scene.renderStructureRevision,structure);assert.equal(scene.appearanceRevision,appearance);
 }
 assert.equal(scene.physics.bodies.size,0);assert.equal(scene.tick,0);
});

test('main and probe frames carry the same rain, exact night and absolute origin at stable offsets',()=>{
 const main=new Float32Array(FRAME_UNIFORM_WORDS).fill(17),probe=new Float32Array(32).fill(17),weather={rain:.75,origin:[128,6.6,-256]};
 writeSurfaceWeather(main,weather,.311);writeProbeSurfaceWeather(probe,weather,.311);
 assert.equal(main.byteLength,736);assert.equal(probe.byteLength,128);assert.equal(main[168],probe[23]);assert.equal(main[171],probe[27]);assert.equal(main[171],Math.fround(.311));assert.equal(main[175],1);assert.equal(probe[31],1);assert.deepEqual([...main.slice(172,175)],[...probe.slice(28,31)]);assert.ok(main.slice(180).every(v=>v===17));
 assert.ok(main.slice(0,168).every(n=>n===17));for(let index=0;index<27;index++)if(index!==23)assert.equal(probe[index],17);
 writeSurfaceWeather(main,undefined);writeProbeSurfaceWeather(probe,undefined);assert.equal(main[171],0);assert.equal(probe[23],0);assert.equal(probe[27],0);assert.deepEqual([...probe.slice(28)],[0,0,0,0]);
});

test('architectural kernel retains the frozen original window, shade and room formulas',()=>{
 const original=readFileSync(new URL('./fixtures/game-facade.wgsl',import.meta.url),'utf8').replace(/\r\n/g,'\n');
 const body=original.slice(original.indexOf('{')+1,original.lastIndexOf('}')).replace(/\bhash\(/g,'facadeHash(').replace(/\bsafeNormal\(/g,'facadeSafeNormal(');
 assert.ok(FACADE_SURFACE_WGSL.includes(body));
});
test('facades are owned, explicit and validated atomically across creation and appearance patches',()=>{
 const facade={kind:'masonry',night:.5},scene=new Scene({version:1,entities:[{id:'wall',mesh:{kind:'box'},renderOnly:true,material:{facade,variationSeed:.375}}]}),wall=scene.entities.get('wall'),original=wall.material;
 facade.night=0;assert.equal(wall.material.facade.night,.5);assert.ok(Object.isFrozen(wall.material.facade));assert.equal(scene.physics.bodies.size,0);
 for(const bad of [{kind:'brick'},{kind:'glazed',night:-1},{kind:'glazed',night:Infinity},{kind:'masonry',extra:1}]){
  assert.throws(()=>new Scene({version:1,entities:[{id:'bad',renderOnly:true,material:{facade:bad}}]}),/facade/);
  assert.throws(()=>scene.patchAppearance({rendering:{exposure:2},materials:[{id:'wall',set:{facade:bad}}]}),/facade/);
  assert.equal(wall.material,original);assert.equal(scene.spec.rendering,undefined);
 }
 const next={kind:'glazed',night:1};scene.patchAppearance({materials:[{id:'wall',set:{facade:next}}]});next.night=0;assert.equal(wall.material.facade.night,1);assert.ok(Object.isFrozen(wall.material.facade));
});
test('facade controls reuse reserved material words while preserving original instance variation',()=>{
 const scene=new Scene({version:1,entities:[{id:'wall',mesh:{kind:'box'},renderOnly:true,material:{facade:{kind:'glazed',night:.75},variationSeed:.375}}]}),entity=scene.entities.get('wall'),model=compose([0,0,0],[0,0,0],[1,1,1]),writes=[],renderer=Object.create(WebGPURenderer.prototype);
 Object.assign(renderer,{lastScene:scene,object:()=>({uniform:{},width:0,height:0}),mesh:()=>({}),previousModels:{get:()=>model},surfaceTextures:{get:()=>undefined},profiler:{addUpload(){}},device:{queue:{writeBuffer(_b,_o,data){writes.push(new Float32Array(data));}}}});renderer.prepare(entity,model);assert.equal(writes[0].length,100);assert.equal(writes[0][42],.375);assert.deepEqual([...writes[0].slice(96)],[0,-1,2,.75]);
});
