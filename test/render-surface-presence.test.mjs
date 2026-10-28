import test from 'node:test';
import assert from 'node:assert/strict';
import {SurfaceEnvironmentSystem} from '../dist/environment/surface-state.js';
import {Scene} from '../dist/scene/scene.js';
import {WebGPURenderer} from '../dist/render/webgpu.js';
import {RenderModelHistory} from '../dist/render/model-history.js';
import {renderModel} from '../dist/render/frame.js';

test('physical presence index follows every public Map mutation and overlapping state lifetimes',()=>{
 const system=new SurfaceEnvironmentSystem(),maps=[system.fields,system.surfaces,system.bodies],ids=Array.from({length:31},(_,i)=>'state-'+i);
 let seed=138751;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed;};
 for(let n=0;n<1200;n++){
  const map=maps[random()%3],id=ids[random()%ids.length],op=random()%17;
  if(op<11){const value=op===0?undefined:{id,wetness:n/1200};assert.equal(map.set(id,value),map);}else if(op<16)map.delete(id);else map.clear();
  for(const key of ids)assert.equal(system.hasRenderState(key),maps.some(m=>!!m.get(key)),`${n}: ${key}`);
 }
 maps.forEach(map=>map.set('overlap',{}));maps[0].clear();maps[1].delete('overlap');assert.equal(system.hasRenderState('overlap'),true);maps[2].delete('overlap');assert.equal(system.hasRenderState('overlap'),false);
 maps.forEach(map=>map.clear());ids.forEach(id=>assert.equal(system.hasRenderState(id),false));
});

test('Scene presence projection keeps physical source links and falls back for custom state readers',()=>{
 const scene=new Scene({version:1,gravity:[0,0,0],environment:{temperatureC:-4,snowfall:'heavy',sunlight:0,history:[{hoursAgo:12,temperatureC:-4,snowfall:'heavy',sunlight:0}]},entities:[{id:'curb',mesh:{kind:'box',size:[8,.4,.5]},material:{kind:'concrete'},environmental:{surfaceUse:'curb'}}]});
 const physical=JSON.stringify(scene.snapshot()),presence=scene.renderSurfaceStatePresence;
 assert.equal(typeof presence,'function');
 for(const entity of scene.entities.values())assert.equal(presence(entity.id),!!(scene.surfaces.field(entity.id)||scene.surfaceStateForRender(entity.id)||scene.surfaces.body(entity.id)));
 const sources=[...scene.surfaceVisualSources];assert.ok(sources.length,'real generated surface visuals must be covered');
 const [visual,source]=sources[0];assert.equal(presence(visual),true);
 const state=scene.surfaces.surfaces.get(source);scene.surfaces.surfaces.delete(source);scene.surfaces.surfaces.set(visual,{});assert.equal(presence(visual),false,'a linked physical source takes precedence over the visual ID surface');
 scene.surfaces.bodies.set(visual,{});assert.equal(presence(visual),true);scene.surfaces.bodies.delete(visual);scene.surfaces.surfaces.delete(visual);scene.surfaces.surfaces.set(source,state);
 assert.equal(JSON.stringify(scene.snapshot()),physical);
 for(const [object,name] of [[scene,'surfaceStateForRender'],[scene.surfaces,'field'],[scene.surfaces,'surface'],[scene.surfaces,'body']]){
  const original=object[name];object[name]=()=>({});assert.equal(scene.renderSurfaceStatePresence,undefined);object[name]=original;assert.equal(typeof scene.renderSurfaceStatePresence,'function');
 }
});

function rendererFor(scene){
 const renderer=Object.create(WebGPURenderer.prototype),destroy=()=>{},buffer=()=>({destroy}),mesh={key:'box',count:36,triangles:12};
 // Production mesh() returns the same live GPUMesh for this shared geometry key.
 Object.assign(renderer,{lastScene:scene,cameraBatches:new Map(),cameraBatchMembers:new Set(),cameraBatchCauses:[],cameraBatchPlans:[],cameraBatchScene:null,cameraBatchPlanBuilds:0,instanceMetadata:new WeakMap(),materialBatchKeys:new WeakMap(),previousModels:new RenderModelHistory(),profiler:{addUpload(){}},device:{limits:{},queue:{writeBuffer(){}},createBuffer:buffer,createBindGroup:()=>({})},gpu:{instanceLayout:{},visibility:{createBatch:()=>({visibleIndices:{},destroy})}},mesh:()=>mesh});
 return renderer;
}
test('resident GPU batches observe added, removed and cleared physical states without a scene revision',()=>{
 const scene=new Scene({version:1,entities:Array.from({length:6},(_,i)=>({id:'cube-'+i,mesh:{kind:'box'},material:{kind:'steel'}}))}),renderer=rendererFor(scene),entities=[...scene.entities.values()],structure=scene.renderStructureRevision;
 const prepare=()=>{const before=JSON.stringify(scene.snapshot());renderer.prepareCameraBatches(entities,renderModel);assert.equal(JSON.stringify(scene.snapshot()),before);return new Set(renderer.cameraBatchMembers);};
 assert.equal(prepare().size,6);const builds=renderer.cameraBatchPlanBuilds;prepare();assert.equal(renderer.cameraBatchPlanBuilds,builds);
 for(const map of [scene.surfaces.fields,scene.surfaces.surfaces,scene.surfaces.bodies]){
  map.set('cube-0',{});assert.equal(prepare().has('cube-0'),false);map.set('cube-0',{});const stable=renderer.cameraBatchPlanBuilds;prepare();assert.equal(renderer.cameraBatchPlanBuilds,stable);map.delete('cube-0');assert.equal(prepare().has('cube-0'),true);
  map.set('cube-0',{});map.set('cube-1',{});assert.equal(prepare().size,4);map.clear();assert.equal(prepare().size,6);
 }
 assert.equal(scene.renderStructureRevision,structure);
 const original=scene.surfaceStateForRender;scene.surfaceStateForRender=id=>id==='cube-2'?{}:undefined;assert.equal(prepare().has('cube-2'),false);scene.surfaceStateForRender=original;assert.equal(prepare().size,6);
 const material=entities[0].material;entities[0].material={...material,label:'new'};assert.equal(prepare().has('cube-0'),false);entities[0].material=material;assert.equal(prepare().size,6);
 const next=new Scene({version:1,entities:[]});renderer.lastScene=next;assert.equal(renderer.prepareCameraBatches([],renderModel).length,0);assert.equal(renderer.cameraBatchMembers.size,0);
});
