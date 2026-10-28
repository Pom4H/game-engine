import test from 'node:test';
import assert from 'node:assert/strict';
import {WebGPURenderer} from '../dist/render/webgpu.js';
import {cameraDepthConfiguration} from '../dist/render/camera-depth.js';
import {opaqueDepthPrepassEnabled,opaqueDepthPrepassShader} from '../dist/render/opaque-depth-prepass.js';
import {initializationDevice} from './helpers/render-initialization-device.mjs';

test('opaque depth opt-in validates flags, logarithmic encoding and one sample before GPU allocation',async()=>{
 const log=cameraDepthConfiguration(2000),perspective=cameraDepthConfiguration();
 assert.equal(opaqueDepthPrepassEnabled(undefined,perspective,4),false);
 assert.equal(opaqueDepthPrepassEnabled(false,log,4),false);
 assert.equal(opaqueDepthPrepassEnabled(true,log,1),true);
 for(const value of [0,1,'true',null])assert.throws(()=>opaqueDepthPrepassEnabled(value,log),/boolean/);
 assert.throws(()=>opaqueDepthPrepassEnabled(true,perspective),/logarithmic/);
 for(const samples of [0,2,4])assert.throws(()=>opaqueDepthPrepassEnabled(true,log,samples),/single-sample/);
 await assert.rejects(WebGPURenderer.create({}, {opaqueDepthPrepass:true}),/logarithmic/);
});

test('opt-in keeps native vertex/instance paths and excludes relief, coating and transparent shaders',async t=>{
 const originalRatio=Object.getOwnPropertyDescriptor(globalThis,'devicePixelRatio');
 Object.defineProperty(globalThis,'devicePixelRatio',{configurable:true,value:1});
 t.after(()=>originalRatio?Object.defineProperty(globalThis,'devicePixelRatio',originalRatio):delete globalThis.devicePixelRatio);
 for(const visibility of ['cpu','cpu-batched','gpu']){
  const fixture=initializationDevice(t,undefined,{async:true});
  try{
   const renderer=await WebGPURenderer.create(fixture.canvas,{visibility,logarithmicDepthFar:2000,opaqueDepthPrepass:true});
   const depth=fixture.pipelines.filter(p=>p.label.startsWith('opaque depth prepass '));
   assert.equal(depth.length,visibility==='cpu'?4:6);
   assert.ok(depth.every(p=>p.fragment.entryPoint==='opaqueDepthFS'&&p.fragment.targets.length===0&&p.depthStencil.depthCompare==='less'));
   assert.deepEqual(new Set(depth.map(p=>p.vertex.entryPoint)),new Set(['vs','vsInstanced']));
   for(const p of fixture.pipelines){
    if(p.label.startsWith('material ')&&!p.label.includes('transparent'))assert.equal(p.fragment.constants.OPAQUE_DEPTH_PREPASS,true);
    if(p.label.includes('transparent'))assert.equal(p.fragment.constants.OPAQUE_DEPTH_PREPASS,false);
    if(p.label.startsWith('coating overlay')||p.label.startsWith('surface relief'))assert.ok(!p.fragment.module.code.includes('OPAQUE_DEPTH_PREPASS'));
   }
   renderer.setResolution(640,360);const stats=renderer.inspect(false);
   assert.deepEqual(stats.opaqueDepthPrepass,{enabled:true,sampleCount:1,encoding:'logarithmic',excluded:['relief','coating']});
   assert.deepEqual(stats.renderTargets.opaqueDepth,{width:640,height:360,format:'depth32float'});
   const old=fixture.textures.find(texture=>texture.width===640&&texture.height===360&&texture.format==='depth32float');
   renderer.setResolution(800,450);assert.ok(old.destroys>0);renderer.dispose();
  }finally{fixture.restore();}
 }
});

test('shader gate preserves strict ties, derivative participation and explicit source contract failures',async t=>{
 const fixture=initializationDevice(t,undefined,{async:true});
 try{
  const renderer=await WebGPURenderer.create(fixture.canvas,{logarithmicDepthFar:2000});
  const source=fixture.pipelines.find(p=>p.label==='material 0 opaque back').fragment.module.code;
  assert.equal(opaqueDepthPrepassShader(source),source);
  const prepared=opaqueDepthPrepassShader(source,true),gate=prepared.indexOf('if(currentDepth>nearestDepth)');
  assert.ok(gate>prepared.indexOf('let normalVariance=')&&gate>prepared.indexOf('let litterFootprint='));
  assert.ok(!/\b(?:dpdx|dpdy|fwidth|textureSample)\s*\(/.test(prepared.slice(gate)));
  assert.ok(!prepared.includes('diagnostic(off'));
  assert.match(prepared,/u\.relief\.y<\.5&&u\.relief\.z<0\.0/);
  assert.throws(()=>opaqueDepthPrepassShader(source.replace('@location(11) cameraDepth:f32','@location(11) renamed:f32'),true),/varying/);
  assert.throws(()=>opaqueDepthPrepassShader(source.replace('fn shadowAt(p:','fn renamedShadow(p:'),true),/contract changed/);
  assert.throws(()=>opaqueDepthPrepassShader(source.replace('let litterFootprint=','let renamedFootprint='),true),/contract changed/);
  const lastReturn=source.lastIndexOf('return out;');
  assert.throws(()=>opaqueDepthPrepassShader(source.slice(0,lastReturn)+'let forbidden=dpdx(in.worldPos);'+source.slice(lastReturn),true),/derivative/);
  renderer.dispose();
 }finally{fixture.restore();}
});

test('an opt-in native depth pipeline failure is labelled and cleans up its failed device',async t=>{
 const fixture=initializationDevice(t,'opaque depth prepass shared back',{async:true});
 await assert.rejects(WebGPURenderer.create(fixture.canvas,{visibility:'gpu',logarithmicDepthFar:2000,opaqueDepthPrepass:true}),/opaque depth prepass shared back/);
 assert.equal(fixture.destroyed,1);assert.equal(fixture.scopes.length,0);
});
