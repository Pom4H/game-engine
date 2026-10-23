import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {Worker} from 'node:worker_threads';
import {EnvironmentMapWorker} from '../dist/render/environment-map-worker.js';
import {bakeEnvironmentMap} from '../dist/render/environment-map.js';
import {buildSceneRadianceProbe} from '../dist/render/radiance.js';
import {Scene} from '../dist/scene/scene.js';
import {V3} from '../dist/math.js';
import {WebGPURenderer} from '../dist/render/webgpu.js';

const fixtures=[
 [{version:1,entities:[]},'b2b5976fdfd8c46618055fbab5a5d8ff545ac609a65f40169552430cb5d9eca3'],
 [{version:1,seed:9208765,entities:[{id:'wall',position:[3,2,0],mesh:{kind:'box',size:[4,4,1]},material:{color:[.6,.3,.2,1]}},{id:'lamp',position:[-2,3,5],mesh:{kind:'sphere',radius:1},material:{color:[1,.8,.2,1],emissive:[.6,.2,.1]}}],rendering:{sunDirection:[.4,.8,-.5],sunIntensity:1.7,skyColor:[.2,.3,.4]}},'f8f5c2f51479f20846564294bb3219c07ed843691c3667170232b7662354f091'],
];
function input(spec=fixtures[0][0]){
 const scene=new Scene(spec),s=scene.spec.rendering??{};
 return {radiance:buildSceneRadianceProbe(scene,[1,2,3],128,true),sun:V3.normalize(s.sunDirection??[-.55,.48,-.35]),sunColor:s.sunColor??[1,.87,.72],sky:s.skyColor??[.26,.34,.47],intensity:s.sunIntensity??scene.environment.sunlight*3};
}
function digest(data){const hash=createHash('sha256');hash.update(data.irradiance);for(const mip of data.mips)hash.update(mip);return hash.digest('hex');}
function harness(){const posted=[],published=[],native={onmessage:null,onerror:null,terminated:false,postMessage(value){posted.push(value);},terminate(){this.terminated=true;}};const worker=new EnvironmentMapWorker((key,data)=>published.push({key,data}),()=>native);return {worker,native,posted,published,finish(data={irradiance:new Float32Array(36),mips:[]}){native.onmessage({data});}};}

test('extracted lighting retains the pre-change irradiance and every mip byte',()=>{
 for(const [spec,expected]of fixtures)assert.equal(digest(bakeEnvironmentMap(input(spec))),expected);
});
test('actual worker bake and transferred buffers exactly match the synchronous bake',async()=>{
 const entry=new URL('../dist/render/environment-map.worker.js',import.meta.url).href;
 const worker=new Worker(`const {parentPort}=require('node:worker_threads');globalThis.postMessage=(data,transfer)=>parentPort.postMessage(data,transfer);import(${JSON.stringify(entry)}).then(()=>parentPort.on('message',data=>globalThis.onmessage({data})));`,{eval:true});
 try{const request=input(fixtures[1][0]),result=new Promise((resolve,reject)=>{worker.once('message',resolve);worker.once('error',reject);});worker.postMessage(request);const data=await result;assert.equal(digest(data),fixtures[1][1]);assert.equal(data.mips.length,9);}finally{await worker.terminate();}
});
test('rapid requests keep only the active bake and newest replacement; idle waits for both',async()=>{
 const h=harness();h.worker.request('a',input());for(let i=0;i<20;i++)h.worker.request('b'+i,input());
 assert.equal(h.posted.length,1);assert.deepEqual(h.worker.inspect(),{active:true,queued:true,failed:false});
 assert.equal(h.worker.idle(),h.worker.idle(),'idle callers share one bounded completion promise');
 let settled=false;const idle=h.worker.idle().then(()=>settled=true);h.finish();await Promise.resolve();assert.equal(settled,false);assert.equal(h.posted.length,2);h.finish();await idle;assert.deepEqual(h.published.map(p=>p.key),['a','b19']);
});
test('scene reset rejects old results and retains a new scene request',async()=>{
 const h=harness();h.worker.request('old',input());h.worker.request('obsolete',input());h.worker.reset();h.worker.request('new',input());h.finish();assert.equal(h.published.length,0);h.finish();await h.worker.idle();assert.deepEqual(h.published.map(p=>p.key),['new']);
});
test('returning to the active cause drops a superseded queued input',()=>{
 const h=harness();h.worker.request('a',input());h.worker.request('b',input());h.worker.request('a',input());h.finish();assert.equal(h.posted.length,1);assert.deepEqual(h.published.map(p=>p.key),['a']);
});
test('dispose terminates worker and releases idle waiters without publishing stale results',async()=>{
 const h=harness();h.worker.request('a',input());const idle=h.worker.idle();h.worker.dispose();await idle;h.finish();assert.equal(h.native.terminated,true);assert.equal(h.published.length,0);h.worker.request('b',input());assert.equal(h.posted.length,1);
});
test('worker failure rejects readiness without baking on the caller or replacing its last complete map',async()=>{
 const h=harness();h.worker.request('a',input());const idle=h.worker.idle();h.native.onerror({message:'injected worker failure',preventDefault(){}});assert.equal(h.native.terminated,true);assert.equal(h.worker.inspect().failed,true);assert.equal(h.published.length,0);await assert.rejects(idle,/injected worker failure/);await assert.rejects(h.worker.idle(),/injected worker failure/);
 h.worker.request('b',input(fixtures[1][0]));assert.equal(h.published.length,0);assert.equal(h.posted.length,1);h.worker.dispose();
});

