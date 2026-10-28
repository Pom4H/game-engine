import {WebGPURenderer} from '../../dist/render/webgpu.js';
import {RenderRadianceProjection as BaselineProjection} from './radiance-cause-baseline.mjs';
import {RenderCpuPhaseObserver} from '../engine-compare/cpu-phases.mjs';
import {createFixture,visibilityCamera,hash} from '../engine-compare/fixture.mjs';
import {installGPUJournal} from '../engine-compare/gpu-journal.mjs';
import {distribution,requireHardware} from '../engine-compare/metrics.mjs';
import {InputReader,differences} from './temporal-diagnostic.mjs';

export async function diagnoseRadianceCausePlan({count=10000,width=1920,height=1080,pairs=128}={}, {frameVariants,experiment='radiance-cause-plan'}={}){
 const hooks=installGPUJournal();let renderer,reader,phases;const runs=[],captures=[],causeChecks=[];
 try{
  const fixture=await createFixture(count),canvas=document.querySelector('canvas');
  renderer=await WebGPURenderer.create(canvas,{visibility:'gpu',profiling:false});renderer.setResolution(width,height);await renderer.prepareMaterials(fixture.scene);
  const journal=hooks.journals.at(-1);requireHardware(journal.adapter);phases=new RenderCpuPhaseObserver(renderer.profiler);
  const projections={baseline:new BaselineProjection(),candidate:renderer.radianceProjection};
  const frameExecutions={baseline:0,candidate:0};let modelChannelsChecked=0;
  const select=mode=>{renderer.radianceProjection=projections[mode];if(frameVariants){renderer.frameCache=frameVariants[mode].cache;renderer.frameBuilder=frameVariants[mode].builder;frameExecutions[mode]++;}};
  const render=async(mode,camera,frame,latch)=>{select(mode);renderer.setTimelineFrame(frame);renderer.render(fixture.scene,camera);latch?.();await renderer.flush();};
  for(let frame=0;frame<128;frame++)for(const mode of ['baseline','candidate'])await render(mode,visibilityCamera(frame,'camera-motion'),frame);
  await journal.flush();
  for(const scenario of ['static','camera-motion']){
   const samples={baseline:[],candidate:[]},rawPairs=[];
   for(let pair=0;pair<pairs;pair++){
    const camera=visibilityCamera(pair,scenario),values={},keys={},projected={};
    for(const mode of pair%2?['candidate','baseline']:['baseline','candidate']){
     for(let settle=0;settle<2;settle++)await render(mode,camera,pair);
     select(mode);renderer.setTimelineFrame(pair);journal.beginFrame(pair*2+(mode==='candidate'?1:0));phases.beginFrame(pair);
     const start=performance.now();renderer.render(fixture.scene,camera);const cpuTotalMs=performance.now()-start;
     const cpu=phases.endFrame(cpuTotalMs),work=journal.endFrame();await renderer.flush();await journal.flush();
     if(!Number.isFinite(work.gpuMs)||!cpu.phases.projection||!cpu.phases.environment)throw new Error('Missing paired native timing');
     keys[mode]=renderer.environmentKey;
     if(frameVariants)projected[mode]=renderer.renderFrame;
     const sample={projectionMs:cpu.phases.projection.exclusiveMs,environmentMs:cpu.phases.environment.exclusiveMs,combinedMs:cpu.phases.projection.exclusiveMs+cpu.phases.environment.exclusiveMs,cpuTotalMs,gpuTotalMs:work.gpuMs,uploadBytes:work.bufferUploadBytes+work.textureUploadBytes,drawCalls:work.drawCalls};
     samples[mode].push(sample);values[mode]=sample;
    }
    if(keys.baseline!==keys.candidate)throw new Error('Historical and candidate radiance/environment causes differ');
    if(values.baseline.uploadBytes!==values.candidate.uploadBytes||values.baseline.drawCalls!==values.candidate.drawCalls)throw new Error('Paired GPU work differs');
    if(frameVariants){
     const a=projected.baseline,b=projected.candidate;if(a.objects.length!==fixture.objectCount||b.objects.length!==fixture.objectCount)throw new Error('Projected object coverage differs');
     for(let index=0;index<a.objects.length;index++){
      const left=a.objects[index],right=b.objects[index];if(left.entity!==right.entity||left.primitive!==right.primitive)throw new Error('Projected object identity differs');
      for(let lane=0;lane<16;lane++){if(!Object.is(left.model[lane],right.model[lane]))throw new Error('Projected matrix differs');modelChannelsChecked++;}
     }
    }
    causeChecks.push({scenario,pair,environmentKey:keys.baseline,exact:true});
    rawPairs.push({pair,first:pair%2?'candidate':'baseline',baseline:values.baseline,candidate:values.candidate,combinedDeltaMs:values.candidate.combinedMs-values.baseline.combinedMs,totalDeltaMs:values.candidate.cpuTotalMs-values.baseline.cpuTotalMs});
   }
   const modes=Object.fromEntries(Object.entries(samples).map(([mode,values])=>[mode,Object.fromEntries(Object.keys(values[0]).map(key=>[key,distribution(values.map(value=>value[key]))]))]));
   const byFirst=Object.fromEntries(['baseline','candidate'].map(first=>[first,distribution(rawPairs.filter(value=>value.first===first).map(value=>value.combinedDeltaMs))]));
   runs.push({scenario,pairs,modes,combinedDeltaMs:distribution(rawPairs.map(value=>value.combinedDeltaMs)),totalDeltaMs:distribution(rawPairs.map(value=>value.totalDeltaMs)),improvedPairs:rawPairs.filter(value=>value.combinedDeltaMs<0).length,byFirst,rawPairs});
   console.info('TEMPORAL_DIAGNOSTIC '+JSON.stringify({kind:experiment,scenario,delta:runs.at(-1).combinedDeltaMs,totalDelta:runs.at(-1).totalDeltaMs,byFirst}));
  }
  reader=new InputReader(renderer.device,width,height);let reference;const quality=[];
  for(let repetition=0;repetition<2;repetition++)for(const mode of ['baseline','candidate']){
   renderer.resetTemporalHistory();const copy=document.createElement('canvas');copy.width=width;copy.height=height;const context=copy.getContext('2d');
   for(let frame=0;frame<32;frame++)await render(mode,visibilityCamera(0),frame,frame===31?()=>context.drawImage(canvas,0,0):undefined);
   const stages={opaque:await reader.readColor(renderer.opaqueScene),hdr:await reader.readColor(renderer.hdr),taa:await reader.readColor(renderer.taaHistoryIndex===0?renderer.taaA:renderer.taaB)};
   if(reference)for(const [stage,value] of Object.entries(stages))quality.push({mode,repetition,stage,...differences(reference[stage],value)});else reference=stages;
   captures.push({mode:mode+'-r'+repetition,frame:31,imageDataURL:copy.toDataURL('image/png')});
  }
  const afterHash=await hash(fixture.scene.snapshot());if(afterHash!==fixture.replayHash)throw new Error('Rendering mutated physical state');
  const expectedFrames=128+pairs*3*2+64,observations=Object.fromEntries(Object.entries(projections).map(([mode,projection])=>[mode,projection.inspect()]));
  if(Object.values(observations).some(value=>value.fusedFrames!==expectedFrames||value.fallbackFrames!==0))throw new Error('Historical/candidate projection execution coverage is incomplete');
  const frameCacheObservations=frameVariants?Object.fromEntries(Object.entries(frameVariants).map(([mode,value])=>[mode,value.cache.inspect()])):undefined;
  const poseStorage=frameVariants?Object.fromEntries(Object.entries(frameVariants).map(([mode,value])=>{const buffers=new Set(value.cache.entries.map(entry=>entry.pose.buffer));return [mode,{buffers:buffers.size,bytes:[...buffers].reduce((sum,buffer)=>sum+buffer.byteLength,0),views:value.cache.entries.length}];})):undefined;
  if(frameVariants&&(Object.values(frameExecutions).some(frames=>frames!==expectedFrames)||modelChannelsChecked!==pairs*2*fixture.objectCount*16||Object.values(frameCacheObservations).some(value=>value.entries!==fixture.objectCount||value.modelUpdates!==fixture.objectCount)))throw new Error('Pose arena execution/model coverage is incomplete');
  return {status:'completed',controls:{count,width,height,pairs,warmupFramesPerVariant:128,settleFramesPerVariant:2,scenarios:['static','camera-motion'],qualityRepetitions:2},adapter:journal.adapter,sourceHash:fixture.sourceHash,geometryHash:fixture.geometryHash,replayHash:fixture.replayHash,afterHash,observations,causeChecks,runs,quality,captures,
   ...(frameVariants?{experiment,frameExecutions,frameCacheObservations,poseStorage,modelChannelsChecked,frameModelsExact:true}:{}),
   gates:{nativeTimestamps:true,variantsExecuted:true,physicalReplay:true,environmentCausesExact:true,gpuWorkExact:true,finalCanonicalStages:quality.every(value=>value.changedChannels===0),cpuCombinedImproved:runs.every(run=>run.combinedDeltaMs.mean<-1e-6&&Object.values(run.byFirst).every(value=>value.mean<-1e-6))},
   interpretation:(frameVariants?'Historical frame cache comes from the completed source/build archive, with only math/mesh imports relocated. Both frame caches execute their own built-in detailed projection. Every pair checks all 16 matrix channels of every object outside the CPU interval. ':'')+'Historical radiance module comes from the completed source/build archive, with only its math import relocated to the unchanged current math module. Same-device AB/BA pairs keep production shaders, scene, camera, timeline, GPU work and environment keys equal. CPU phase observer adds no GPU profiling/occlusion work. Queue waits and settling frames make these paired host-cost observations, not native frame intervals or display FPS. Quality reads cover final opaque/HDR/TAA after 32 frames in two repetitions, not every intermediate frame or wet scenes. Failed strict gates remain failures.'};
 }finally{reader?.destroy();phases?.dispose();await hooks.journals.at(-1)?.dispose();renderer?.dispose();renderer?.device.destroy();hooks.uninstall();}
}
