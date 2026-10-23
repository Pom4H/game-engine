import {differences} from './temporal-diagnostic.mjs';

import {MATERIAL_UNIFORM_WORDS} from '../../dist/render/material-layout.js';
export {MATERIAL_UNIFORM_WORDS};
const bytes=MATERIAL_UNIFORM_WORDS*4;
const materialBuffer=buffer=>buffer?.size===bytes&&(buffer.usage&0x40)!==0;

/** Mirror observed host writes only. Typed-array source offsets/sizes are in
 * elements; ArrayBuffer/DataView offsets/sizes are in bytes. No unwritten byte
 * is accepted as a host reference, even when the GPU buffer initializes to zero. */
export class UniformUploadLedger {
 constructor(){this.entries=new Map();}
 capture(buffer,bufferOffset,data,dataOffset=0,size){
  if(!materialBuffer(buffer))return false;
  const view=ArrayBuffer.isView(data),elementSize=view?(data.BYTES_PER_ELEMENT??1):1,total=data.byteLength;
  const start=dataOffset*elementSize,length=size===undefined?total-start:size*elementSize;
  if(![bufferOffset,dataOffset,start,length,total].every(Number.isSafeInteger)||bufferOffset<0||dataOffset<0||length<0||start+length>total||bufferOffset+length>bytes||bufferOffset%4||length%4)throw new Error('Invalid material uniform host write');
  const source=new Uint8Array(view?data.buffer:data,(view?data.byteOffset:0)+start,length);
  let entry=this.entries.get(buffer);if(!entry){entry={data:new Uint8Array(bytes),written:new Uint8Array(bytes)};this.entries.set(buffer,entry);}
  entry.data.set(source,bufferOffset);entry.written.fill(1,bufferOffset,bufferOffset+length);return true;
 }
 snapshot(buffer){
  const entry=this.entries.get(buffer);if(!entry||entry.written.some(value=>value!==1))throw new Error('Missing complete material uniform host uploads');
  return new Uint32Array(entry.data.slice().buffer);
 }
}

/** Observe the actual binding-0 material buffer at each opaque draw, then read
 * its words immediately after pass end in the same encoder. Render shaders and
 * buffer usages are untouched. These debug dispatches alter GPU scheduling. */
