import test from 'node:test';
import assert from 'node:assert/strict';
import {WebGPURenderer} from '../dist/render/webgpu.js';
import {Scene} from '../dist/scene/scene.js';
import {initializationDevice} from './helpers/render-initialization-device.mjs';

async function fixture(t,visibility='cpu'){
 const f=initializationDevice(t),passes=[],frames=[],visibilityUniforms=[],dispatches=[];
 const ratio=globalThis.devicePixelRatio;globalThis.devicePixelRatio=1;t.after(()=>{if(ratio===undefined)delete globalThis.devicePixelRatio;else globalThis.devicePixelRatio=ratio;});
 let renderer;
 f.device.queue.writeBuffer=(buffer,offset,data)=>{if(buffer===renderer?.gpu.frame&&offset===0&&data.length===184)frames.push(data.slice());if(buffer.size===112)visibilityUniforms.push(buffer);};
 f.device.queue.submit=()=>{};
 f.device.createCommandEncoder=()=>({
  beginRenderPass(d){passes.push(d);return{setPipeline(){},setBindGroup(){},setVertexBuffer(){},setIndexBuffer(){},draw(){},drawIndexed(){},drawIndexedIndirect(){},end(){}};},
  beginComputePass(){return{setPipeline(){},setBindGroup(){},dispatchWorkgroups(...a){dispatches.push(a);},end(){}};},copyTextureToTexture(){},finish(){return{};},
 });
 renderer=await WebGPURenderer.create(f.canvas,{visibility,features:{screenSpace:false,bloom:false,temporalAA:false,planarReflections:true}});
 renderer.setResolution(64,64);t.after(()=>renderer.dispose());
 const reset=()=>{passes.length=0;frames.length=0;visibilityUniforms.length=0;dispatches.length=0;};
 return {renderer,passes,frames,visibilityUniforms,dispatches,reset};
}
const sunPasses=f=>f.passes.filter(p=>/^render\.shadow\.(static|dynamic)$/.test(p.label)).map(p=>p.label);
const sceneWithLights=()=>new Scene({version:1,rendering:{sunIntensity:0},environment:{sunlight:0},entities:[
 {id:'wall',mesh:{kind:'box'},position:[0,1,0]},
 {id:'moving',mesh:{kind:'box'},position:[1,1,0],body:{mass:1}},
 {id:'spot',position:[0,3,-2],light:{kind:'point',intensity:30,color:[1,.8,.6],range:20,castShadow:true,emission:{axis:[0,-.1,1],innerAngle:.1,outerAngle:.7}}},
]});

test('actual zero sun omits only its maps; point/spot lighting survives and first moon/day frame rebuilds',async t=>{
 const f=await fixture(t),scene=sceneWithLights();
 f.renderer.render(scene);assert.equal(f.frames.at(-1)[19],0);assert.deepEqual(sunPasses(f),[]);
 assert.equal(f.renderer.shadowValid,false);assert.equal(f.renderer.inspect(false).pointLights,1);assert.ok(f.passes.some(p=>p.label==='render.shadow.spot.0'));
 assert.equal(f.renderer.visibilityPlan.inspect().passes.staticShadow.lastTests,0);
 // A celestial/moon override can light a world whose visual sunlight is zero.
 scene.spec.rendering.sunIntensity=.125;f.reset();f.renderer.render(scene);
 assert.equal(f.frames.at(-1)[19],.125);assert.deepEqual(sunPasses(f),['render.shadow.static','render.shadow.dynamic']);assert.equal(f.renderer.shadowValid,true);
 const oldRevision=f.renderer.shadowRevision;
 scene.spec.rendering.sunIntensity=0;f.reset();f.renderer.render(scene);assert.deepEqual(sunPasses(f),[]);assert.equal(f.renderer.shadowValid,false);
 scene.entities.get('wall').position[0]+=.25;f.renderer.render(scene);assert.equal(f.renderer.visibilityPlan.inspect().passes.staticShadow.lastTests,0);
 scene.spec.rendering.sunIntensity=.125;f.reset();f.renderer.render(scene);
 assert.deepEqual(sunPasses(f),['render.shadow.static','render.shadow.dynamic']);assert.ok(f.renderer.shadowRevision>oldRevision);
 f.reset();f.renderer.render(scene);assert.deepEqual(sunPasses(f),['render.shadow.dynamic'],'static map settles only after the fresh frame');
});

test('sun gate uses the exact uploaded float32 including fallback and tiny nonzero intensity',async t=>{
 const f=await fixture(t),scene=sceneWithLights();
 for(const intensity of [1,.00000001,2**-149,0,Number.MIN_VALUE,1]){
  scene.spec.rendering.sunIntensity=intensity;f.reset();f.renderer.render(scene);
  const actual=f.frames.at(-1)[19];assert.equal(actual,Math.fround(intensity));
  assert.equal(sunPasses(f).includes('render.shadow.dynamic'),actual!==0);
 }
 delete scene.spec.rendering.sunIntensity;scene.environment={...scene.environment,sunlight:.2};f.reset();f.renderer.render(scene);
 assert.equal(f.frames.at(-1)[19],Math.fround(.6));assert.ok(sunPasses(f).includes('render.shadow.dynamic'));
});

test('no-asphalt scene skips reflected cull, compute requests and draw; first receiver restores all in the same frame',async t=>{
 const f=await fixture(t,'gpu'),scene=new Scene({version:1,rendering:{sunIntensity:1},entities:Array.from({length:8},(_,n)=>({id:'box-'+n,renderOnly:true,mesh:{kind:'box'},position:[n-4,1,0]}))});
 f.renderer.render(scene);assert.equal(f.passes.some(p=>p.label==='render.reflection'),false);assert.equal(f.renderer.visibilityPlan.inspect().passes.reflection.tests,0);assert.equal(f.visibilityUniforms.length,1);assert.equal(f.dispatches.length,1);
 const road=()=>scene.add({id:'road',mesh:{kind:'plane',size:[20,20]},position:[0,.015,0],material:{kind:'asphalt',roughness:.2,surfaceAppearance:{wetness:1,darkening:0}}});
 road();f.reset();f.renderer.render(scene);assert.ok(f.passes.some(p=>p.label==='render.reflection'));assert.equal(f.visibilityUniforms.length,2);assert.equal(f.dispatches.length,2);
 scene.remove('road');f.reset();f.renderer.render(scene);assert.equal(f.passes.some(p=>p.label==='render.reflection'),false);assert.equal(f.renderer.visibilityPlan.inspect().passes.reflection.lastTests,0);assert.equal(f.visibilityUniforms.length,1);
 f.renderer.setResolution(96,64);road();f.reset();f.renderer.render(scene);assert.ok(f.passes.some(p=>p.label==='render.reflection'));assert.equal(f.visibilityUniforms.length,2);
 const labels=f.passes.map(p=>p.label);assert.ok(labels.indexOf('render.reflection')<labels.indexOf('render.main.opaque'));
});
