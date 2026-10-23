import test from 'node:test';
import assert from 'node:assert/strict';
import {WebGPURenderer} from '../dist/render/webgpu.js';
import {Scene} from '../dist/scene/scene.js';
import {SurfaceTextures} from '../dist/render/surface-textures.js';
import {initializationDevice} from './helpers/render-initialization-device.mjs';

function globalValue(t,name,descriptor){const previous=Object.getOwnPropertyDescriptor(globalThis,name);Object.defineProperty(globalThis,name,{configurable:true,...descriptor});t.after(()=>{if(previous)Object.defineProperty(globalThis,name,previous);else delete globalThis[name];});}
function raster(log){
 let width=0,height=0;const context=new Proxy({clearRect(...v){log.push(['clearRect',...v]);},fillText(...v){log.push(['fillText',...v]);}},{set(o,k,v){log.push(['set',k,v]);o[k]=v;return true;}});
 return{get width(){return width;},set width(v){width=v;log.push(['width',v]);},get height(){return height;},set height(v){height=v;log.push(['height',v]);},getContext(kind){log.push(['context',kind]);return context;}};
}
function drawingDevice(f){
 f.device.queue.writeBuffer=()=>{};f.device.queue.submit=()=>{};f.device.queue.copyExternalImageToTexture=()=>{};
 f.device.createCommandEncoder=()=>({beginRenderPass(){return{setPipeline(){},setBindGroup(){},setVertexBuffer(){},setIndexBuffer(){},draw(){},drawIndexed(){},drawIndexedIndirect(){},end(){}};},copyTextureToTexture(){},finish(){return{};}});
}

test('explicit target initializes, resizes, labels and renders with all DOM-only globals forbidden',async t=>{
 for(const name of ['window','document','devicePixelRatio'])globalValue(t,name,{get(){throw new Error('forbidden '+name);}});
 const f=initializationDevice(t),log=[],rasters=[],viewport={cssWidth:101.7,cssHeight:51.9,pixelRatio:1.5};drawingDevice(f);
 const target={canvas:f.canvas,viewport,createLabelCanvas(width,height){const canvas=raster(log);canvas.width=width;canvas.height=height;rasters.push(canvas);return canvas;}};
 const renderer=await WebGPURenderer.createForTarget(target,{features:{screenSpace:false,bloom:false,temporalAA:false,planarReflections:false}});t.after(()=>renderer.dispose());
 renderer.resize();assert.deepEqual([f.canvas.width,f.canvas.height],[152,77]);
 const scene=new Scene({version:1,entities:[{id:'sign',mesh:{kind:'box'},material:{label:'Офис / Office №1'}}]});renderer.render(scene);assert.equal(rasters.length,1);assert.equal(renderer.inspect(false).errors.length,0);
 assert.deepEqual(log,[['width',1024],['height',128],['context','2d'],['clearRect',0,0,1024,128],['set','fillStyle','#e2d9bc'],['set','font','58px Georgia'],['set','textAlign','center'],['set','textBaseline','middle'],['fillText','Офис / Office №1',512,64,940]]);
 renderer.render(scene);assert.equal(rasters.length,1,'resident labels do not request another backing raster');
 for(const [ratio,expected]of [[4,[203,103]],[.5,[101,51]],[0,[101,51]],[-1,[101,51]],[NaN,[101,51]],[1.25,[127,64]]]){viewport.pixelRatio=ratio;renderer.resize();assert.deepEqual([f.canvas.width,f.canvas.height],expected);}
 viewport.cssWidth=1000;viewport.cssHeight=500;renderer.setResolution(128,72);assert.deepEqual([f.canvas.width,f.canvas.height],[128,72]);
});

test('DOM create keeps lazy DPR/CSS read order and the unchanged Georgia raster commands',async t=>{
 const f=initializationDevice(t),reads=[],log=[],viewport={cssWidth:100.8,cssHeight:50.4,pixelRatio:1.5};drawingDevice(f);
 Object.defineProperties(f.canvas,{clientWidth:{get(){reads.push('cssWidth');return viewport.cssWidth;}},clientHeight:{get(){reads.push('cssHeight');return viewport.cssHeight;}}});
 globalValue(t,'devicePixelRatio',{get(){reads.push('pixelRatio');return viewport.pixelRatio;}});
 globalValue(t,'document',{value:{createElement(kind){assert.equal(kind,'canvas');return raster(log);}}});
 const renderer=await WebGPURenderer.create(f.canvas);t.after(()=>renderer.dispose());assert.deepEqual(reads,[]);
 renderer.resize();assert.deepEqual(reads,['pixelRatio','cssWidth','cssHeight']);assert.deepEqual([f.canvas.width,f.canvas.height],[151,75]);
 reads.length=0;renderer.setResolution(80,40);assert.deepEqual(reads,['pixelRatio'],'fixed render size still reads DPR but not CSS dimensions');
 const color=[.1,.501,.999],a=renderer.label('Офис',color);assert.equal(renderer.label('Офис',color),a);
 assert.deepEqual(log,[['width',1024],['height',128],['context','2d'],['clearRect',0,0,1024,128],['set','fillStyle','rgb(26,128,255)'],['set','font','58px Georgia'],['set','textAlign','center'],['set','textBaseline','middle'],['fillText','Офис',512,64,940]]);
});

