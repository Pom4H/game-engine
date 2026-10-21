import {WebGPURenderer} from '../../dist/render/webgpu.js';
import {RenderProfiler} from '../../dist/render/profiler.js';
import {createFixture,visibilityCamera,hash} from '../engine-compare/fixture.mjs';
import {installGPUJournal} from '../engine-compare/gpu-journal.mjs';
import {distribution,requireHardware} from '../engine-compare/metrics.mjs';
import {InputReader,differences} from './temporal-diagnostic.mjs';

const block=/    let sheltered=1\.0-smoothstep\(0\.42,0\.96,abs\(n\.y\)\);[\s\S]*?    albedo=mix\(albedo,mossColor,mossMask\*u\.surface\.x\);/;
const marker='    // Zero moss contributes no albedo; the physical uniform stays live.\n';
const guarded=value=>marker+'    if(u.surface.x!=0.0){\n'+value.split('\n').map(line=>'  '+line).join('\n')+'\n    }';
const pairFor=code=>{
 if(code.includes(marker)){
  const begin=code.indexOf(marker),open=begin+marker.length+'    if(u.surface.x!=0.0){\n'.length,end=code.indexOf('\n    }',open);
  if(end<open)throw new Error('Incomplete production moss demand guard');
  const original=code.slice(open,end).split('\n').map(line=>line.slice(2)).join('\n');
  if(!block.test(original))throw new Error('Moss guard no longer encloses exactly the reference block');
  return {before:code.slice(0,begin)+original+code.slice(end+'\n    }'.length),after:code};
 }
 const match=code.match(block);if(!match)return null;
 return {before:code,after:code.replace(block,guarded(match[0]))};
};

/** Same-device AB/BA pairs isolate opaque GPU cost. The full renderer runs;
 * waits prevent overlap and remove RAF from the interpretation. Old fragments
 * are reconstructed by replacing only the tested zero-moss guard. */
