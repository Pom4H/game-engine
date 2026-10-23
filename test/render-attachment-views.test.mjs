import test from 'node:test';
import assert from 'node:assert/strict';
import {RenderAttachmentViews} from '../dist/render/attachment-views.js';
import {WebGPURenderer} from '../dist/render/webgpu.js';
import {Scene} from '../dist/scene/scene.js';
import {initializationDevice} from './helpers/render-initialization-device.mjs';

async function fixture(t,features={motionBlur:true}){
 const f=initializationDevice(t),views=[],passes=[],createTexture=f.device.createTexture;
 f.device.createTexture=descriptor=>{
  const texture=createTexture(descriptor);texture.createView=function(descriptor){const view={texture:this,descriptor};views.push(view);return view;};return texture;
 };
 const swapchain={createView(){const view={texture:this,presentation:true};views.push(view);return view;}};
 f.canvas.getContext=()=>({configure(){},getCurrentTexture(){return swapchain;}});
 f.device.queue.writeBuffer=()=>{};f.device.queue.submit=()=>{};
 f.device.createCommandEncoder=()=>({beginRenderPass(descriptor){passes.push(descriptor);return{setPipeline(){},setBindGroup(){},setVertexBuffer(){},setIndexBuffer(){},draw(){},drawIndexed(){},drawIndexedIndirect(){},end(){}};},copyTextureToTexture(){},finish(){return{};}});
 const ratio=globalThis.devicePixelRatio;globalThis.devicePixelRatio=1;t.after(()=>{if(ratio===undefined)delete globalThis.devicePixelRatio;else globalThis.devicePixelRatio=ratio;});
 const renderer=await WebGPURenderer.create(f.canvas,{features});renderer.setResolution(64,64);t.after(()=>renderer.dispose());
 return{...f,renderer,views,passes,swapchain,frame(scene){const first=passes.length;renderer.render(scene);return passes.slice(first);}};
}
function scene(){return new Scene({version:1,rendering:{sunIntensity:1},entities:[
 {id:'wall',mesh:{kind:'box'},position:[0,1,0]},
 {id:'moving',mesh:{kind:'box'},position:[1,1,0],body:{mass:1}},
 {id:'glass',mesh:{kind:'plane',size:[2,2]},position:[0,1,-1],material:{kind:'glass'}},
 {id:'road',mesh:{kind:'plane',size:[20,20]},material:{kind:'asphalt',roughness:.2,surfaceAppearance:{wetness:1,darkening:0}}},
 ...[-1,1].map((x,i)=>({id:'spot'+i,position:[x,3,-2],light:{kind:'point',intensity:30,color:[1,.8,.6],range:20,castShadow:true,emission:{axis:[0,-.1,1],innerAngle:.1,outerAngle:.7}}})),
 ]});}
const pass=(passes,label)=>passes.find(p=>p.label===label);
const view=(passes,label)=>pass(passes,label).colorAttachments[0].view;

test('actual repeated frames reuse owned views, including bloom/TAA, while even a stable swapchain texture gets a fresh view',async t=>{
 const f=await fixture(t),s=scene(),first=f.frame(s),second=f.frame(s),third=f.frame(s);
 assert.ok(pass(first,'render.shadow.static'));assert.ok(pass(first,'render.shadow.dynamic'));assert.ok(pass(first,'render.reflection'));assert.ok(pass(first,'render.motionBlur'));
 for(const label of ['render.main.opaque','render.main.transparent','render.reflection','render.effects','render.motionBlur'])assert.equal(view(first,label),view(second,label),label);
 assert.equal(view(first,'render.bloom.downsample'),view(first,'render.bloom.vertical'),'both passes target bloom A');
 assert.equal(view(first,'render.taa'),view(third,'render.taa'));assert.notEqual(view(first,'render.taa'),view(second,'render.taa'));
 assert.equal(pass(first,'render.main.opaque').depthStencilAttachment.view,pass(second,'render.main.transparent').depthStencilAttachment.view);
 for(let slot=0;slot<2;slot++){
  const label='render.shadow.spot.'+slot,a=pass(first,label).depthStencilAttachment.view,b=pass(second,label).depthStencilAttachment.view;
  assert.equal(a,b);assert.deepEqual(a.descriptor,{dimension:'2d',baseArrayLayer:slot,arrayLayerCount:1});
 }
 assert.notEqual(pass(first,'render.shadow.spot.0').depthStencilAttachment.view,pass(first,'render.shadow.spot.1').depthStencilAttachment.view);
 const baseline=f.views.length;for(let i=0;i<20;i++){f.renderer.shadowValid=false;f.frame(s);}
 assert.equal(f.views.length-baseline,20,'settled frames create only their current presentation view');
 const presentations=f.views.filter(v=>v.presentation);assert.equal(presentations.length,23);assert.equal(new Set(presentations).size,23);
});

