import {WebGPURenderer} from '../../dist/render/webgpu.js';
import {RenderProfiler} from '../../dist/render/profiler.js';
import {createFixture,visibilityCamera,hash} from '../engine-compare/fixture.mjs';
import {installGPUJournal} from '../engine-compare/gpu-journal.mjs';
import {distribution,requireHardware} from '../engine-compare/metrics.mjs';
import {InputReader,differences} from './temporal-diagnostic.mjs';

export const POINT_LIGHT_GUARD=' if(nl<=0.0){return vec3<f32>(0);}\n';
function pairFor(code){
 if(!code.includes('fn pointLight('))return null;
 const marker=' let l=delta/max(dist,.001);let nl=max(dot(n,l),0.0);';
 if(!code.includes(marker))throw Error('Point-light reference changed');
 const before=code.replace(POINT_LIGHT_GUARD,'');
 return {before,after:before.replace(marker,marker+'\n'+POINT_LIGHT_GUARD)};
}

/** Independent before/after pipelines share the exact scene, camera and buffers. */
export async function diagnosePointLightDemand({count=5000,width=1920,height=1080,pairs=64}={}){
 if(!Number.isInteger(pairs)||pairs<4||pairs>256)throw Error('Invalid pair count');
 const hooks=installGPUJournal(),modules=new WeakMap(),pipelines=new WeakMap(),sourcePairs=[],runs=[],captures=[];
 const nativeModule=GPUDevice.prototype.createShaderModule,nativePipeline=GPUDevice.prototype.createRenderPipeline,nativeAsync=GPUDevice.prototype.createRenderPipelineAsync,nativeSet=GPURenderPassEncoder.prototype.setPipeline;
 let mode='after',substitutions=0,renderer,reader,pipelinePairs=0;
 GPUDevice.prototype.createShaderModule=function(descriptor){const pair=pairFor(descriptor.code),current=nativeModule.call(this,{...descriptor,code:pair?.after??descriptor.code});if(pair){modules.set(current,nativeModule.call(this,{...descriptor,code:pair.before}));sourcePairs.push(pair);}return current;};
 const previousDescriptor=descriptor=>{const module=modules.get(descriptor.fragment?.module);return module?{...descriptor,label:descriptor.label+' before zero-light guard',fragment:{...descriptor.fragment,module}}:null;};
 GPUDevice.prototype.createRenderPipeline=function(descriptor){const current=nativePipeline.call(this,descriptor),before=previousDescriptor(descriptor);if(before){pipelines.set(current,nativePipeline.call(this,before));pipelinePairs++;}return current;};
 GPUDevice.prototype.createRenderPipelineAsync=async function(descriptor){const current=await nativeAsync.call(this,descriptor),before=previousDescriptor(descriptor);if(before){pipelines.set(current,await nativeAsync.call(this,before));pipelinePairs++;}return current;};
 GPURenderPassEncoder.prototype.setPipeline=function(pipeline){const before=pipelines.get(pipeline);if(mode==='before'&&before){substitutions++;return nativeSet.call(this,before);}return nativeSet.call(this,pipeline);};
 try{
  const fixture=await createFixture(count),canvas=document.querySelector('canvas');
  renderer=await WebGPURenderer.create(canvas,{visibility:'gpu',profiling:true});
  renderer.profiler.dispose();renderer.profiler=new RenderProfiler(renderer.device,{enabled:true,timestampQueries:false});
  if(sourcePairs.length<3||pipelinePairs<3)throw Error('Missing real shader/pipeline pairs');
  const journal=hooks.journals.at(-1);requireHardware(journal.adapter);renderer.setResolution(width,height);await renderer.prepareMaterials(fixture.scene);
  for(let frame=0;frame<80;frame++){mode=frame%2?'before':'after';renderer.setTimelineFrame(frame);renderer.render(fixture.scene,visibilityCamera(frame,'camera-motion'));await renderer.flush();}
  await journal.flush();
  for(const scenario of ['static','camera-motion']){
   const observations={before:[],after:[]},rawPairs=[];
   for(let pair=0;pair<pairs;pair++){
    const camera=visibilityCamera(pair,scenario),values={};
    for(const variant of pair%2?['after','before']:['before','after']){
     mode=variant;renderer.setTimelineFrame(pair);journal.beginFrame(pair*2+(variant==='before'?0:1));renderer.render(fixture.scene,camera);const work=journal.endFrame();
     await renderer.flush();await journal.flush();const main=work.passes.find(p=>p.label==='render.main.opaque');if(!Number.isFinite(main?.gpuMs)||!Number.isFinite(work.gpuMs))throw Error('Missing GPU measurement');
     observations[mode].push({opaqueMs:main.gpuMs,totalMs:work.gpuMs});values[mode]=main.gpuMs;
    }
    rawPairs.push({pair,first:pair%2?'after':'before',beforeMs:values.before,afterMs:values.after,deltaMs:values.after-values.before});
   }
   const modes=Object.fromEntries(Object.entries(observations).map(([name,values])=>[name,{opaqueMs:distribution(values.map(x=>x.opaqueMs)),totalMs:distribution(values.map(x=>x.totalMs))}]));
   runs.push({scenario,modes,improvedPairs:rawPairs.filter(p=>p.deltaMs<0).length,deltaMs:distribution(rawPairs.map(p=>p.deltaMs)),rawPairs});
   console.info('TEMPORAL_DIAGNOSTIC '+JSON.stringify({scenario,modes,improvedPairs:runs.at(-1).improvedPairs,deltaMs:runs.at(-1).deltaMs}));
  }
  reader=new InputReader(renderer.device,width,height);const quality=[];
  for(const scenario of ['static','camera-motion']){
   const stages={};
   for(const variant of ['before','after']){
    mode=variant;renderer.resetTemporalHistory();
    for(let frame=0;frame<32;frame++){renderer.setTimelineFrame(frame);renderer.render(fixture.scene,visibilityCamera(frame,scenario));await renderer.flush();}
    stages[mode]={opaque:await reader.readColor(renderer.opaqueScene),hdr:await reader.readColor(renderer.hdr),effects:await reader.readColor(renderer.effectsHdr),taa:await reader.readColor(renderer.taaHistoryIndex===0?renderer.taaA:renderer.taaB)};
    captures.push({mode:variant+'-'+scenario,frame:31,imageDataURL:canvas.toDataURL('image/png')});
   }
   for(const name of Object.keys(stages.before))quality.push({scenario,stage:name,...differences(stages.before[name],stages.after[name])});
  }
  const afterHash=await hash(fixture.scene.snapshot());
  return {status:'completed',controls:{count,width,height,pairs,warmup:80},adapter:journal.adapter,sourceHash:fixture.sourceHash,geometryHash:fixture.geometryHash,replayHash:fixture.replayHash,afterHash,
   pipelinePairs,substitutions,shaderPairs:await Promise.all(sourcePairs.map(async p=>({beforeHash:await hash(p.before),afterHash:await hash(p.after)}))),runs,quality,captures,
   gates:{nativeTimestamps:true,baselineExecuted:substitutions>0,physicalReplay:fixture.replayHash===afterHash,opaqueExact:quality.filter(q=>q.stage==='opaque').every(q=>q.changedChannels===0),allStagesExact:quality.every(q=>q.changedChannels===0)},
   interpretation:'Same-device alternating AB/BA, full renderer with independent paired fragment pipelines. Only exactly zero back-facing local-light contributions return early. Waits separate GPU timings from displayed FPS. Strict pixel comparisons are reported without tolerance.'};
 }finally{GPUDevice.prototype.createShaderModule=nativeModule;GPUDevice.prototype.createRenderPipeline=nativePipeline;GPUDevice.prototype.createRenderPipelineAsync=nativeAsync;GPURenderPassEncoder.prototype.setPipeline=nativeSet;reader?.destroy();renderer?.dispose();await hooks.journals.at(-1)?.dispose();renderer?.device.destroy();hooks.uninstall();}
}
