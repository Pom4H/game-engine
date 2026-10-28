import {Scene} from '../../dist/scene/scene.js';
import {WebGPURenderer} from '../../dist/render/webgpu.js';
import {visibilityScene,visibilityCamera} from './scene.mjs';

const stats=values=>{const sorted=[...values].sort((a,b)=>a-b),at=q=>sorted[Math.floor((sorted.length-1)*q)];return{p50:at(.5),p95:at(.95),mean:values.reduce((a,b)=>a+b,0)/values.length};};
const hash=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value)))),b=>b.toString(16).padStart(2,'0')).join('');
const raf=()=>new Promise(resolve=>requestAnimationFrame(resolve));
const canvas=document.querySelector('canvas');
const referencePixels=new Map();
function comparePixels(mode,key){
 const copy=document.createElement('canvas');copy.width=canvas.width;copy.height=canvas.height;const ctx=copy.getContext('2d',{willReadFrequently:true});ctx.drawImage(canvas,0,0);const pixels=ctx.getImageData(0,0,copy.width,copy.height).data;
 if(mode==='cpu'){referencePixels.set(key,pixels);return null;}
 const reference=referencePixels.get(key);if(!reference)throw new Error('Missing CPU pixel reference');
 let maxError=0,squared=0,different=0;for(let n=0;n<pixels.length;n++){const error=Math.abs(pixels[n]-reference[n]);maxError=Math.max(maxError,error);squared+=error*error;if(error)different++;}
 return{maxError,rmsError:Math.sqrt(squared/pixels.length),differentChannels:different,totalChannels:pixels.length};
}
globalThis.runVisibilityBenchmark=async({count,mode,scenario='static',width=1920,height=1080,frames=120,warmup=32})=>{
 const adapter=await navigator.gpu?.requestAdapter({powerPreference:'high-performance'});if(!adapter)throw new Error('No WebGPU adapter');
 const info=adapter.info??await adapter.requestAdapterInfo?.()??{};
 const adapterInfo={vendor:info.vendor,architecture:info.architecture,device:info.device,description:info.description,isFallbackAdapter:adapter.isFallbackAdapter??info.isFallbackAdapter??false};
 if(adapterInfo.isFallbackAdapter||/swiftshader|lavapipe|llvmpipe|software|microsoft basic render/i.test(JSON.stringify(adapterInfo)))throw new Error('Software adapter rejected: '+JSON.stringify(adapterInfo));
 const scene=new Scene(visibilityScene(count)),renderer=await WebGPURenderer.create(canvas,{profiling:true,visibility:mode});
 try{
  renderer.setResolution(width,height);await renderer.prepareMaterials(scene);
  // Replay is identical and outside measured rendering; rendering must not alter it.
  for(let tick=0;tick<60;tick++)scene.step(1/60);
  const replayHash=await hash(scene.snapshot()),cpu=[],uploads=[],instanceUploads=[],visibilityUploads=[],intervals=[],culling=[];let previous;
  for(let frame=0;frame<warmup+frames;frame++){
   const at=await raf();if(frame===warmup){renderer.resetProfile();previous=undefined;}
   renderer.setTimelineFrame(frame);renderer.render(scene,visibilityCamera(frame,scenario));
   if(frame>=warmup){
    if(previous!==undefined)intervals.push(at-previous);previous=at;
    const sample=renderer.profileLatest().cpu;cpu.push(sample.totalMs);culling.push((sample.quanta.cull??0)+(sample.quanta['encode.visibility']??0));uploads.push(sample.work.uploadBytes);instanceUploads.push(sample.work.instanceUploadBytes);visibilityUploads.push(sample.work.visibilityUploadBytes);
   }
  }
  await renderer.flush();await new Promise(resolve=>setTimeout(resolve,0));const profile=renderer.profile(),render=renderer.inspect(false);
  if(!profile.timestampQueries||!profile.gpuFrames)throw new Error('GPU timestamps are required for crossover evidence');
  const measuredPixelComparison=comparePixels(mode,count+':'+scenario+':measured');
  if(render.errors.length)throw new Error('Renderer validation errors: '+render.errors.join('\n'));
  // Capture the same timeline jitter, camera, history and linear pixels for all modes.
  renderer.resetTemporalHistory();
  for(let frame=0;frame<16;frame++){renderer.setTimelineFrame(frame);renderer.render(scene,visibilityCamera(0));await renderer.flush();}
  const points=[];for(let y=0;y<16;y++)for(let x=0;x<32;x++)points.push([Math.floor((x+.5)*width/32),Math.floor((y+.5)*height/16)]);
  const linear=await renderer.sampleLinearPixels(points,'taa'),png=canvas.toDataURL('image/png');
  const pixelComparison=comparePixels(mode,count+':'+scenario+':canonical');
  const afterHash=await hash(scene.snapshot());if(replayHash!==afterHash)throw new Error('Rendering changed physical replay');
  const qualityRender=renderer.inspect(false);
  globalThis.visibilityImage=png;
  return{count,mode,scenario,width,height,frames,warmup,adapter:adapterInfo,replayHash,afterHash,sourceHash:await hash(visibilityScene(count)),cpuMs:stats(cpu),cpuCullingMs:stats(culling),frameIntervalMs:stats(intervals),fps:1000/stats(intervals).mean,uploadBytes:stats(uploads),instanceUploadBytes:stats(instanceUploads),visibilityUploadBytes:stats(visibilityUploads),gpuMs:profile.gpuTotal??null,gpuVisibilityMs:profile.gpu.visibility??null,timestampQueries:profile.timestampQueries,profile,render,qualityRender,linear,pixelComparison,measuredPixelComparison};
 }finally{renderer.dispose();}
};
document.documentElement.dataset.ready='1';
