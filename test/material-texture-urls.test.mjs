import test from 'node:test';
import assert from 'node:assert/strict';
import {WebGPURenderer} from '../dist/render/webgpu.js';

function fixture(){
 const renderer=Object.create(WebGPURenderer.prototype),events=[],ready=new Set();
 Object.assign(renderer,{disposed:false,failedMaterials:new Set(),materialLoads:new Map(),errors:[],surfaceTextures:{retain(urls){events.push(['retain',[...urls]]);},get(url){events.push(['get',url]);return ready.has(url)?{}:undefined;},async load(url){events.push(['load',url]);ready.add(url);}},materialTexturePublished(url){events.push(['published',url]);},objects:new Map(),meshes:new Map(),previousModels:new Map(),collectedScene:{},collectedRevision:-1});
 return{renderer,events,ready};
}
const settle=()=>new Promise(resolve=>setImmediate(resolve));

test('material URLs snapshot membership and read all channels in source order before texture cache I/O',async()=>{
 const f=fixture(),entities=new Map(),channels=['url','normalUrl','ormUrl','heightUrl'];
 function entity(id,values,mutate=false){return{id,renderVisible:false,get material(){f.events.push(['material',id]);return{get texture(){f.events.push(['texture',id]);return Object.defineProperties({},Object.fromEntries(channels.map((name,index)=>[name,{get(){f.events.push(['field',id,name]);if(mutate&&name==='normalUrl'){entities.delete('second');entities.set('late',{id:'late',material:{texture:{url:'/late.png'}}});}return values[index];}}])));}};}};}
 entities.set('first',entity('first',['/albedo.png','/shared.png','',undefined],true));entities.set('second',entity('second',['/albedo.png',undefined,'/orm.png','/shared.png']));
 const values=entities.values.bind(entities);Object.defineProperty(entities,'values',{value:function*(){f.events.push(['snapshot-start']);for(const entity of values()){f.events.push(['snapshot',entity.id]);yield entity;}f.events.push(['snapshot-end']);}});
 const scene={entities};f.renderer.lastScene=scene;f.renderer.queueMaterialLoads(scene);await settle();
 assert.deepEqual(f.events.slice(0,4),[['snapshot-start'],['snapshot','first'],['snapshot','second'],['snapshot-end']]);
 const fields=f.events.filter(event=>event[0]==='field');assert.deepEqual(fields,['first','second'].flatMap(id=>channels.map(name=>['field',id,name])));
 const retain=f.events.findIndex(event=>event[0]==='retain');assert.ok(retain>f.events.findLastIndex(event=>event[0]==='field'));assert.deepEqual(f.events[retain],['retain',['/albedo.png','/shared.png','/orm.png']]);
 assert.deepEqual(f.events.filter(event=>event[0]==='load').map(event=>event[1]),['/albedo.png','/shared.png','/orm.png']);assert.equal(f.ready.has('/late.png'),false);assert.deepEqual([...entities.keys()],['first','late']);
});

test('a failing channel getter leaves material cache/loading state untouched until collection completes',async()=>{
 for(const method of ['queueMaterialLoads','prepareMaterials'])for(const failing of ['url','normalUrl','ormUrl','heightUrl']){
  const f=fixture(),reads=[],failure=new RangeError('authored '+failing),texture={};for(const key of ['url','normalUrl','ormUrl','heightUrl'])Object.defineProperty(texture,key,{get(){reads.push(key);if(key===failing)throw failure;return '/'+key;}});
  const scene={entities:new Map([['first',{material:{texture:{url:'/first.png'}}}],['broken',{material:{texture}}]])};f.renderer.lastScene=scene;
  if(method==='prepareMaterials')await assert.rejects(f.renderer[method](scene),error=>error===failure);else assert.throws(()=>f.renderer[method](scene),error=>error===failure);
  assert.deepEqual(reads,['url','normalUrl','ormUrl','heightUrl'].slice(0,['url','normalUrl','ormUrl','heightUrl'].indexOf(failing)+1));assert.deepEqual(f.events,[]);assert.equal(f.renderer.materialLoads.size,0);assert.equal(f.renderer.failedMaterials.size,0);assert.equal(f.ready.size,0);
 }
});

test('queue/prepare require materials while collect retains its optional-material and receiver semantics',async()=>{
 const missing=()=>({entities:new Map([['missing',{id:'missing',renderVisible:false}]]),renderStructureRevision:1});
 for(const method of ['queueMaterialLoads','prepareMaterials']){const f=fixture(),scene=missing();f.renderer.lastScene=scene;if(method==='prepareMaterials')await assert.rejects(f.renderer[method](scene),TypeError);else assert.throws(()=>f.renderer[method](scene),TypeError);assert.deepEqual(f.events,[]);}
 const f=fixture(),scene=missing();f.renderer.collect(scene);assert.deepEqual(f.events,[['retain',[]]]);
 const skipped=fixture(),guarded=missing();guarded.entities.set('missing',{id:'missing',renderVisible:false,get material(){throw Error('Optional receiver must skip material getters');}});let iterations=0;const values=guarded.entities.values.bind(guarded.entities);guarded.entities.values=()=>{iterations++;return values();};skipped.renderer.surfaceTextures=undefined;
 assert.equal(skipped.renderer.collect(guarded),true);assert.equal(iterations,1,'Only the unrelated later live scan remains');
});

test('ordered deduplication keeps empty texture fields out and shares pending URL loads across material updates',async()=>{
 const f=fixture(),requests=[],pending=new Map();f.renderer.surfaceTextures.load=url=>{f.events.push(['load',url]);let resolve;const promise=new Promise(r=>{resolve=r;});requests.push(url);pending.set(url,()=>{f.ready.add(url);resolve();});return promise;};
 const material={texture:{url:'/a.png',normalUrl:'/normal.png',ormUrl:'',heightUrl:'/a.png'}},scene={entities:new Map([['first',{material}],['second',{material:{texture:{url:'/a.png',normalUrl:'/normal.png'}}}],['none',{material:{}}]])};f.renderer.lastScene=scene;
 f.renderer.queueMaterialLoads(scene);f.renderer.queueMaterialLoads(scene);assert.deepEqual(requests,['/a.png','/normal.png']);assert.equal(f.renderer.materialLoads.size,2);
 for(const resolve of pending.values())resolve();await settle();assert.equal(f.renderer.materialLoads.size,0);
 scene.entities.clear();f.renderer.failedMaterials.add('/obsolete.png');f.renderer.queueMaterialLoads(scene);assert.equal(f.renderer.failedMaterials.has('/obsolete.png'),false);assert.deepEqual(f.events.filter(event=>event[0]==='retain').at(-1),['retain',[]]);
});
