interface PendingTexture {
 readonly controller:AbortController;
 cancelled:boolean;
 promise:Promise<void>;
 bitmap:ImageBitmap|undefined;
 texture:any;
}
/** Browser/GPU ownership of optional image materials. Loading is explicit and
 * awaitable for deterministic captures; each live URL is decoded/uploaded once.
 * retain() releases obsolete scenes, including their unfinished uploads. */
export class SurfaceTextures {
 private readonly textures=new Map<string,any>();private readonly pending=new Map<string,PendingTexture>();private disposed=false;
 constructor(private readonly device:any,private readonly assetBase?:string){}
 get(url:string):any{return this.textures.get(url);}
 async load(url:string):Promise<void>{
  if(this.disposed)throw new Error('Material textures have been disposed');
  if(this.textures.has(url))return;
  const old=this.pending.get(url);if(old)return old.promise;
  const pending:PendingTexture={controller:new AbortController(),cancelled:false,promise:Promise.resolve(),bitmap:undefined,texture:undefined};
  pending.promise=this.upload(url,pending).finally(()=>{if(this.pending.get(url)===pending)this.pending.delete(url);});
  this.pending.set(url,pending);return pending.promise;
 }
 private cancel(pending:PendingTexture):void{
  pending.cancelled=true;pending.controller.abort();pending.texture?.destroy();pending.texture=undefined;pending.bitmap?.close();pending.bitmap=undefined;
 }
 private async upload(url:string,pending:PendingTexture):Promise<void>{
  try{
   const fetchURL=this.assetBase===undefined?url:new URL(url,this.assetBase).href;
   const response=await fetch(fetchURL,{signal:pending.controller.signal});if(pending.cancelled||this.disposed)return;
   if(!response.ok)throw new Error(`Material texture ${url}: HTTP ${response.status}`);
   const blob=await response.blob();if(pending.cancelled||this.disposed)return;
   // Decoding itself cannot be aborted, so immediately close any result belonging
   // to a canceled generation before allocating GPU resources.
   const bitmap=await createImageBitmap(blob);pending.bitmap=bitmap;if(pending.cancelled||this.disposed)return;
   const {width,height}=bitmap;if(width<1||height<1||width*height>16777216)throw new RangeError('Material texture exceeds 16 megapixels');
   const maxDimension=this.device.limits?.maxTextureDimension2D??8192;if(width>maxDimension||height>maxDimension)throw new RangeError('Material texture exceeds device dimensions');
   const levels=1+Math.floor(Math.log2(Math.max(width,height)));
   const texture=this.device.createTexture({size:[width,height],mipLevelCount:levels,format:'rgba8unorm',usage:0x04|0x02|0x10});pending.texture=texture;
   this.device.queue.copyExternalImageToTexture({source:bitmap},{texture},[width,height]);
   const shader=this.device.createShaderModule({code:`
    @group(0) @binding(0) var image:texture_2d<f32>;
    @group(0) @binding(1) var mipSampler:sampler;
    struct O {@builtin(position) p:vec4<f32>,@location(0) uv:vec2<f32>}
    @vertex fn vs(@builtin(vertex_index) i:u32)->O{let p=vec2<f32>(f32((i<<1u)&2u),f32(i&2u));var o:O;o.p=vec4<f32>(p*2.0-1.0,0,1);o.uv=vec2<f32>(p.x,1.0-p.y);return o;}
    @fragment fn fs(i:O)->@location(0) vec4<f32>{return textureSampleLevel(image,mipSampler,i.uv,0);}`});
   const info=await shader.getCompilationInfo();if(pending.cancelled||this.disposed)return;
   const errors=info.messages.filter((m:any)=>m.type==='error');if(errors.length)throw new Error(errors.map((m:any)=>m.message).join('\n'));
   const pipeline=this.device.createRenderPipeline({layout:'auto',vertex:{module:shader,entryPoint:'vs'},fragment:{module:shader,entryPoint:'fs',targets:[{format:'rgba8unorm'}]},primitive:{topology:'triangle-list'}});
   const sampler=this.device.createSampler({minFilter:'linear',magFilter:'linear'}),encoder=this.device.createCommandEncoder();
   for(let level=1;level<levels;level++){
    const bind=this.device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:texture.createView({baseMipLevel:level-1,mipLevelCount:1})},{binding:1,resource:sampler}]});
    const pass=encoder.beginRenderPass({colorAttachments:[{view:texture.createView({baseMipLevel:level,mipLevelCount:1}),loadOp:'clear',clearValue:{r:0,g:0,b:0,a:1},storeOp:'store'}]});pass.setPipeline(pipeline);pass.setBindGroup(0,bind);pass.draw(3);pass.end();
   }
   this.device.queue.submit([encoder.finish()]);this.textures.set(url,texture);pending.texture=undefined;
  }catch(error){if(!pending.cancelled&&!this.disposed)throw error;}
  finally{pending.texture?.destroy();pending.texture=undefined;pending.bitmap?.close();pending.bitmap=undefined;}
 }
 /** Call when the renderer switches/collects a scene. Subsequent explicit load()
  * may preload future assets; they survive until the next retention boundary. */
 retain(urls:ReadonlySet<string>):void{
  for(const [url,texture] of this.textures)if(!urls.has(url)){texture.destroy();this.textures.delete(url);}
  for(const [url,pending] of this.pending)if(!urls.has(url)){this.cancel(pending);this.pending.delete(url);}
 }
 get size(){return this.textures.size;}
 get pendingCount(){return this.pending.size;}
 dispose():void{if(this.disposed)return;this.disposed=true;for(const pending of this.pending.values())this.cancel(pending);this.pending.clear();for(const texture of this.textures.values())texture.destroy();this.textures.clear();}
}
