import {WebGPURenderer} from '../../dist/render/webgpu.js';
import {RenderProfiler} from '../../dist/render/profiler.js';
import {createFixture,visibilityCamera,hash} from '../engine-compare/fixture.mjs';
import {installGPUJournal} from '../engine-compare/gpu-journal.mjs';
import {distribution,requireHardware} from '../engine-compare/metrics.mjs';
import {InputReader,differences} from './temporal-diagnostic.mjs';

const demand=/  \/\/ Both sun lobes multiply by nl\. With no incident sunlight, PCF and relief\r?\n  \/\/ visibility cannot contribute; explicit-level samples need no derivatives\.\r?\n  var shadow=1\.0;\r?\n  if\(nl>0\.0\)\{shadow=([^;]+);\}/;
const baseline=/  let shadow=(shadowAt\(in\.worldPos,n\)[^;]*);/;
const guarded=value=>`  // Both sun lobes multiply by nl. With no incident sunlight, PCF and relief
  // visibility cannot contribute; explicit-level samples need no derivatives.
  var shadow=1.0;
  if(nl>0.0){shadow=${value};}`;

/** Same-device AB/BA pairs isolate opaque GPU cost. The full renderer runs;
 * waits prevent overlap and remove RAF from the interpretation. Old fragments
 * are reconstructed by replacing only the tested sunlight-demand guard. */
