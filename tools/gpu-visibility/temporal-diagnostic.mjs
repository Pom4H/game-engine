import {WebGPURenderer} from '../../dist/render/webgpu.js';
import {createFixture,visibilityCamera,hash} from '../engine-compare/fixture.mjs';
import {requireHardware} from '../engine-compare/metrics.mjs';
import {colorCopyPlan,decodeColorCopy} from './color-copy.mjs';

// Read textures without adding COPY_SRC to production resources. RG16 values
// round-trip through pack2x16float; depth retains its exact f32 representation.
export class InputReader {
 constructor(device,width,height){
  this.device=device;this.width=width;this.height=height;this.bytes=width*height*4;
  this.output=device.createBuffer({label:'temporal diagnostic words',size:this.bytes,usage:0x80|0x04});
  this.readback=device.createBuffer({label:'temporal diagnostic readback',size:this.bytes,usage:0x01|0x08});
  this.pipelines={};
  for(const [kind,type,value] of [['velocity','texture_2d<f32>','pack2x16float(textureLoad(source,p,0).xy)'],['depth','texture_depth_2d','bitcast<u32>(textureLoad(source,p,0))'],['specular','texture_2d<f32>','pack4x8unorm(textureLoad(source,p,0))']]){
   const module=device.createShaderModule({label:'diagnostic '+kind,code:`
@group(0) @binding(0) var source:${type};
@group(0) @binding(1) var<storage,read_write> words:array<u32>;
@compute @workgroup_size(8,8) fn main(@builtin(global_invocation_id) id:vec3<u32>){
 let size=textureDimensions(source);if(any(id.xy>=size)){return;}let p=vec2<i32>(id.xy);words[id.y*size.x+id.x]=${value};
}`});
   this.pipelines[kind]=device.createComputePipeline({label:'diagnostic '+kind,layout:'auto',compute:{module,entryPoint:'main'}});
  }
 }
 encodePacked(encoder,target,kind,output=this.output,readback=this.readback){
  const pipeline=this.pipelines[kind],bind=this.device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:target.createView()},{binding:1,resource:{buffer:output}}]});
  const pass=encoder.beginComputePass();pass.setPipeline(pipeline);pass.setBindGroup(0,bind);pass.dispatchWorkgroups(Math.ceil(this.width/8),Math.ceil(this.height/8));pass.end();encoder.copyBufferToBuffer(output,0,readback,0,this.bytes);
 }
 async readPacked(target,kind){
  const encoder=this.device.createCommandEncoder({label:'diagnostic '+kind});this.encodePacked(encoder,target,kind);this.device.queue.submit([encoder.finish()]);
  try{
   await this.readback.mapAsync(1);const bytes=new Uint8Array(this.readback.getMappedRange()).slice();
   const pixels=kind==='velocity'?new Uint16Array(bytes.buffer):kind==='specular'?bytes:new Uint32Array(bytes.buffer);
   const mask=kind==='velocity'?0x7c00:0x7f800000;if(kind!=='specular'&&pixels.some(word=>(word&mask)===mask))throw new Error('Non-finite '+kind);
   return {width:this.width,height:this.height,channels:kind==='velocity'?2:kind==='specular'?4:1,encoding:kind==='velocity'?'rg16float raw words':kind==='specular'?'rgba8unorm raw words':'depth32float raw words',pixels};
  }finally{this.readback.unmap();}
 }
 async readColor(target){
  if(target.width!==this.width||target.height!==this.height)throw new Error('Unexpected floating color read extent');
  const plan=colorCopyPlan(target.format,this.width,this.height),buffer=this.device.createBuffer({size:plan.bytes,usage:1|8});
  try{
   const encoder=this.device.createCommandEncoder({label:'diagnostic radiance copy'});encoder.copyTextureToBuffer({texture:target},{buffer,bytesPerRow:plan.row,rowsPerImage:this.height},[this.width,this.height,1]);this.device.queue.submit([encoder.finish()]);await buffer.mapAsync(1);
   return decodeColorCopy(new Uint8Array(buffer.getMappedRange()),plan);
  }finally{buffer.unmap();buffer.destroy();}
 }
 destroy(){this.output.destroy();this.readback.destroy();}
}
export async function transform(bytes,stream){return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());}
export function differences(before,after){
 if(before.width!==after.width||before.height!==after.height||before.channels!==after.channels||before.pixels.length!==after.pixels.length)throw new Error('Temporal input extent changed');
 let changedChannels=0,maxEncodedError=0;const coordinates=[];
 for(let n=0;n<after.pixels.length;n++)if(before.pixels[n]!==after.pixels[n]){
  changedChannels++;maxEncodedError=Math.max(maxEncodedError,Math.abs(before.pixels[n]-after.pixels[n]));
  if(coordinates.length<12)coordinates.push({x:Math.floor(n/after.channels)%after.width,y:Math.floor(n/after.channels/after.width),channel:n%after.channels,before:before.pixels[n],after:after.pixels[n]});
 }
 return {changedChannels,maxEncodedError,coordinates};
}
export async function diagnoseTemporal({count=5000,width=1920,height=1080,repetitions=3}={}){
 const adapter=await navigator.gpu.requestAdapter({powerPreference:'high-performance'}),info=adapter.info;
 const adapterInfo={vendor:info.vendor,architecture:info.architecture,description:info.description,isFallbackAdapter:adapter.isFallbackAdapter};requireHardware(adapterInfo);
 const fixture=await createFixture(count),canvas=document.querySelector('canvas'),runs=[];
 for(const mode of ['gpu','cpu-batched']){
  // At most 32 frames of losslessly compressed host references. They never
  // become a render input; no reference textures occupy production VRAM.
  const reference=[];
  for(let repetition=0;repetition<repetitions;repetition++){
   const renderer=await WebGPURenderer.create(canvas,{visibility:mode,profiling:false});let reader;
   try{
    renderer.setResolution(width,height);await renderer.prepareMaterials(fixture.scene);
    for(let frame=0;frame<288;frame++){renderer.setTimelineFrame(frame);renderer.render(fixture.scene,visibilityCamera(frame,'camera-motion'));await renderer.flush();}
    renderer.resetTemporalHistory();reader=new InputReader(renderer.device,width,height);const frames=[];
    for(let frame=0;frame<32;frame++){
     renderer.setTimelineFrame(frame);renderer.render(fixture.scene,visibilityCamera(0));await renderer.flush();
     const stages={opaque:await reader.readColor(renderer.opaqueScene),hdr:await reader.readColor(renderer.hdr),current:await reader.readColor(renderer.effectsHdr),velocity:await reader.readPacked(renderer.velocity,'velocity'),depth:await reader.readPacked(renderer.depth,'depth'),taa:await reader.readColor(renderer.taaHistoryIndex===0?renderer.taaA:renderer.taaB)};
     const result={frame,stages:{}};
     for(const [name,stage] of Object.entries(stages)){
      let comparison=null;const bytes=new Uint8Array(stage.pixels.buffer),digest=await hash(bytes);
      if(repetition===0){
       const compressed=await transform(bytes,new CompressionStream('deflate-raw'));(reference[frame]??={})[name]={width,height,channels:stage.channels,encoding:stage.encoding,hash:digest,compressed};
      }else{
       const old=reference[frame][name];if(digest!==old.hash){
        const bytes=await transform(old.compressed,new DecompressionStream('deflate-raw'));const pixels=stage.encoding.startsWith('depth')?new Uint32Array(bytes.buffer):new Uint16Array(bytes.buffer);comparison=differences({...old,pixels},stage);
       }else comparison={changedChannels:0,maxEncodedError:0,coordinates:[]};
      }
      result.stages[name]={hash:digest,channels:stage.channels,encoding:stage.encoding,comparison};
     }
     frames.push(result);
    }
    const afterHash=await hash(fixture.scene.snapshot());if(afterHash!==fixture.replayHash)throw new Error('Temporal diagnosis mutated physics');const inspect=renderer.inspect(false);if(inspect.errors.length)throw new Error(inspect.errors.join('\n'));
    runs.push({mode,repetition,afterHash,frames,stages:frames.at(-1).stages,firstDivergentFrame:frames.find(f=>Object.values(f.stages).some(s=>s.comparison?.changedChannels>0))?.frame??null,referenceCompressedBytes:reference.reduce((n,f)=>n+Object.values(f).reduce((m,s)=>m+s.compressed.length,0),0)});
    console.info('TEMPORAL_DIAGNOSTIC '+JSON.stringify({mode,repetition,firstDivergentFrame:runs.at(-1).firstDivergentFrame}));
   }finally{reader?.destroy();renderer.dispose();renderer.device.destroy();}
  }
 }
 return {status:'completed',controls:{count,width,height,repetitions,warmupMotionFrames:288,canonicalFrames:32},adapter:adapterInfo,sourceHash:fixture.sourceHash,geometryHash:fixture.geometryHash,replayHash:fixture.replayHash,runs,
  interpretation:'Fresh device per capture; every canonical frame captures HDR and all direct TAA inputs/output (current color, velocity, depth, output history). Same-mode SHA256 matches certify identical bytes; mismatches are losslessly decompressed and every raw channel compared with zero tolerance. Diagnostic compute only reads production velocity/depth after render completion, without modifying texture usage or feeding observations back into rendering. References are compressed host data, bounded to 32 frames per mode. Queue waits and readbacks make this a correctness diagnostic, not a performance measurement. A stable sample cannot eliminate intermittent variation.'};
}