test('explicit label factory failures allocate no texture; upload failure destroys only its uncommitted texture',async t=>{
 const f=initializationDevice(t),viewport={cssWidth:64,cssHeight:64,pixelRatio:1};let mode='throw',calls=0;
 const target={canvas:f.canvas,viewport,createLabelCanvas(width,height){calls++;if(mode==='throw')throw new Error('raster unavailable');if(mode==='null')return{getContext(){return null;}};const canvas=raster([]);canvas.width=width;canvas.height=height;return canvas;}};
 const renderer=await WebGPURenderer.createForTarget(target);t.after(()=>renderer.dispose());const initial=f.textures.length;
 assert.equal(renderer.label(''),renderer.gpu.emptyLabel);assert.equal(calls,0);
 assert.throws(()=>renderer.label('failed'),/raster unavailable/);assert.equal(f.textures.length,initial);assert.equal(renderer.labels.size,0);
 mode='null';assert.throws(()=>renderer.label('failed'),/no 2D context/);assert.equal(f.textures.length,initial);
 mode='valid';f.device.queue.copyExternalImageToTexture=()=>{throw new Error('copy failed');};assert.throws(()=>renderer.label('failed'),/copy failed/);assert.equal(f.textures.length,initial+1);assert.equal(f.textures.at(-1).destroys,1);assert.equal(renderer.labels.size,0);
 f.device.queue.copyExternalImageToTexture=()=>{};const texture=renderer.label('failed');assert.equal(texture.destroys,0);assert.equal(renderer.labels.size,1);renderer.dispose();assert.equal(texture.destroys,1);
});

test('explicit target option validation precedes canvas/GPU access and preserves initialization failure cleanup',async t=>{
 const f=initializationDevice(t,'sky'),viewport={cssWidth:1,cssHeight:1,pixelRatio:1};let canvasReads=0;
 const target={get canvas(){canvasReads++;return f.canvas;},viewport,createLabelCanvas(){throw new Error('unexpected');}};
 await assert.rejects(WebGPURenderer.createForTarget(target,{visibility:'invalid'}),/Invalid visibility mode/);assert.equal(canvasReads,0);assert.equal(f.pipelines.length,0);
 await assert.rejects(WebGPURenderer.createForTarget(target),/sky/);assert.equal(canvasReads,1);assert.equal(f.destroyed,1);
});

test('asset base changes fetch resolution only; authored keys, deduplication, retention and errors stay intact',async t=>{
 const f=initializationDevice(t),requests=[];drawingDevice(f);
 const createPipeline=f.device.createRenderPipeline;f.device.createRenderPipeline=descriptor=>descriptor.label===undefined?{getBindGroupLayout(){return{};}}:createPipeline(descriptor);
 globalValue(t,'fetch',{value:async url=>{requests.push(url);return{ok:!url.endsWith('/missing.png'),status:404,async blob(){return{};}};}});
 globalValue(t,'createImageBitmap',{value:async()=>({width:1,height:1,close(){}})});
 const base='https://game.example/game/levels/',target={canvas:f.canvas,viewport:{cssWidth:64,cssHeight:64,pixelRatio:1},assetBase:base,createLabelCanvas(){throw new Error('unused');}};
 const renderer=await WebGPURenderer.createForTarget(target);t.after(()=>renderer.dispose());const textures=renderer.surfaceTextures;
 const keys=['textures/brick.png','/textures/road.png','https://cdn.example/image.png','blob:https://game.example/4e3c','./textures/brick.png'];
 for(const key of keys)await Promise.all([textures.load(key),textures.load(key)]);
 assert.deepEqual(requests,keys.map(key=>new URL(key,base).href));
 assert.equal(textures.size,keys.length);assert.notEqual(textures.get(keys[0]),textures.get(keys[4]),'distinct authored keys do not merge even when fetch URLs resolve identically');assert.equal(textures.get(new URL(keys[0],base).href),undefined);
 const retained=textures.get(keys[0]),retired=keys.slice(1).map(key=>textures.get(key));textures.retain(new Set([keys[0]]));assert.equal(textures.get(keys[0]),retained);assert.ok(retired.every(texture=>texture.destroys===1));
 await assert.rejects(textures.load('missing.png'),/Material texture missing\.png: HTTP 404/);assert.equal(requests.at(-1),base+'missing.png');
 const direct=new SurfaceTextures(f.device);await direct.load('/literal.png');assert.equal(requests.at(-1),'/literal.png','no base keeps the existing fetch argument');direct.dispose();
 globalValue(t,'document',{value:{baseURI:'https://game.example/office/',createElement(){throw new Error('unused');}}});
 const html=await WebGPURenderer.create(f.canvas);t.after(()=>html.dispose());await html.surfaceTextures.load('wall.png');assert.equal(requests.at(-1),'https://game.example/office/wall.png','the HTML adapter captures the host document base');
});
