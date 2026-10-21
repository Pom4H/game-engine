/** Browser/WebGPU regression using the production TAA shader and analytic
 * translated color ramps. Current raster samples contain jitter; history is
 * on the stable grid. Covers static/moving surfaces and invalidated history. */
export async function verifyTemporalResolve(device,shader){
 const width=16,height=16,resources=[],own=resource=>(resources.push(resource),resource);
 const texture=format=>own(device.createTexture({size:[width,height],format,usage:0x04|0x02}));
 const current=texture('rgba8unorm'),history=texture('rgba8unorm'),velocity=texture('rg16float');
 const depth=own(device.createTexture({size:[width,height],format:'depth32float',usage:0x04|0x10}));
 const output=own(device.createTexture({size:[width,height],format:'rgba8unorm',usage:0x01|0x10}));
 const params=own(device.createBuffer({size:32,usage:0x40|0x08})),readback=own(device.createBuffer({size:256*height,usage:0x01|0x08}));
 const module=device.createShaderModule({code:shader}),pipeline=device.createRenderPipeline({layout:'auto',vertex:{module,entryPoint:'vs'},fragment:{module,entryPoint:'fs',targets:[{format:'rgba8unorm'}]},primitive:{topology:'triangle-list'}});
 const sampler=device.createSampler({minFilter:'linear',magFilter:'linear'}),bind=device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:current.createView()},{binding:1,resource:history.createView()},{binding:2,resource:velocity.createView()},{binding:3,resource:depth.createView()},{binding:4,resource:sampler},{binding:5,resource:{buffer:params}}]});
 const bits=new Uint32Array(1),float=new Float32Array(bits.buffer),half=value=>{if(value===0)return 0;float[0]=value;const b=bits[0],e=((b>>>23)&255)-112;return((b>>>16)&32768)|(e<<10)|((b>>>13)&1023);};
 const jitters=[[0,-1/6],[-1/4,1/6],[1/4,-7/18],[-3/8,-1/18],[1/8,5/18],[-1/8,-5/18],[3/8,1/18],[-7/16,7/18]],cases=[];
 device.pushErrorScope('validation');let scopeOpen=true;
 try{
  for(const kind of ['static','moving','reset'])for(let index=0;index<jitters.length;index++){
   const j=jitters[index].map((v,k)=>v/[width,height][k]),previous=jitters[(index+7)%8].map((v,k)=>v/[width,height][k]),motion=kind==='moving'?[1/width,-1/height]:[0,0];
   const colors=new Uint8Array(width*height*4),old=new Uint8Array(colors.length),vectors=new Uint16Array(width*height*2);
   for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const at=(y*width+x)*4,u=(x+.5)/width,v=(y+.5)/height;
    colors.set([Math.round((u-j[0])*255),Math.round((v-j[1])*255),77,255],at);
    old.set([Math.round((u+motion[0])*255),Math.round((v+motion[1])*255),77,255],at);
    vectors.set([half(motion[0]+j[0]-previous[0]),half(motion[1]+j[1]-previous[1])],(y*width+x)*2);
   }
   device.queue.writeTexture({texture:current},colors,{bytesPerRow:width*4},[width,height]);device.queue.writeTexture({texture:history},old,{bytesPerRow:width*4},[width,height]);device.queue.writeTexture({texture:velocity},vectors,{bytesPerRow:width*4},[width,height]);
   device.queue.writeBuffer(params,0,new Float32Array([kind==='reset'?0:1,0,0,0,...j,...previous]));
   const encoder=device.createCommandEncoder(),clear=encoder.beginRenderPass({colorAttachments:[],depthStencilAttachment:{view:depth.createView(),depthClearValue:.5,depthLoadOp:'clear',depthStoreOp:'store'}});clear.end();
   const pass=encoder.beginRenderPass({colorAttachments:[{view:output.createView(),loadOp:'clear',clearValue:{r:0,g:0,b:0,a:1},storeOp:'store'}]});pass.setPipeline(pipeline);pass.setBindGroup(0,bind);pass.draw(3);pass.end();encoder.copyTextureToBuffer({texture:output},{buffer:readback,bytesPerRow:256},[width,height]);device.queue.submit([encoder.finish()]);
   await readback.mapAsync(1);const pixels=new Uint8Array(readback.getMappedRange());let maxError=0;
   for(let y=2;y<height-2;y++)for(let x=2;x<width-2;x++){const at=y*256+x*4;maxError=Math.max(maxError,Math.abs(pixels[at]-Math.round((x+.5)/width*255)),Math.abs(pixels[at+1]-Math.round((y+.5)/height*255)),Math.abs(pixels[at+2]-77));}
   readback.unmap();cases.push({kind,index,maxError});if(maxError>2)throw new Error(`TAA ${kind} sample ${index} drifted by ${maxError}/255`);
  }
  const error=await device.popErrorScope();scopeOpen=false;if(error)throw new Error(error.message);
  return{status:'passed',cases:cases.length,maxRgbErrorOutOf255:Math.max(...cases.map(c=>c.maxError)),coverage:['static with changing jitter','translated surface','invalidated history'],samples:cases};
 }finally{if(scopeOpen)await device.popErrorScope();for(const resource of resources)resource.destroy();}
}
