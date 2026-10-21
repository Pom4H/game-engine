/** Exercise production temporal resolve with broken motion/history texels on a real GPU. */
export async function verifyTemporalFinite(device,shader){
 const width=16,height=16,resources=[],own=r=>(resources.push(r),r);
 const image=format=>own(device.createTexture({size:[width,height],format,usage:0x04|0x02}));
 const current=image('rgba16float'),history=image('rgba16float'),velocity=image('rg16float');
 const depth=own(device.createTexture({size:[width,height],format:'depth32float',usage:0x04|0x10}));
 const output=own(device.createTexture({size:[width,height],format:'rgba8unorm',usage:0x01|0x10}));
 const params=own(device.createBuffer({size:32,usage:0x40|0x08})),readback=own(device.createBuffer({size:256*height,usage:0x01|0x08}));
 const module=device.createShaderModule({code:shader}),pipeline=device.createRenderPipeline({layout:'auto',vertex:{module,entryPoint:'vs'},fragment:{module,entryPoint:'fs',targets:[{format:'rgba8unorm'}]},primitive:{topology:'triangle-list'}});
 const sampler=device.createSampler({minFilter:'linear',magFilter:'linear'}),bind=device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:current.createView()},{binding:1,resource:history.createView()},{binding:2,resource:velocity.createView()},{binding:3,resource:depth.createView()},{binding:4,resource:sampler},{binding:5,resource:{buffer:params}}]});
 const cases=[];
 device.pushErrorScope('validation');let scopeOpen=true;
 try{
  for(const kind of ['normal','reset-poisoned-history','poisoned-history','nan-motion','infinite-motion','poisoned-current','reset-poisoned-current']){
   const colors=new Uint16Array(width*height*4),old=new Uint16Array(colors.length),vectors=new Uint16Array(width*height*2);
   for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const p=y*width+x,at=p*4;colors.set([0x3800,0x3a00,0x3400,0x3c00],at);old.set([0x3800,0x3a00,0x3400,0x3c00],at);
    const patch=x>=6&&x<=9&&y>=6&&y<=9;
    if(patch&&kind.includes('poisoned-history'))old.set([0x7e00,0x7e00,0x7e00],at);
    if(patch&&kind==='nan-motion')vectors[p*2]=0x7e00;
    if(patch&&kind==='infinite-motion')vectors[p*2]=0x7c00;
    if(patch&&kind==='poisoned-current')colors.set([0x7e00,0x7e00,0x7e00],at);
    if(x===8&&y===8&&kind==='reset-poisoned-current')colors.set([0x7e00,0x7e00,0x7e00],at);
   }
   device.queue.writeTexture({texture:current},colors,{bytesPerRow:width*8},[width,height]);device.queue.writeTexture({texture:history},old,{bytesPerRow:width*8},[width,height]);device.queue.writeTexture({texture:velocity},vectors,{bytesPerRow:width*4},[width,height]);
   device.queue.writeBuffer(params,0,new Float32Array([kind.startsWith('reset')?0:1,0,0,0,0,0,0,0]));
   const encoder=device.createCommandEncoder(),clear=encoder.beginRenderPass({colorAttachments:[],depthStencilAttachment:{view:depth.createView(),depthClearValue:.5,depthLoadOp:'clear',depthStoreOp:'store'}});clear.end();
   const pass=encoder.beginRenderPass({colorAttachments:[{view:output.createView(),loadOp:'clear',clearValue:{r:0,g:0,b:0,a:1},storeOp:'store'}]});pass.setPipeline(pipeline);pass.setBindGroup(0,bind);pass.draw(3);pass.end();encoder.copyTextureToBuffer({texture:output},{buffer:readback,bytesPerRow:256},[width,height]);device.queue.submit([encoder.finish()]);
   await readback.mapAsync(1);const pixels=new Uint8Array(readback.getMappedRange());let badPixels=0,blackPixels=0,maxError=0;
   for(let y=2;y<height-2;y++)for(let x=2;x<width-2;x++){
    const at=y*256+x*4,error=Math.max(Math.abs(pixels[at]-128),Math.abs(pixels[at+1]-191),Math.abs(pixels[at+2]-64));maxError=Math.max(maxError,error);if(error>1)badPixels++;if(Math.max(pixels[at],pixels[at+1],pixels[at+2])<8)blackPixels++;
   }
   readback.unmap();cases.push({kind,badPixels,blackPixels,maxError});
  }
  const error=await device.popErrorScope();scopeOpen=false;if(error)throw new Error(error.message);
  return{status:cases.every(c=>c.badPixels===0)?'passed':'failed',cases};
 }finally{if(scopeOpen)await device.popErrorScope();for(const r of resources)r.destroy();}
}
