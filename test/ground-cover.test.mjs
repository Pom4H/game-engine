import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Scene} from '../dist/scene/scene.js';
import {WebGPURenderer} from '../dist/render/webgpu.js';
import {compose} from '../dist/math.js';
import {castsRenderShadow} from '../dist/render/visibility-plan.js';
import {GROUND_COVER_WGSL} from '../dist/render/ground-cover.js';
import {initializationDevice} from './helpers/render-initialization-device.mjs';

function fixture(){
 const scene=new Scene({version:1,entities:[undefined,'turf','grass-blade'].map((groundCover,i)=>({id:String(i),mesh:{kind:'box'},renderOnly:true,material:{groundCover}}))});
 const writes=[],model=compose([0,0,0],[0,0,0],[1,1,1]),renderer=Object.create(WebGPURenderer.prototype);
 Object.assign(renderer,{lastScene:scene,object:()=>({uniform:{},width:0,height:0}),mesh:()=>({}),previousModels:{get:()=>model},surfaceTextures:{get:()=>undefined},profiler:{addUpload(){}},device:{queue:{writeBuffer(_b,_o,data){writes.push(new Float32Array(data));}}}});
 return {scene,writes,prepare:entity=>renderer.prepare(entity,model)};
}

test('optional cover reaches actual object uniforms while ordinary materials and physical state remain unchanged',()=>{
 const {scene,writes,prepare}=fixture();for(const entity of scene.entities.values())prepare(entity);
 assert.deepEqual(writes.map(w=>w[96]),[0,4,5]);assert.ok(writes.every(w=>w.length===100));
 assert.deepEqual(writes[0].slice(0,96),writes[1].slice(0,96).map((v,i)=>i===42?writes[0][i]:v));
 assert.equal(scene.physics.bodies.size,0);assert.equal(scene.tick,0);assert.equal(scene.time,0);
 assert.equal(castsRenderShadow(scene.entities.get('0')),true);assert.equal(castsRenderShadow(scene.entities.get('1')),true);assert.equal(castsRenderShadow(scene.entities.get('2')),false);
 const entity=scene.entities.get('1'),material=entity.material,structure=scene.renderStructureRevision;
 for(const groundCover of ['tree',0,{},null]){
  assert.throws(()=>scene.patchAppearance({rendering:{exposure:4},materials:[{id:'1',set:{groundCover}}]}),/groundCover/);
  assert.equal(entity.material,material);assert.equal(scene.spec.rendering,undefined);
 }
 scene.patchAppearance({materials:[{id:'1',set:{groundCover:'grass-blade'}}]});assert.equal(castsRenderShadow(entity),false);assert.equal(scene.renderStructureRevision,structure+1);prepare(entity);assert.equal(writes.at(-1)[96],5);
 scene.patchAppearance({materials:[{id:'1',set:{groundCover:undefined}}]});assert.equal(castsRenderShadow(entity),true);assert.equal(scene.renderStructureRevision,structure+2);prepare(entity);assert.equal(writes.at(-1)[96],0);
});

test('filtered turf preserves the original metre-based main kernel',()=>{
 const source=readFileSync(new URL('./fixtures/game-turf.wgsl',import.meta.url),'utf8').replace(/\r\n/g,'\n');
 assert.ok(GROUND_COVER_WGSL.replace(/\r\n/g,'\n').endsWith(source.replace(/\bhash\(/g,'turfHash(').replace(/\bnoise\(/g,'turfNoise(')+'\n'));
});

test('production material variants, planar reflection and probes all receive cover without changing uniform layout',async t=>{
 const fixture=initializationDevice(t,undefined,{async:true});try{
  const renderer=await WebGPURenderer.create(fixture.canvas,{features:{temporalAA:true}});
  const codes=[...new Set(fixture.pipelines.flatMap(p=>[p.vertex?.module?.code,p.fragment?.module?.code]).filter(Boolean))];
  const material=codes.filter(code=>code.includes('fn turf('));assert.ok(material.length>3);
  assert.ok(material.some(code=>code.includes('albedo=turf(turfPosition,albedo,turfFootprint)')));
  assert.ok(material.some(code=>code.includes('turf(in.worldPos.xz+f.renderOrigin.xz,coverColor,coverFootprint)')));
  assert.ok(material.some(code=>code.includes('turf(in.worldPos.xz+p.renderOrigin.xz,coverColor,coverFootprint)')));
  assert.ok(material.some(code=>code.includes('uv.y*smoothstep(3.5,6.5,distance(world.xz,f.eye.xz))')));
  renderer.dispose();
 }finally{fixture.restore();}
});
