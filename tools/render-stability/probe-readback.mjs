// The production probe is sampled by materials and deliberately has no COPY_SRC
// usage. Read every mip-zero texel through that same public sampling capability.
const SHADER=`
@group(0) @binding(0) var source:texture_cube<f32>;
@group(0) @binding(1) var nearestSampler:sampler;
@group(0) @binding(2) var<storage,read_write> pixels:array<vec4<f32>>;
fn cubeDirection(face:u32,p:vec2<f32>)->vec3<f32>{
 switch face {
  case 0u: {return vec3<f32>(1,-p.y,-p.x);}
  case 1u: {return vec3<f32>(-1,-p.y,p.x);}
  case 2u: {return vec3<f32>(p.x,1,p.y);}
  case 3u: {return vec3<f32>(p.x,-1,-p.y);}
  case 4u: {return vec3<f32>(p.x,-p.y,1);}
  default: {return vec3<f32>(-p.x,-p.y,-1);}
 }
}
@compute @workgroup_size(8,8) fn main(@builtin(global_invocation_id) id:vec3<u32>){
 let size=textureDimensions(source);
 if(id.x>=size.x||id.y>=size.y||id.z>=6u){return;}
 let p=(vec2<f32>(id.xy)+.5)/vec2<f32>(size)*2.-1.;
 pixels[(id.z*size.y+id.y)*size.x+id.x]=textureSampleLevel(source,nearestSampler,cubeDirection(id.z,p),0);
}`;

function wordsFor(cube){
 if(!Number.isSafeInteger(cube?.size)||cube.size<=0||!(cube.words instanceof Uint32Array)||cube.words.length!==cube.size*cube.size*6*4)throw new TypeError('Expected all six square RGBA probe faces');
 for(const bits of cube.words)if((bits&0x7f800000)===0x7f800000)throw new Error('Non-finite published probe pixel');
 return cube.words;
}

export function inspectProbePixels(cube){
 const words=wordsFor(cube),values=new Float32Array(words.buffer,words.byteOffset,words.length);let nonblackPixels=0,min=Infinity,max=-Infinity;
 for(let pixel=0;pixel<words.length;pixel+=4){let lit=false;for(let c=0;c<3;c++){const value=values[pixel+c];min=Math.min(min,value);max=Math.max(max,value);lit||=value>.0001;}if(lit)nonblackPixels++;}
 return{size:cube.size,faces:6,checkedChannels:words.length,nonFinite:0,nonblackPixels,minRgb:min,maxRgb:max};
}

export function compareProbePixels(before,after){
 const a=wordsFor(before),b=wordsFor(after);if(before.size!==after.size)throw new RangeError('Probe dimensions changed during comparison');
 const av=new Float32Array(a.buffer,a.byteOffset,a.length),bv=new Float32Array(b.buffer,b.byteOffset,b.length);
 let changedChannels=0,changedRgbChannels=0,changedPixels=0,maxAbsError=0,maxRgbError=0,sumSquaredError=0;
 for(let pixel=0;pixel<a.length;pixel+=4){let changed=false;for(let c=0;c<4;c++){
  const i=pixel+c,error=Math.abs(av[i]-bv[i]);maxAbsError=Math.max(maxAbsError,error);sumSquaredError+=error*error;
  if(c<3)maxRgbError=Math.max(maxRgbError,error);
  if(a[i]!==b[i]){changed=true;changedChannels++;if(c<3)changedRgbChannels++;}
 }if(changed)changedPixels++;}
 return{checkedChannels:a.length,changedChannels,changedRgbChannels,changedPixels,maxAbsError,maxRgbError,rmsError:Math.sqrt(sumSquaredError/a.length)};
}

export async function createProbeReader(device,texture){
 const size=texture.width;if(size!==texture.height||texture.depthOrArrayLayers!==6)throw new TypeError('Expected a six-face cube texture');
 const module=device.createShaderModule({label:'probe pixel stability readback',code:SHADER}),info=await module.getCompilationInfo();
 const errors=info.messages.filter(message=>message.type==='error');if(errors.length)throw new Error(errors.map(message=>message.message).join('\n'));
 const pipeline=await device.createComputePipelineAsync({label:'probe pixel stability readback',layout:'auto',compute:{module,entryPoint:'main'}});
 const bytes=size*size*6*16,pixels=device.createBuffer({label:'sampled probe pixels',size:bytes,usage:0x80|0x04}),readback=device.createBuffer({label:'mapped probe pixels',size:bytes,usage:0x01|0x08});
 const bind=device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:texture.createView({dimension:'cube',baseMipLevel:0,mipLevelCount:1})},{binding:1,resource:device.createSampler({minFilter:'nearest',magFilter:'nearest',mipmapFilter:'nearest'})},{binding:2,resource:{buffer:pixels}}]});
 return{
  async read(){
   const encoder=device.createCommandEncoder({label:'published probe pixel readback'}),pass=encoder.beginComputePass();
   pass.setPipeline(pipeline);pass.setBindGroup(0,bind);pass.dispatchWorkgroups(Math.ceil(size/8),Math.ceil(size/8),6);pass.end();
   encoder.copyBufferToBuffer(pixels,0,readback,0,bytes);device.queue.submit([encoder.finish()]);
   await readback.mapAsync(1);try{return{size,words:new Uint32Array(readback.getMappedRange()).slice()};}finally{readback.unmap();}
  },
  dispose(){pixels.destroy();readback.destroy();},
 };
}