export async function diagnoseShadowDemand({count=10000,width=1920,height=1080,pairs=128}={}){
 const hooks=installGPUJournal(),modules=new WeakMap(),pipelines=new WeakMap(),sourcePairs=[],captures=[],runs=[];
 const nativeModule=GPUDevice.prototype.createShaderModule,nativePipeline=GPUDevice.prototype.createRenderPipeline,nativeSetPipeline=GPURenderPassEncoder.prototype.setPipeline;
 let variant='after',substitutions=0,renderer,reader,pipelinePairs=0;
 GPUDevice.prototype.createShaderModule=function(descriptor){
  let before,after;
  if(demand.test(descriptor.code)){before=descriptor.code.replace(demand,'  let shadow=$1;');after=descriptor.code;}
  else if(baseline.test(descriptor.code)){before=descriptor.code;after=before.replace(baseline,(_,value)=>guarded(value));}
  const current=nativeModule.call(this,{...descriptor,code:after??descriptor.code});if(before){
   const old=nativeModule.call(this,{...descriptor,code:before});modules.set(current,old);sourcePairs.push({before,after});
  }return current;
 };
 GPUDevice.prototype.createRenderPipeline=function(descriptor){
  const current=nativePipeline.call(this,descriptor),old=modules.get(descriptor.fragment?.module);
  if(old){if(descriptor.layout==='auto')throw new Error('Paired material pipeline requires an explicit shared layout');pipelines.set(current,nativePipeline.call(this,{...descriptor,label:descriptor.label+' before demand guard',fragment:{...descriptor.fragment,module:old}}));pipelinePairs++;}
  return current;
 };
 GPURenderPassEncoder.prototype.setPipeline=function(pipeline){const old=pipelines.get(pipeline);if(variant==='before'&&old){substitutions++;return nativeSetPipeline.call(this,old);}return nativeSetPipeline.call(this,pipeline);};
 try{
  const fixture=await createFixture(count),canvas=document.querySelector('canvas');renderer=await WebGPURenderer.create(canvas,{visibility:'gpu',profiling:true});
  // One timestamp owner per pass: retain CPU quanta/occlusion observations but
  // let the common journal alone record GPU time. Swap before any submission.
  renderer.profiler.dispose();renderer.profiler=new RenderProfiler(renderer.device,{enabled:true,timestampQueries:false});
  if(sourcePairs.length!==3||pipelinePairs<1)throw new Error('Expected main, relief and instance shader pairs');
  const journal=hooks.journals.at(-1);requireHardware(journal.adapter);if(!renderer.device.features.has('timestamp-query'))throw new Error('Native timestamps required');
  renderer.setResolution(width,height);await renderer.prepareMaterials(fixture.scene);
  for(let frame=0;frame<160;frame++){variant=frame%2?'before':'after';renderer.setTimelineFrame(frame);renderer.render(fixture.scene,visibilityCamera(frame,'camera-motion'));await renderer.flush();}
  await journal.flush();
  for(const scenario of ['static','camera-motion']){
   const samples={before:[],after:[]},rawPairs=[],substitutionStart=substitutions;
   for(let pair=0;pair<pairs;pair++){
    const camera=visibilityCamera(pair,scenario),values={};
    for(const mode of pair%2?['after','before']:['before','after']){
     variant=mode;renderer.setTimelineFrame(pair);journal.beginFrame(pair*2+(mode==='before'?0:1));renderer.render(fixture.scene,camera);const work=journal.endFrame(),cpu=renderer.profileLatest().cpu;
     await renderer.flush();await journal.flush();
     const main=work.passes.find(pass=>pass.label==='render.main.opaque');if(!main||!Number.isFinite(main.gpuMs)||!Number.isFinite(work.gpuMs))throw new Error('Missing actual paired timestamp');
     samples[mode].push({opaqueMs:main.gpuMs,totalMs:work.gpuMs,cpuQuanta:cpu.quanta});values[mode]=main.gpuMs;
    }
    rawPairs.push({pair,beforeMs:values.before,afterMs:values.after,deltaMs:values.after-values.before});
   }
   if(substitutions===substitutionStart)throw new Error('Baseline pipelines were never executed');
   const modes=Object.fromEntries(Object.entries(samples).map(([mode,values])=>[mode,{opaqueMs:distribution(values.map(x=>x.opaqueMs)),totalMs:distribution(values.map(x=>x.totalMs)),cpuQuanta:Object.fromEntries(Object.keys(values[0].cpuQuanta).map(key=>[key,distribution(values.map(x=>x.cpuQuanta[key]??0))]))}]));
   runs.push({scenario,pairs,modes,deltaMs:distribution(rawPairs.map(x=>x.deltaMs)),improvedPairs:rawPairs.filter(x=>x.deltaMs<0).length,baselineSubstitutions:substitutions-substitutionStart,rawPairs});
   console.info('TEMPORAL_DIAGNOSTIC '+JSON.stringify({kind:'shadow-demand',scenario,opaqueBefore:modes.before.opaqueMs,opaqueAfter:modes.after.opaqueMs,delta:runs.at(-1).deltaMs}));
  }
  // Correctness observations follow all timing samples, with independent reset.
  reader=new InputReader(renderer.device,width,height);let reference;const quality=[];
  for(const mode of ['before','after']){
   variant=mode;renderer.resetTemporalHistory();
   for(let frame=0;frame<32;frame++){renderer.setTimelineFrame(frame);renderer.render(fixture.scene,visibilityCamera(0));await renderer.flush();}
   const stages={opaque:await reader.readColor(renderer.opaqueScene),hdr:await reader.readColor(renderer.hdr),taa:await reader.readColor(renderer.taaHistoryIndex===0?renderer.taaA:renderer.taaB)};
   if(reference)for(const [name,stage] of Object.entries(stages))quality.push({stage:name,...differences(reference[name],stage)});else reference=stages;
   captures.push({mode,frame:31,imageDataURL:canvas.toDataURL('image/png')});
  }
  const afterHash=await hash(fixture.scene.snapshot());if(afterHash!==fixture.replayHash)throw new Error('Paired rendering mutated physical state');await journal.flush();
  return{status:'completed',controls:{count,width,height,pairs,warmup:160,scenarios:['static','camera-motion']},adapter:journal.adapter,sourceHash:fixture.sourceHash,geometryHash:fixture.geometryHash,replayHash:fixture.replayHash,afterHash,
   shaderPairs:await Promise.all(sourcePairs.map(async pair=>({beforeHash:await hash(pair.before),afterHash:await hash(pair.after)}))),pipelinePairs,baselineSubstitutions:substitutions,runs,quality,captures,
   gates:{nativeTimestamps:true,baselinePipelinesExecuted:true,physicalReplay:true,finalCanonicalStages:quality.every(stage=>stage.changedChannels===0)},
   interpretation:'Native same-device AB/BA pairs with the same camera and timeline within each pair, unchanged geometry and physical state. Both full pipelines run; only main/relief/instance fragment shader demand guards differ. Per-pass timestamps isolate opaque cost, and all CPU quanta are instrumented observations with profiler overhead. Queue waits mean these are not display FPS or frame-interval measurements. Final opaque/HDR/TAA comparisons follow timing with independent history resets; they cannot replace the full multi-frame and wet quality gates or eliminate intermittent variation.'};
 }finally{
  GPUDevice.prototype.createShaderModule=nativeModule;GPUDevice.prototype.createRenderPipeline=nativePipeline;GPURenderPassEncoder.prototype.setPipeline=nativeSetPipeline;
  reader?.destroy();renderer?.dispose();await hooks.journals.at(-1)?.dispose();renderer?.device.destroy();hooks.uninstall();
 }
}
