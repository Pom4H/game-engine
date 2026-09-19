import test from 'node:test';
import assert from 'node:assert/strict';
import {SurfaceTextures} from '../dist/render/surface-textures.js';
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
const settle=()=>new Promise(resolve=>setImmediate(resolve));
function gpu(compilation=()=>Promise.resolve({messages:[]})){
 const textures=[],submissions=[];
 return{textures,submissions,limits:{maxTextureDimension2D:8192},queue:{copyExternalImageToTexture(){},submit(commands){submissions.push(commands);}},
  createTexture(descriptor){const texture={descriptor,destroys:0,createView(){return{};},destroy(){this.destroys++;}};textures.push(texture);return texture;},
  createShaderModule(){return{getCompilationInfo:compilation};},createRenderPipeline(){return{getBindGroupLayout(){return{};}};},createSampler(){return{};},createBindGroup(){return{};},
  createCommandEncoder(){return{beginRenderPass(){return{setPipeline(){},setBindGroup(){},draw(){},end(){}};},finish(){return{};}};},
 };
}
function browser(t,{fetcher,decoder}={}){
 const originalFetch=globalThis.fetch,originalDecode=globalThis.createImageBitmap,requests=[],bitmaps=[];
 globalThis.fetch=async(url,options)=>{requests.push({url,signal:options.signal});return fetcher?fetcher(url,options):{ok:true,blob:async()=>new Blob(['image'])};};
 globalThis.createImageBitmap=async blob=>{if(decoder)return decoder(blob);const bitmap={width:32,height:16,closes:0,close(){this.closes++;}};bitmaps.push(bitmap);return bitmap;};
 t.after(()=>{globalThis.fetch=originalFetch;globalThis.createImageBitmap=originalDecode;});return{requests,bitmaps};
}

test('image material cache deduplicates concurrent loads, retains live URLs and releases old scene GPU allocations',async t=>{
 const runtime=browser(t),device=gpu(),cache=new SurfaceTextures(device);
 await Promise.all([cache.load('/snow.png'),cache.load('/snow.png')]);assert.equal(runtime.requests.length,1);assert.equal(cache.size,1);assert.equal(device.textures.length,1);assert.equal(runtime.bitmaps[0].closes,1);assert.equal(device.textures[0].descriptor.mipLevelCount,6);
 await cache.load('/road.png');cache.retain(new Set(['/road.png']));assert.equal(cache.size,1);assert.equal(cache.get('/snow.png'),undefined);assert.equal(device.textures[0].destroys,1);assert.equal(device.textures[1].destroys,0);
 cache.dispose();cache.dispose();assert.equal(device.textures[1].destroys,1);assert.equal(cache.size,0);await assert.rejects(()=>cache.load('/new.png'),/disposed/);
});

test('disposing while mip shader compilation is pending destroys the local texture and never publishes or submits it',async t=>{
 const compilation=deferred(),runtime=browser(t),device=gpu(()=>compilation.promise),cache=new SurfaceTextures(device),loading=cache.load('/snow.png');
 await settle();assert.equal(device.textures.length,1);assert.equal(cache.pendingCount,1);
 cache.dispose();assert.equal(device.textures[0].destroys,1);assert.equal(runtime.bitmaps[0].closes,1);assert.equal(runtime.requests[0].signal.aborted,true);
 compilation.resolve({messages:[]});await loading;assert.equal(device.textures[0].destroys,1);assert.equal(runtime.bitmaps[0].closes,1);assert.equal(cache.size,0);assert.equal(cache.pendingCount,0);assert.equal(device.submissions.length,0);
});

test('scene retention cancels an old generation without erasing a replacement upload for the same URL',async t=>{
 const first=deferred(),second=deferred();let calls=0;const runtime=browser(t),device=gpu(()=>(++calls===1?first:second).promise),cache=new SurfaceTextures(device);
 const old=cache.load('/snow.png');await settle();cache.retain(new Set());assert.equal(device.textures[0].destroys,1);
 const replacement=cache.load('/snow.png');await settle();assert.equal(cache.pendingCount,1);assert.equal(device.textures.length,2);
 first.resolve({messages:[]});await old;assert.equal(cache.pendingCount,1);assert.equal(cache.size,0);
 second.resolve({messages:[]});await replacement;assert.equal(cache.get('/snow.png'),device.textures[1]);assert.equal(cache.size,1);assert.equal(device.submissions.length,1);assert.equal(runtime.bitmaps.every(b=>b.closes===1),true);cache.dispose();
});

test('a decoded image arriving after disposal is closed without allocating a GPU texture',async t=>{
 const decoding=deferred(),bitmap={width:32,height:32,closes:0,close(){this.closes++;}};browser(t,{decoder:()=>decoding.promise});const device=gpu(),cache=new SurfaceTextures(device),loading=cache.load('/late.png');
 await settle();cache.dispose();decoding.resolve(bitmap);await loading;assert.equal(bitmap.closes,1);assert.equal(device.textures.length,0);assert.equal(cache.size,0);
});

test('GPU shader upload failure releases bitmap and texture and allows an explicit retry',async t=>{
 let failed=true;const runtime=browser(t),device=gpu(async()=>({messages:failed?[{type:'error',message:'bad mip shader'}]:[]})),cache=new SurfaceTextures(device);
 await assert.rejects(cache.load('/snow.png'),/bad mip shader/);assert.equal(device.textures[0].destroys,1);assert.equal(runtime.bitmaps[0].closes,1);assert.equal(cache.pendingCount,0);
 failed=false;await cache.load('/snow.png');assert.equal(cache.size,1);assert.equal(runtime.requests.length,2);cache.dispose();
});
