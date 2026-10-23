import {halfToFloat} from '../engine-compare/fixture.mjs';
import {differences} from './temporal-diagnostic.mjs';

// All finite binary16 values convert exactly to binary32. Compare the complete
// float bit pattern, including signed zero, without WGSL half packing or an
// arbitrary tolerance. Non-finite texture values fail the regular InputReader.
const floats=Float32Array.from({length:65536},(_,word)=>halfToFloat(word));
const halfWords=new Uint32Array(floats.buffer);

/** Independent textureLoad -> f32 bitcast -> storage observation. No production
 * shader, texture usage, state or render dependency changes. GPU buffers are
 * reused, and observations are never fed back into rendering. */
export class ColorReadbackCheck {
 constructor(device,width,height){
  this.device=device;this.width=width;this.height=height;this.bytes=width*height*16;
  this.output=device.createBuffer({label:'independent color words',size:this.bytes,usage:0x80|0x04});
  this.readback=device.createBuffer({label:'independent color readback',size:this.bytes,usage:0x01|0x08});
  const module=device.createShaderModule({label:'independent color textureLoad',code:`
@group(0) @binding(0) var source:texture_2d<f32>;
@group(0) @binding(1) var<storage,read_write> words:array<vec4<u32>>;
@compute @workgroup_size(8,8) fn main(@builtin(global_invocation_id) id:vec3<u32>){
 let size=textureDimensions(source);if(any(id.xy>=size)){return;}
 words[id.y*size.x+id.x]=bitcast<vec4<u32>>(textureLoad(source,vec2<i32>(id.xy),0));
}`});
  const bindLayout=device.createBindGroupLayout({entries:[{binding:0,visibility:4,texture:{sampleType:'unfilterable-float'}},{binding:1,visibility:4,buffer:{type:'storage'}}]});
  this.pipeline=device.createComputePipeline({label:'independent color textureLoad',layout:device.createPipelineLayout({bindGroupLayouts:[bindLayout]}),compute:{module,entryPoint:'main'}});
 }
 async readWords(target){
  if(target.width!==this.width||target.height!==this.height)throw new Error('Unexpected readback extent');
  const bind=this.device.createBindGroup({layout:this.pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:target.createView()},{binding:1,resource:{buffer:this.output}}]});
  const encoder=this.device.createCommandEncoder({label:'independent color observation'}),pass=encoder.beginComputePass();
  pass.setPipeline(this.pipeline);pass.setBindGroup(0,bind);pass.dispatchWorkgroups(Math.ceil(this.width/8),Math.ceil(this.height/8));pass.end();
  encoder.copyBufferToBuffer(this.output,0,this.readback,0,this.bytes);this.device.queue.submit([encoder.finish()]);
  let actual;try{await this.readback.mapAsync(1);actual=new Uint32Array(this.readback.getMappedRange().slice(0));}finally{this.readback.unmap();}
  return actual;
 }
 async check(target,first,reader){
  if(!['rgba16float','rgba32float'].includes(target.format)||first.encoding!==target.format+' raw words'||first.width!==this.width||first.height!==this.height||first.channels!==4)throw new Error('Unexpected readback check format/extent');
  const actual=await this.readWords(target),expected=target.format==='rgba32float'?first.pixels:Uint32Array.from(first.pixels,word=>halfWords[word]);
  const compute=differences({...first,pixels:expected},{...first,pixels:actual});
  const repeatedCopy=differences(first,await reader.readColor(target));
  return{checkedChannels:first.pixels.length,compute,repeatedCopy};
 }
 async checkVelocity(target,first,reader){
  if(target.format!=='rg16float'||first.encoding!=='rg16float raw words'||first.width!==this.width||first.height!==this.height||first.channels!==2)throw new Error('Unexpected velocity readback check format/extent');
  const words=await this.readWords(target),actual=Uint32Array.from({length:first.pixels.length},(_,n)=>words[Math.floor(n/2)*4+n%2]),expected=Uint32Array.from(first.pixels,word=>halfWords[word]);
  const compute=differences({...first,pixels:expected},{...first,pixels:actual}),repeatedCopy=differences(first,await reader.readPacked(target,'velocity'));
  return{checkedChannels:first.pixels.length,compute,repeatedCopy};
 }
 destroy(){this.output.destroy();this.readback.destroy();}
}