export class MaterialUniformObserver {
 constructor(renderer){
  this.renderer=renderer;this.device=renderer.device;this.ledger=new UniformUploadLedger();this.groups=new WeakMap();this.targets=new Map();this.armed=false;
  if(renderer.objects.size)throw new Error('Install material observer before object preparation');
  const device=this.device,module=device.createShaderModule({label:'material uniform words',code:`
struct MaterialWords {words:array<vec4<u32>,${MATERIAL_UNIFORM_WORDS/4}>};
@group(0) @binding(0) var<uniform> source:MaterialWords;
@group(0) @binding(1) var<storage,read_write> output:array<u32>;
@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) id:vec3<u32>){
 let n=id.x;if(n<arrayLength(&output)){output[n]=source.words[n/4u][n%4u];}
}`});
  this.pipeline=device.createComputePipeline({label:'material uniform words',layout:'auto',compute:{module,entryPoint:'main'}});
  this.originalWrite=device.queue.writeBuffer;this.originalBind=device.createBindGroup;this.originalCreate=device.createCommandEncoder;
  const observer=this;
  device.queue.writeBuffer=function(...args){observer.ledger.capture(...args);return observer.originalWrite.apply(this,args);};
  device.createBindGroup=function(descriptor){
   const group=observer.originalBind.call(this,descriptor),resource=descriptor.entries.find(entry=>entry.binding===0)?.resource;
   if(materialBuffer(resource?.buffer)){
    if((resource.offset??0)!==0||(resource.size??bytes)!==bytes)throw new Error('Material uniform binding offset/size changed');
    observer.groups.set(group,resource.buffer);
   }return group;
  };
  device.createCommandEncoder=function(descriptor){
   const encoder=observer.originalCreate.call(this,descriptor),begin=encoder.beginRenderPass;
   encoder.beginRenderPass=function(descriptor){
    const pass=begin.call(this,descriptor);if(descriptor.label!=='render.main.opaque'||!observer.armed)return pass;
    observer.opaquePasses++;let pipeline,group;
    const setPipeline=pass.setPipeline,setBind=pass.setBindGroup,end=pass.end;
    pass.setPipeline=function(value){pipeline=value;return setPipeline.call(this,value);};
    pass.setBindGroup=function(index,value,...offsets){
     if(index===0){group=value;if(observer.groups.has(value)&&offsets.length&&offsets[0]?.length)throw new Error('Material dynamic uniform offsets are unsupported');}
     return setBind.call(this,index,value,...offsets);
    };
    for(const method of ['draw','drawIndexed','drawIndirect','drawIndexedIndirect']){
     const original=pass[method];pass[method]=function(...args){observer.captureDraw(pipeline,group);return original.call(this,...args);};
    }
    pass.end=function(){end.call(this);observer.encode(encoder);};return pass;
   };return encoder;
  };
 }
 beginFrame(){if(this.armed)throw new Error('Material observation already armed');this.armed=true;this.opaquePasses=0;this.draws=[];this.sources=new Map();}
 captureDraw(pipeline,group){
  const label=pipeline?.label;if(label==='sky')return;
  if(typeof label!=='string'||(!label.startsWith('material ')&&!label.startsWith('surface relief ')&&!label.startsWith('coating overlay ')))throw new Error('Unexpected opaque material pipeline');
  const buffer=this.groups.get(group);if(!buffer)throw new Error('Opaque material draw has no observed uniform binding');
  const ids=[...this.renderer.objects].filter(([,object])=>object.uniform===buffer).map(([id])=>id);if(ids.length!==1)throw new Error('Ambiguous material uniform source object');
  const objectId=ids[0],host=this.ledger.snapshot(buffer),hostStage='materialUniformHost:'+objectId+':'+this.draws.length,gpuStage='materialUniform:'+objectId;
  this.draws.push({objectId,pipeline:label,buffer,host,hostStage,gpuStage});this.sources.set(buffer,{objectId,gpuStage});
 }
 encode(encoder){
  if(this.opaquePasses!==1||!this.draws.length)throw new Error('Missing opaque material draws');
  for(const [buffer,source] of this.sources){
   let target=this.targets.get(buffer);if(!target){target={output:this.device.createBuffer({label:'material words '+source.objectId,size:bytes,usage:0x80|0x04}),readback:this.device.createBuffer({label:'material readback '+source.objectId,size:bytes,usage:0x01|0x08})};this.targets.set(buffer,target);}
   const bind=this.device.createBindGroup({layout:this.pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer}},{binding:1,resource:{buffer:target.output}}]});
   const pass=encoder.beginComputePass();pass.setPipeline(this.pipeline);pass.setBindGroup(0,bind);pass.dispatchWorkgroups(2);pass.end();encoder.copyBufferToBuffer(target.output,0,target.readback,0,bytes);
  }
 }
 async read(){
  if(!this.armed||this.opaquePasses!==1||!this.draws.length)throw new Error('Incomplete material uniform observation');
  this.armed=false;const stages={},draws=[],actual=new Map(),stage=pixels=>({width:MATERIAL_UNIFORM_WORDS,height:1,channels:1,encoding:'uint32 material uniform words',pixels});
  for(const [buffer,source] of this.sources){
   const target=this.targets.get(buffer);try{await target.readback.mapAsync(1);const pixels=new Uint32Array(target.readback.getMappedRange().slice(0));actual.set(buffer,pixels);stages[source.gpuStage]=stage(pixels);}finally{target.readback.unmap();}
  }
  for(const draw of this.draws){
   const expected=stage(draw.host),observed=stage(actual.get(draw.buffer));stages[draw.hostStage]=expected;
   draws.push({objectId:draw.objectId,pipeline:draw.pipeline,hostStage:draw.hostStage,gpuStage:draw.gpuStage,checkedWords:MATERIAL_UNIFORM_WORDS,...differences(expected,observed)});
  }
  return{stages,checks:{opaquePasses:this.opaquePasses,expectedDraws:this.renderer.drawCalls,uniformWords:MATERIAL_UNIFORM_WORDS,uniqueBindings:this.sources.size,checkedWords:draws.length*MATERIAL_UNIFORM_WORDS,draws}};
 }
 destroy(){
  this.device.createCommandEncoder=this.originalCreate;this.device.createBindGroup=this.originalBind;this.device.queue.writeBuffer=this.originalWrite;
  for(const target of this.targets.values()){target.output.destroy();target.readback.destroy();}this.ledger.entries.clear();
 }
}