test('resize retires old attachment identities, preserves fixed targets, and same-size resize keeps views',async t=>{
 const f=await fixture(t),s=scene(),before=f.frame(s),oldHDR=f.renderer.hdr,oldDepth=f.renderer.depth;
 const shadow=pass(before,'render.shadow.dynamic').depthStencilAttachment.view,spot=pass(before,'render.shadow.spot.0').depthStencilAttachment.view;
 const count=f.textures.length;f.renderer.setResolution(64,64);assert.equal(f.textures.length,count);const same=f.frame(s);
 assert.equal(view(same,'render.main.transparent'),view(before,'render.main.transparent'));
 f.renderer.setResolution(96,72);assert.equal(oldHDR.destroys,1);assert.equal(oldDepth.destroys,1);
 const after=f.frame(s);assert.notEqual(view(after,'render.main.transparent'),view(before,'render.main.transparent'));
 assert.equal(pass(after,'render.shadow.dynamic').depthStencilAttachment.view,shadow);assert.equal(pass(after,'render.shadow.spot.0').depthStencilAttachment.view,spot);
 for(const p of after){for(const a of p.colorAttachments??[])if(a)assert.notEqual(a.view.texture,oldHDR);if(p.depthStencilAttachment)assert.notEqual(p.depthStencilAttachment.view.texture,oldDepth);}
 f.renderer.dispose();assert.ok(f.textures.every(texture=>texture.destroys===1));
});

test('actual probe sweeps cache six exact face views and one shared depth view without changing publication order',async t=>{
 const f=await fixture(t,{screenSpace:false,bloom:false,temporalAA:false,planarReflections:false}),s=new Scene({version:1,rendering:{reflectionProbe:{entity:'anchor',facesPerFrame:6}},entities:[{id:'anchor'}]});
 const first=f.frame(s).filter(p=>/^render\.probe\.\d$/.test(p.label));assert.equal(first.length,6);
 s.setVisualTransform('anchor',[10,0,0]);const second=f.frame(s).filter(p=>/^render\.probe\.\d$/.test(p.label));assert.equal(second.length,6);
 for(let face=0;face<6;face++){
  const a=first[face].colorAttachments[0].view,b=second[face].colorAttachments[0].view;
  assert.equal(a,b);assert.equal(a.texture,f.renderer.gpu.localProbeCapture);assert.deepEqual(a.descriptor,{dimension:'2d',baseArrayLayer:face,arrayLayerCount:1,baseMipLevel:0,mipLevelCount:1});
  assert.equal(first[face].depthStencilAttachment.view,second[face].depthStencilAttachment.view);assert.equal(first[face].depthStencilAttachment.view,first[0].depthStencilAttachment.view);
 }
 assert.equal(new Set(first.map(p=>p.colorAttachments[0].view)).size,6);
});

test('disabled attachment features keep null color slots and never create their targets',async t=>{
 const f=await fixture(t,{screenSpace:false,bloom:false,temporalAA:false,planarReflections:false,motionBlur:false}),s=new Scene({version:1,entities:[]});
 const frame=f.frame(s);assert.deepEqual(pass(frame,'render.main.opaque').colorAttachments.slice(1),[null,null,null]);
 assert.equal(f.renderer.normal,null);assert.equal(f.renderer.specular,null);assert.equal(f.renderer.velocity,null);assert.equal(f.renderer.effectsHdr,null);assert.equal(f.renderer.taaA,null);assert.equal(f.renderer.motionHdr,null);
 assert.equal(frame.some(p=>p.label==='render.reflection'||p.label.startsWith('render.bloom.')||p.label==='render.taa'||p.label==='render.motionBlur'),false);
 const count=f.views.length;f.frame(s);assert.equal(f.views.length-count,1);
});

test('view ownership reset and failed/reentrant creation cannot retain an obsolete cache entry',()=>{
 const cache=new RenderAttachmentViews();let calls=0,fail=true,reset=false;
 const texture={createView(descriptor){calls++;if(fail){fail=false;throw new Error('view failed');}if(reset){reset=false;cache.clear();}return{texture:this,descriptor};}};
 assert.throws(()=>cache.default(texture),/view failed/);const a=cache.default(texture);assert.equal(cache.default(texture),a);assert.equal(calls,2);
 cache.forget(texture);const b=cache.default(texture);assert.notEqual(b,a);assert.equal(calls,3);
 cache.clear();reset=true;const late=cache.default(texture);assert.notEqual(cache.default(texture),late,'a clear during native creation does not publish the returned old-generation view');
 const spot=cache.spot(texture,0),probe=cache.probe(texture,0);assert.notEqual(spot,probe);assert.notEqual(spot,cache.default(texture));
 cache.clear();assert.notEqual(cache.spot(texture,0),spot);assert.notEqual(cache.probe(texture,0),probe);
 const previous=calls;cache.spot(texture,2);cache.spot(texture,2);cache.probe(texture,6);cache.probe(texture,6);assert.equal(calls-previous,4,'unexpected layers preserve GPU validation without extending cache capacity');
});