test('construction and postMessage failure never execute a synchronous fallback',async()=>{
 let published=0;const unavailable=new EnvironmentMapWorker(()=>published++,()=>{throw Error('constructor blocked');});unavailable.request('a',input());await assert.rejects(unavailable.idle(),/constructor blocked/);assert.equal(published,0);unavailable.dispose();
 const broken=new EnvironmentMapWorker(()=>published++,()=>({onmessage:null,onerror:null,postMessage(){throw Error('post blocked');},terminate(){}}));broken.request('b',input());await assert.rejects(broken.idle(),/post blocked/);assert.equal(published,0);broken.dispose();
});
test('renderer keeps a complete map during background baking and rejects a cached-return stale result',()=>{
 const scene=new Scene(fixtures[1][0]),uploads=[],native={onmessage:null,onerror:null,postMessage(){},terminate(){}};
 const renderer=Object.create(WebGPURenderer.prototype);
 Object.assign(renderer,{environmentIrradiance:new Float32Array(36),environmentUpdates:0,environmentKey:'',environmentRequestedKey:'',device:{queue:{writeTexture(_target,pixels){uploads.push(pixels.slice());}}},gpu:{environmentMap:{}},profiler:{enabled:false,addUpload(){}}});
 renderer.environmentWorker=new EnvironmentMapWorker((key,data)=>renderer.publishEnvironmentMap(key,data),()=>native);
 renderer.updateEnvironmentMap(scene,[1,2,3]);assert.equal(uploads.length,0,'the first bake must also stay off the caller');native.onmessage({data:bakeEnvironmentMap(input(fixtures[1][0]))});assert.equal(uploads.length,9);const original=renderer.environmentKey;
 scene.patchAppearance({rendering:{sunIntensity:2}});renderer.updateEnvironmentMap(scene,[1,2,3]);assert.equal(uploads.length,9,'render must not wait for the next bake');assert.equal(renderer.environmentKey,original);
 const pending=renderer.environmentRequestedKey;assert.notEqual(pending,original);
 scene.patchAppearance({rendering:{sunIntensity:1.7}});renderer.updateEnvironmentMap(scene,[1,2,3]);assert.equal(renderer.environmentRequestedKey,'');
 native.onmessage({data:bakeEnvironmentMap(input({...fixtures[1][0],rendering:{...fixtures[1][0].rendering,sunIntensity:2}}))});
 assert.equal(renderer.environmentKey,original);assert.equal(uploads.length,9,'cancelled lighting must never replace a cached map');
 renderer.environmentWorker.dispose();
});

test('continuously advancing cameras publish serialized progress without losing the newest request or overwriting a cached return',()=>{
 const scene=new Scene(fixtures[1][0]),uploads=[],posted=[],native={onmessage:null,onerror:null,postMessage(input){posted.push(input);},terminate(){}};
 const renderer=Object.create(WebGPURenderer.prototype);
 Object.assign(renderer,{environmentIrradiance:new Float32Array(36),environmentUpdates:0,environmentKey:'',environmentRequestedKey:'',device:{queue:{writeTexture(_target,pixels){uploads.push(pixels);}}},gpu:{environmentMap:{}},profiler:{enabled:false,addUpload(){}}});
 renderer.environmentWorker=new EnvironmentMapWorker((key,data)=>renderer.publishEnvironmentMap(key,data),()=>native);
 renderer.updateEnvironmentMap(scene,[1,2,3]);
 assert.equal(uploads.length,0);native.onmessage({data:bakeEnvironmentMap(posted.shift())});
 renderer.updateEnvironmentMap(scene,[2,2,3]);let active=renderer.environmentRequestedKey;
 for(let iteration=0;iteration<3;iteration++){
  renderer.updateEnvironmentMap(scene,[3+iteration*2,2,3]);renderer.updateEnvironmentMap(scene,[4+iteration*2,2,3]);const newest=renderer.environmentRequestedKey;
  assert.notEqual(active,newest);native.onmessage({data:bakeEnvironmentMap(posted[iteration])});
  assert.equal(renderer.environmentKey,active,'camera motion cannot starve complete map publication');assert.equal(uploads.length,9*(iteration+2));
  assert.equal(renderer.environmentRequestedKey,newest,'an older completion cannot discard the latest queued cause');active=newest;
 }
 native.onmessage({data:bakeEnvironmentMap(posted[3])});assert.equal(renderer.environmentKey,active);assert.equal(renderer.environmentRequestedKey,'');
 const returnedKey=renderer.environmentKey;renderer.updateEnvironmentMap(scene,[9,2,3]);
 // Return to a known cached origin; the pending worker must never undo this
 // newer choice, even though that outstanding bake has a larger camera x.
 renderer.updateEnvironmentMap(scene,[4,2,3]);const cachedKey=renderer.environmentKey,uploadCount=uploads.length;
 assert.notEqual(cachedKey,returnedKey);assert.equal(renderer.environmentRequestedKey,'');
 native.onmessage({data:bakeEnvironmentMap(posted[4])});assert.equal(renderer.environmentKey,cachedKey);assert.equal(uploads.length,uploadCount);
 renderer.environmentWorker.dispose();
});
