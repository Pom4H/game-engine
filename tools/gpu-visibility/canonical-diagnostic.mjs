import {WebGPURenderer} from '../../dist/render/webgpu.js';
import {createFixture,visibilityCamera,hash} from '../engine-compare/fixture.mjs';
import {requireHardware} from '../engine-compare/metrics.mjs';

async function readTarget(renderer,target){
 const width=target.width,height=target.height,row=Math.ceil(width*8/256)*256,device=renderer.device;
 const buffer=device.createBuffer({label:'diagnostic linear target',size:row*height,usage:1|8});
 try{
  const encoder=device.createCommandEncoder({label:'diagnostic target copy'});
  encoder.copyTextureToBuffer({texture:target},{buffer,bytesPerRow:row,rowsPerImage:height},[width,height,1]);device.queue.submit([encoder.finish()]);await buffer.mapAsync(1);
  const mapped=new Uint8Array(buffer.getMappedRange()),pixels=new Uint16Array(width*height*4);
  for(let y=0;y<height;y++)new Uint8Array(pixels.buffer,y*width*8,width*8).set(mapped.subarray(y*row,y*row+width*8));
  if(pixels.some(word=>(word&0x7c00)===0x7c00))throw new Error('Non-finite linear diagnostic target');
  return {width,height,pixels};
 }finally{buffer.unmap();buffer.destroy();}
}
function differences(before,after){
 if(before.width!==after.width||before.height!==after.height||before.pixels.length!==after.pixels.length)throw new Error('Diagnostic target extent changed');
 let changedChannels=0,maxEncodedError=0;const coordinates=[];
 for(let n=0;n<before.pixels.length;n++)if(before.pixels[n]!==after.pixels[n]){
  changedChannels++;maxEncodedError=Math.max(maxEncodedError,Math.abs(before.pixels[n]-after.pixels[n]));
  if(coordinates.length<12)coordinates.push({x:Math.floor(n/4)%after.width,y:Math.floor(n/4/after.width),channel:n%4,before:before.pixels[n],after:after.pixels[n]});
 }
 return {changedChannels,maxEncodedError,coordinates};
}
/** Readbacks occur after canonical capture, never in a measured frame. Full
 * target channels are compared without tolerance. This diagnoses repeatability
 * within each visibility mode; modes are not required to match each other. */
export async function diagnoseCanonical({count=5000,width=1920,height=1080,repetitions=6}={}){
 const adapter=await navigator.gpu.requestAdapter({powerPreference:'high-performance'}),info=adapter.info;
 const adapterInfo={vendor:info.vendor,architecture:info.architecture,description:info.description,isFallbackAdapter:adapter.isFallbackAdapter};requireHardware(adapterInfo);
 const fixture=await createFixture(count),canvas=document.querySelector('canvas'),copy=document.createElement('canvas');copy.width=width;copy.height=height;
 const ctx=copy.getContext('2d',{willReadFrequently:true}),runs=[];
 for(const mode of ['gpu','cpu-batched']){
  let reference;
  for(let repetition=0;repetition<repetitions;repetition++){
   const renderer=await WebGPURenderer.create(canvas,{visibility:mode,profiling:false});
   try{
    renderer.setResolution(width,height);await renderer.prepareMaterials(fixture.scene);
    // Reproduce the camera/history preceding the benchmark's independent view.
    for(let frame=0;frame<288;frame++){renderer.setTimelineFrame(frame);renderer.render(fixture.scene,visibilityCamera(frame,'camera-motion'));await renderer.flush();}
    renderer.resetTemporalHistory();
    for(let frame=0;frame<32;frame++){
     renderer.setTimelineFrame(frame);renderer.render(fixture.scene,visibilityCamera(0));if(frame===31)ctx.drawImage(canvas,0,0);await renderer.flush();
    }
    const stages={presentation:{width,height,pixels:ctx.getImageData(0,0,width,height).data.slice()},hdr:await readTarget(renderer,renderer.hdr),normal:await readTarget(renderer,renderer.normal),effects:await readTarget(renderer,renderer.effectsHdr),taa:await readTarget(renderer,renderer.taaHistoryIndex===0?renderer.taaA:renderer.taaB)};
    const inspect=renderer.inspect(false);if(inspect.errors.length)throw new Error(inspect.errors.join('\n'));
    const afterHash=await hash(fixture.scene.snapshot());if(afterHash!==fixture.replayHash)throw new Error('Diagnostic rendering mutated physics');
    const result={mode,repetition,afterHash,stages:{}};
    for(const [name,stage] of Object.entries(stages))result.stages[name]={width:stage.width,height:stage.height,hash:await hash(stage.pixels),encoding:name==='presentation'?'rgba8':'rgba16float raw words',comparison:reference?differences(reference[name],stage):null};
    if(!reference)reference=stages;runs.push(result);
   }finally{renderer.dispose();renderer.device.destroy();}
  }
 }
 return {status:'completed',controls:{count,width,height,repetitions,warmupMotionFrames:288,canonicalFrames:32},adapter:adapterInfo,sourceHash:fixture.sourceHash,geometryHash:fixture.geometryHash,replayHash:fixture.replayHash,runs,
  interpretation:'Fresh device per capture; GPU and ordered CPU-batched visibility are compared within their own repeated canonical captures. Full linear target words and presentation channels, zero tolerance. GPU journal hooks are not installed; warmup waits for each submission rather than using the benchmark RAF loop. This is a diagnostic with queue waits and readbacks; it provides no performance result. A stable sample cannot prove that intermittent variation is eliminated.'};
}
