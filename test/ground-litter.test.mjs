import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {rareWindGust,GROUND_LITTER_WGSL} from '../dist/render/ground-litter.js';
import {rareWindGust as originalWind} from './fixtures/game-ground-wind.mjs';
import {Scene} from '../dist/scene/scene.js';
import {primitiveMesh,meshVertexAttributes} from '../dist/procedural/mesh.js';
import {encodePackedMesh,decodePackedMesh} from '../dist/assets/packed-mesh.js';
import {WebGPURenderer} from '../dist/render/webgpu.js';
import {compose} from '../dist/math.js';
import {writeSurfaceWeather} from '../dist/render/rain-surface.js';
import {FRAME_UNIFORM_WORDS} from '../dist/render/lighting.js';

const mesh=()=>({kind:'triangle-mesh',positions:[0,0,0,1,0,0,0,0,1],normals:[0,1,0,0,1,0,0,1,0],indices:[0,1,2],variationSeeds:[-3,.375,7.25]});
test('litter kernel and gust cadence retain the original Game algorithms',()=>{
 const original=readFileSync(new URL('./fixtures/game-ground-litter.wgsl',import.meta.url),'utf8');assert.ok(GROUND_LITTER_WGSL.replace(/\r\n/g,'\n').endsWith(original.replace(/\r\n/g,'\n').replace(/\bhalf\b/g,'halfExtent').replace(/\bhash\(/g,'litterHash(').replace(/\bnoise\(/g,'litterNoise(')));
 for(const wind of [[0,0],[3,4],[-6,2]])for(const gust of [0,.01,.5,1])for(let i=0;i<800;i++)assert.deepEqual(rareWindGust(wind,gust,i*.37),originalWind(wind,gust,i*.37));
});
test('signed per-vertex variation survives owned meshes, GPU attributes and packed assets',()=>{
 const input=mesh(),scene=new Scene({version:1,entities:[{id:'paving',mesh:input,renderOnly:true}]}),owned=scene.entities.get('paving').mesh;input.variationSeeds[0]=9;assert.equal(owned.variationSeeds[0],-3);assert.ok(Object.isFrozen(owned.variationSeeds));
 const data=primitiveMesh(owned),bytes=meshVertexAttributes(data),view=new DataView(bytes.buffer);assert.equal(bytes.byteLength,3*16);for(let i=0;i<3;i++)assert.equal(view.getFloat32(i*16+12,true),owned.variationSeeds[i]);
 const packed=encodePackedMesh(owned),roundtrip=decodePackedMesh(packed);assert.deepEqual(roundtrip.variationSeeds,owned.variationSeeds);assert.deepEqual(roundtrip.indices,owned.indices);
 const plain=mesh();delete plain.variationSeeds;const attributes=meshVertexAttributes(primitiveMesh(plain));for(let i=0;i<3;i++)assert.equal(new DataView(attributes.buffer).getFloat32(i*16+12,true),0);
 for(const seeds of [[1],[0,NaN,0],[0,1e100,0]]){assert.throws(()=>new Scene({version:1,entities:[{id:'bad',mesh:{...mesh(),variationSeeds:seeds},renderOnly:true}]}),/variationSeed/);assert.throws(()=>encodePackedMesh({...mesh(),variationSeeds:seeds}),/seed/);}
 assert.throws(()=>decodePackedMesh({...packed,variationSeedsF32Base64:''}),/seed/);
});
test('litter material selection and authored instance seed reach real object uniforms',()=>{
 const scene=new Scene({version:1,entities:[{id:'ground',mesh:{kind:'box'},renderOnly:true,material:{groundLitter:{kind:'paving',baseRoughness:.89},variationSeed:-3.25}}]}),entity=scene.entities.get('ground'),model=compose([0,0,0],[0,0,0],[1,1,1]),writes=[],renderer=Object.create(WebGPURenderer.prototype);
 Object.assign(renderer,{lastScene:scene,object:()=>({uniform:{},width:0,height:0}),mesh:()=>({}),previousModels:{get:()=>model},surfaceTextures:{get:()=>undefined},profiler:{addUpload(){}},device:{queue:{writeBuffer(_b,_o,data){writes.push(new Float32Array(data));}}}});renderer.prepare(entity,model);const words=writes[0];assert.equal(words.length,100);assert.equal(words[42],-3.25);assert.equal(words[96],2);assert.ok(Math.abs(words[97]-.89)<1e-6);assert.equal(scene.physics.bodies.size,0);
});
test('litter authoring is owned and validated before any patch mutates the scene',()=>{
 const detail={kind:'asphalt',baseRoughness:.94},scene=new Scene({version:1,entities:[{id:'ground',mesh:{kind:'box'},renderOnly:true,material:{groundLitter:detail}}]}),entity=scene.entities.get('ground'),material=entity.material;detail.baseRoughness=0;assert.equal(material.groundLitter.baseRoughness,.94);assert.ok(Object.isFrozen(material.groundLitter));
 for(const invalid of [{kind:'paper'},{kind:'paving',baseRoughness:2},{kind:'tile',extra:true}])assert.throws(()=>scene.patchAppearance({rendering:{exposure:2},materials:[{id:'ground',set:{groundLitter:invalid}}]}),/groundLitter/);
 assert.throws(()=>scene.patchAppearance({rendering:{exposure:2},materials:[{id:'ground',set:{variationSeed:Infinity}}]}),/variationSeed/);assert.equal(scene.spec.rendering,undefined);assert.equal(entity.material,material);
 const structure=scene.renderStructureRevision,appearance=scene.appearanceRevision,weather={rain:0,litter:true,groundWind:[5,-3]};scene.patchAppearance({rendering:{surfaceWeather:weather}});weather.groundWind[0]=0;assert.equal(scene.spec.rendering.surfaceWeather.groundWind[0],5);assert.equal(scene.renderStructureRevision,structure);assert.equal(scene.appearanceRevision,appearance);
 // Surface weather owns three vec4s at 168..179; later camera-depth fields must survive.
 const frame=new Float32Array(FRAME_UNIFORM_WORDS);frame.fill(71,180);writeSurfaceWeather(frame,scene.spec.rendering.surfaceWeather);assert.deepEqual([...frame.slice(176,180)],[5,-3,1,0]);assert.ok(frame.slice(180).every(v=>v===71));writeSurfaceWeather(frame,undefined);assert.ok(frame.slice(168,180).every(v=>v===0));assert.ok(frame.slice(180).every(v=>v===71));
});
