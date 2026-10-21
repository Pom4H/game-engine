import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Scene} from '../dist/scene/scene.js';
import {WebGPURenderer} from '../dist/render/webgpu.js';
import {compose} from '../dist/math.js';
import {RAIN_SURFACE_WGSL,writeSurfaceWeather} from '../dist/render/rain-surface.js';
import {FRAME_UNIFORM_WORDS,FRAME_UNIFORM_BYTES} from '../dist/render/lighting.js';

test('Engine retains the original ground rings and paint drop kernels',()=>{
 const original=readFileSync(new URL('./fixtures/game-rain-surface.wgsl',import.meta.url),'utf8');
 const hash='\nfn rainHash(p:vec2f)->f32 {return fract(sin(dot(p,vec2f(127.1,311.7)))*43758.5453);}\n';
 assert.equal(RAIN_SURFACE_WGSL.replace(/\r\n/g,'\n'),hash+original.replace(/\r\n/g,'\n').replace(/\bhash\(/g,'rainHash('));
});

test('ground and mirrored paint select actual object uniforms without changing body state',()=>{
 const scene=new Scene({version:1,entities:[undefined,{kind:'ground'},{kind:'paint'},{kind:'paint',mirrorX:true}].map((rainResponse,i)=>({id:String(i),mesh:{kind:'box'},body:{mass:2},material:{rainResponse}}))});
 const writes=[],model=compose([0,0,0],[0,0,0],[1,1,1]),renderer=Object.create(WebGPURenderer.prototype);
 Object.assign(renderer,{lastScene:scene,object:()=>({uniform:{},width:0,height:0}),mesh:()=>({}),previousModels:{get:()=>model},surfaceTextures:{get:()=>undefined},profiler:{addUpload(){}},device:{queue:{writeBuffer(_b,_o,data){writes.push(new Float32Array(data));}}}});
 for(const entity of scene.entities.values()){const material=entity.material,body=entity.body,friction=body.friction;renderer.prepare(entity,model);assert.equal(entity.material,material);assert.equal(entity.body,body);assert.equal(body.friction,friction);}
 assert.deepEqual(writes.map(w=>[w[94],w[95]]),[[0,0],[1,0],[2,1],[2,-1]]);assert.equal(scene.time,0);assert.equal(scene.tick,0);
});

test('weather frame data is appended and clears when external rain is removed',()=>{
 assert.equal(FRAME_UNIFORM_WORDS,184);assert.equal(FRAME_UNIFORM_BYTES,736);
 const frame=new Float32Array(FRAME_UNIFORM_WORDS).fill(17);writeSurfaceWeather(frame,{rain:.75,paintFlow:[-2,3],origin:[128,0,-256]});
 assert.ok(frame.slice(0,168).every(v=>v===17));assert.deepEqual([...frame.slice(168,180)],[.75,-2,3,0,128,0,-256,0,0,0,0,0]);
 writeSurfaceWeather(frame,undefined);assert.ok(frame.slice(168,180).every(v=>v===0));assert.ok(frame.slice(180).every(v=>v===17),'weather preserves the camera depth configuration');
});

test('weather is owned, validated before mutation and does not invalidate static rendering',()=>{
 const response={kind:'paint',mirrorX:true},weather={rain:.8,paintFlow:[1,2],origin:[128,0,256]};
 const scene=new Scene({version:1,rendering:{surfaceWeather:weather},entities:[{id:'one',mesh:{kind:'box'},renderOnly:true,material:{rainResponse:response}}]}),entity=scene.entities.get('one'),structure=scene.renderStructureRevision,appearance=scene.appearanceRevision;
 response.mirrorX=false;weather.origin[0]=0;assert.equal(entity.material.rainResponse.mirrorX,true);assert.equal(scene.spec.rendering.surfaceWeather.origin[0],128);assert.ok(Object.isFrozen(entity.material.rainResponse));
 const next={rain:.2,paintFlow:[3,4],origin:[256,0,256]};scene.patchAppearance({rendering:{surfaceWeather:next}});next.origin[0]=0;assert.equal(scene.spec.rendering.surfaceWeather.origin[0],256);assert.equal(scene.renderStructureRevision,structure);assert.equal(scene.appearanceRevision,appearance,'frame-only rain changes retain TAA and material uploads');
 const before=scene.spec.rendering;
 for(const invalid of [{rain:NaN},{rain:1.1},{rain:.2,paintFlow:[1]},{rain:0,origin:[0,Infinity,0]},{rain:0,physics:true}]){
  assert.throws(()=>scene.patchAppearance({rendering:{exposure:2,surfaceWeather:invalid},materials:[{id:'one',set:{roughness:.1}}]}),/surfaceWeather/);assert.equal(scene.spec.rendering,before);assert.equal(entity.material.roughness,undefined);
 }
 for(const invalid of [{kind:'water'},{kind:'ground',mirrorX:true},{kind:'paint',mirrorX:1}])assert.throws(()=>scene.patchAppearance({rendering:{exposure:2},materials:[{id:'one',set:{rainResponse:invalid}}]}),/rainResponse/);
 assert.equal(scene.spec.rendering,before);assert.equal(scene.physics.bodies.size,0);assert.equal(scene.tick,0);
});