export async function diagnoseMossDemand({count=10000,width=1920,height=1080,pairs=128}={}){
 const hooks=installGPUJournal(),modules=new WeakMap(),pipelines=new WeakMap(),sourcePairs=[],captures=[],runs=[];
 const nativeModule=GPUDevice.prototype.createShaderModule,nativePipeline=GPUDevice.prototype.createRenderPipeline,nativeSetPipeline=GPURenderPassEncoder.prototype.setPipeline;
 let variant='after',substitutions=0,renderer,reader,pipelinePairs=0;
 GPUDevice.prototype.createShaderModule=function(descriptor){
  const pair=pairFor(descriptor.code),before=pair?.before,after=pair?.after;
  if(pair&&before===after)throw new Error('Moss shader variants are identical');
  const current=nativeModule.call(this,{...descriptor,code:after??descriptor.code});if(before){
   const old=nativeModule.call(this,{...descriptor,code:before});modules.set(current,old);sourcePairs.push({before,after});
  }return current;
 };
 GPUDevice.prototype.createRenderPipeline=function(descriptor){
  const current=nativePipeline.call(this,descriptor),old=modules.get(descriptor.fragment?.module);
  if(old){if(descriptor.layout==='auto')throw new Error('Paired material pipeline requires an explicit shared layout');pipelines.set(current,nativePipeline.call(this,{...descriptor,label:descriptor.label+' before moss demand guard',fragment:{...descriptor.fragment,module:old}}));pipelinePairs++;}
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
  const ground=fixture.scene.entities.get('ground'),surface=fixture.scene.surfaceStateForRender('ground')??ground.material.surface,originalMaterial=ground.material;
  if(surface.moss!==0)throw new Error('Timing fixture needs authoritative zero moss');
  if(fixture.scene.surfaceStateForRender('ground'))throw new Error('Authored material transition needs a ground without an environmental field');
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
    rawPairs.push({pair,first:pair%2?'after':'before',beforeMs:values.before,afterMs:values.after,deltaMs:values.after-values.before});
   }
   if(substitutions===substitutionStart)throw new Error('Baseline pipelines were never executed');
   const modes=Object.fromEntries(Object.entries(samples).map(([mode,values])=>[mode,{opaqueMs:distribution(values.map(x=>x.opaqueMs)),totalMs:distribution(values.map(x=>x.totalMs)),cpuQuanta:Object.fromEntries(Object.keys(values[0].cpuQuanta).map(key=>[key,distribution(values.map(x=>x.cpuQuanta[key]??0))]))}]));
   runs.push({scenario,pairs,modes,deltaMs:distribution(rawPairs.map(x=>x.deltaMs)),improvedPairs:rawPairs.filter(x=>x.deltaMs<0).length,byFirst:Object.fromEntries(['before','after'].map(first=>[first,distribution(rawPairs.filter(x=>x.first===first).map(x=>x.deltaMs))])),baselineSubstitutions:substitutions-substitutionStart,rawPairs});
   console.info('TEMPORAL_DIAGNOSTIC '+JSON.stringify({kind:'moss-demand',scenario,opaqueBefore:modes.before.opaqueMs,opaqueAfter:modes.after.opaqueMs,delta:runs.at(-1).deltaMs}));
  }
  // A live material transition verifies zero -> growth -> zero without pipeline
  // reconstruction. Both variants see each authored physical state separately.
  reader=new InputReader(renderer.device,width,height);const quality=[],stateCaptures=[],pipelinesBeforeStates=pipelinePairs;
  for(const [state,moss] of [['zero',0],['growth',.65],['restored',0]]){
   // Runtime material/surface values are immutable. Replace the authored input
   // as one value, retaining every other cause; publish the appearance cause
   // used by the normal material editor. Restore the original material value.
   ground.material=moss===0?originalMaterial:Object.freeze({...originalMaterial,surface:Object.freeze({...surface,moss})});
   fixture.scene.appearanceRevision++;
   const stateHash=await hash(fixture.scene.snapshot());let reference;
   for(const mode of ['before','after']){
    variant=mode;renderer.resetTemporalHistory();
    for(let frame=0;frame<32;frame++){renderer.setTimelineFrame(frame);renderer.render(fixture.scene,visibilityCamera(0));await renderer.flush();}
    const stages={opaque:await reader.readColor(renderer.opaqueScene),hdr:await reader.readColor(renderer.hdr),taa:await reader.readColor(renderer.taaHistoryIndex===0?renderer.taaA:renderer.taaB)};
    if(reference)for(const [stage,value] of Object.entries(stages))quality.push({state,moss,stage,...differences(reference[stage],value)});else reference=stages;
    const observed=fixture.scene.surfaceStateForRender('ground')??ground.material.surface;
    if(observed.moss!==moss||await hash(fixture.scene.snapshot())!==stateHash)throw new Error('Rendering changed the authored surface state');
    stateCaptures.push({state,mode,moss,opaqueHash:await hash(stages.opaque.pixels),stateHash});
    captures.push({mode:mode+'-'+state,frame:31,imageDataURL:canvas.toDataURL('image/png')});
   }
  }
  const beforeStates=stateCaptures.filter(x=>x.mode==='before'),liveGrowthObserved=beforeStates[0].opaqueHash!==beforeStates[1].opaqueHash&&beforeStates[0].opaqueHash===beforeStates[2].opaqueHash;
  if(pipelinePairs!==pipelinesBeforeStates)throw new Error('Moss state transition rebuilt material pipelines');
  const afterHash=await hash(fixture.scene.snapshot());if(afterHash!==fixture.replayHash)throw new Error('Paired rendering mutated physical state');await journal.flush();
  return{status:'completed',controls:{count,width,height,pairs,warmup:160,scenarios:['static','camera-motion'],surfaceTransition:'immutable authored material replacement with appearance revision: zero -> 0.65 moss -> original material'},adapter:journal.adapter,sourceHash:fixture.sourceHash,geometryHash:fixture.geometryHash,replayHash:fixture.replayHash,afterHash,
   shaderPairs:await Promise.all(sourcePairs.map(async pair=>({beforeHash:await hash(pair.before),afterHash:await hash(pair.after)}))),pipelinePairs,baselineSubstitutions:substitutions,runs,quality,stateCaptures,captures,
   gates:{nativeTimestamps:true,baselinePipelinesExecuted:true,physicalReplay:true,liveGrowthObserved,liveTransitionNoRecompile:true,finalCanonicalStages:quality.every(stage=>stage.changedChannels===0)},
   interpretation:'Native same-device AB/BA pairs with the same camera and timeline within each pair, unchanged geometry and physical state. Both full pipelines run; only main/relief/instance fragment shader moss guards differ. Per-pass timestamps isolate opaque cost, and all CPU quanta are instrumented observations with profiler overhead. Queue waits mean these are not display FPS or frame-interval measurements. Final opaque/HDR/TAA comparisons follow timing with independent history resets for live zero/growth/restored surface states; they cannot replace the full multi-frame and wet quality gates or eliminate intermittent variation.'};
 }finally{
  GPUDevice.prototype.createShaderModule=nativeModule;GPUDevice.prototype.createRenderPipeline=nativePipeline;GPURenderPassEncoder.prototype.setPipeline=nativeSetPipeline;
  reader?.destroy();renderer?.dispose();await hooks.journals.at(-1)?.dispose();renderer?.device.destroy();hooks.uninstall();
 }
}
