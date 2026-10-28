import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {WebGPURenderer} from '../dist/render/webgpu.js';
import {initializationDevice} from './helpers/render-initialization-device.mjs';

const settle=()=>new Promise(resolve=>setImmediate(resolve));
const reference=JSON.parse(readFileSync(new URL('./fixtures/render-pipeline-descriptors.json',import.meta.url),'utf8'));
const canonical=reference.plans.canonical.options;
const fingerprints=pipelines=>pipelines.map(descriptor=>({label:descriptor.label,sha256:createHash('sha256').update(JSON.stringify(descriptor,(key,value)=>key==='code'&&typeof value==='string'?createHash('sha256').update(value).digest('hex'):value)).digest('hex')})).sort((a,b)=>a.label.localeCompare(b.label)||a.sha256.localeCompare(b.sha256));

test('renderer readiness waits for native material variants, dependent probe layouts and the final pipeline',async t=>{
 const fixture=initializationDevice(t,undefined,{async:true,deferred:true});let returned=false;
 const creating=WebGPURenderer.create(fixture.canvas,canonical).then(renderer=>{returned=true;return renderer;});
 await settle();assert.equal(fixture.requests.filter(request=>request.descriptor.label.startsWith('material')&&!request.descriptor.label.includes('transparent')).length,66);assert.equal(fixture.layouts.length,0);assert.equal(returned,false);
 fixture.resolveExcept('probe filter');await settle();assert.equal(fixture.layouts.length,0);assert.equal(returned,false);
 fixture.resolve('probe filter');await settle();assert.equal(fixture.layouts.filter(layout=>layout.label==='probe filter').length,42);assert.equal(fixture.requests.length,101);assert.equal(returned,false);
 fixture.resolveExcept('present');await settle();assert.equal(returned,false);fixture.resolve('present');const renderer=await creating;
 assert.equal(fixture.syncCalls,0);assert.equal(fixture.scopes.length,0);assert.equal(fixture.maxDepth,1);
 for(const value of Object.values(renderer.gpu)){
  assert.notEqual(typeof value?.then,'function');if(value instanceof Map)for(const pipeline of value.values())assert.notEqual(typeof pipeline?.then,'function');
 }
 for(const pipeline of Object.values(renderer.gpu.surfacePasses))assert.notEqual(typeof pipeline?.then,'function');
 assert.equal(renderer.gpu.reflectedCulled.get(0),renderer.gpu.reflectedCulled.get(10));renderer.dispose();
});

test('async readiness and capability fallback preserve every frozen shader, layout and render descriptor',async t=>{
 for(const plan of Object.values(reference.plans))for(const async of [true,false]){
  const fixture=initializationDevice(t,undefined,{async});try{const renderer=await WebGPURenderer.create(fixture.canvas,plan.options);
  assert.deepEqual(fingerprints(fixture.pipelines),plan.pipelines);assert.equal(fixture.scopes.length,0);assert.equal(fixture.maxDepth,async?1:2);assert.equal(fixture.syncCalls,async?0:plan.pipelines.length);renderer.dispose();
  }finally{fixture.restore();}
 }
});

for(const label of ['glass','probe filter','present'])test(`native ${label} pipeline rejection retains its label/cause and destroys the failed device once`,async t=>{
 const fixture=initializationDevice(t,label,{async:true});
 await assert.rejects(WebGPURenderer.create(fixture.canvas,canonical),error=>{assert.equal(error.message,`WebGPU initialization: ${label}: Fragment library could not be created`);assert.equal(error.cause,fixture.nativeError);assert.equal(error.cause.reason,'validation');return true;});
 assert.equal(fixture.destroyed,1);assert.equal(fixture.scopes.length,0);assert.equal(fixture.syncCalls,0);if(label==='probe filter')assert.equal(fixture.layouts.length,0);
});

test('older implementations retain scoped synchronous validation and failed-device cleanup',async t=>{
 const fixture=initializationDevice(t,'glass');
 await assert.rejects(WebGPURenderer.create(fixture.canvas,canonical),/WebGPU initialization: glass: Fragment library could not be created/);
 assert.equal(fixture.destroyed,1);assert.equal(fixture.scopes.length,0);assert.equal(fixture.maxDepth,2);assert.ok(fixture.syncCalls>0);
});

test('an async API synchronous throw is labelled and never retried through the synchronous API',async t=>{
 const fixture=initializationDevice(t,'glass',{async:true,throwAsync:true});
 await assert.rejects(WebGPURenderer.create(fixture.canvas,canonical),error=>{assert.match(error.message,/WebGPU initialization: glass:/);assert.equal(error.cause,fixture.nativeError);return true;});
 assert.equal(fixture.destroyed,1);assert.equal(fixture.syncCalls,0);assert.equal(fixture.scopes.length,0);
});

test('error-scope collection failure preserves the original native failure and still destroys its device',async t=>{
 const fixture=initializationDevice(t,'probe filter',{async:true,rejectPop:true});
 await assert.rejects(WebGPURenderer.create(fixture.canvas,canonical),error=>{assert.match(error.message,/WebGPU initialization: probe filter:/);assert.equal(error.cause,fixture.nativeError);return true;});
 assert.equal(fixture.destroyed,1);assert.equal(fixture.scopes.length,0);
});

test('early probe failure also handles material pipeline rejections before the final graph join',async t=>{
 const fixture=initializationDevice(t,'probe filter',{async:true,failLabels:['glass','material 0 opaque back']});
 await assert.rejects(WebGPURenderer.create(fixture.canvas,canonical),/WebGPU initialization: probe filter:/);await settle();
 assert.equal(fixture.destroyed,1);assert.equal(fixture.layouts.length,0);assert.equal(fixture.scopes.length,0);assert.equal(fixture.syncCalls,0);
});

test('fallback validation-scope rejections are handled while shader diagnostics wait across event turns',async t=>{
 let release;const ready=new Promise(resolve=>{release=resolve;});
 const fixture=initializationDevice(t,undefined,{rejectPopLabel:'glass',compilationReady:()=>ready});
 const rejected=assert.rejects(WebGPURenderer.create(fixture.canvas,canonical),error=>{assert.equal(error,fixture.scopeError);return true;});
 await settle();assert.equal(fixture.destroyed,0);release();await rejected;await settle();
 assert.equal(fixture.destroyed,1);assert.equal(fixture.scopes.length,0);
});
