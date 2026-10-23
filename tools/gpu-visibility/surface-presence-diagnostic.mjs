import {WebGPURenderer} from '../../dist/render/webgpu.js';
import {RenderProfiler} from '../../dist/render/profiler.js';
import {Scene} from '../../dist/scene/scene.js';
import {createFixture,visibilityCamera,hash} from '../engine-compare/fixture.mjs';
import {installGPUJournal} from '../engine-compare/gpu-journal.mjs';
import {distribution,requireHardware} from '../engine-compare/metrics.mjs';
import {InputReader,differences} from './temporal-diagnostic.mjs';

/** Isolate only the production eligibility presence query. Legacy mode selects
 * the original three authoritative readers; both use identical physical maps. */
export async function diagnoseSurfacePresence({count=10000,width=1920,height=1080,pairs=128}={}){
 const hooks=installGPUJournal();let renderer,reader,variant='indexed';const runs=[],captures=[],selected={legacy:0,indexed:0};
 try{
  const fixture=await createFixture(count),canvas=document.querySelector('canvas'),getter=Object.getOwnPropertyDescriptor(Scene.prototype,'renderSurfaceStatePresence').get;
  Object.defineProperty(fixture.scene,'renderSurfaceStatePresence',{get(){selected[variant]++;return variant==='indexed'?getter.call(this):undefined;}});
  renderer=await WebGPURenderer.create(canvas,{visibility:'gpu',profiling:true});renderer.profiler.dispose();renderer.profiler=new RenderProfiler(renderer.device,{enabled:true,timestampQueries:false});
  const journal=hooks.journals.at(-1);requireHardware(journal.adapter);if(!renderer.device.features.has('timestamp-query'))throw new Error('Native timestamps required');
  renderer.setResolution(width,height);await renderer.prepareMaterials(fixture.scene);
  const render=async(camera,frame)=>{renderer.setTimelineFrame(frame);renderer.render(fixture.scene,camera);await renderer.flush();};
  for(let frame=0;frame<128;frame++)await render(visibilityCamera(frame,'camera-motion'),frame);await journal.flush();
  for(const scenario of ['static','camera-motion']){
   const samples={legacy:[],indexed:[]},rawPairs=[];
   for(let pair=0;pair<pairs;pair++){
    const camera=visibilityCamera(pair,scenario),values={};
    for(const mode of pair%2?['indexed','legacy']:['legacy','indexed']){
     variant=mode;for(let settle=0;settle<2;settle++)await render(camera,pair);
     const before=selected[mode];journal.beginFrame(pair*2+Number(mode==='indexed'));renderer.setTimelineFrame(pair);renderer.render(fixture.scene,camera);
     const work=journal.endFrame(),cpu=renderer.profileLatest().cpu;await renderer.flush();await journal.flush();
     if(selected[mode]!==before+1||!Number.isFinite(work.gpuMs)||!Number.isFinite(cpu.quanta.prepare))throw new Error('Actual eligibility variant or paired measurements missing');
     const sample={prepareMs:cpu.quanta.prepare,cpuTotalMs:cpu.totalMs,gpuTotalMs:work.gpuMs};samples[mode].push(sample);values[mode]=sample;
    }
    rawPairs.push({pair,first:pair%2?'indexed':'legacy',legacy:values.legacy,indexed:values.indexed,prepareDeltaMs:values.indexed.prepareMs-values.legacy.prepareMs,totalDeltaMs:values.indexed.cpuTotalMs-values.legacy.cpuTotalMs});
   }
   const modes=Object.fromEntries(Object.entries(samples).map(([mode,values])=>[mode,Object.fromEntries(Object.keys(values[0]).map(key=>[key,distribution(values.map(x=>x[key]))]))]));
   const byFirst=Object.fromEntries(['legacy','indexed'].map(first=>[first,distribution(rawPairs.filter(x=>x.first===first).map(x=>x.prepareDeltaMs))]));
   runs.push({scenario,pairs,modes,prepareDeltaMs:distribution(rawPairs.map(x=>x.prepareDeltaMs)),totalDeltaMs:distribution(rawPairs.map(x=>x.totalDeltaMs)),improvedPairs:rawPairs.filter(x=>x.prepareDeltaMs<0).length,byFirst,rawPairs});
   console.info('TEMPORAL_DIAGNOSTIC '+JSON.stringify({kind:'surface-presence',scenario,modes,delta:runs.at(-1).prepareDeltaMs}));
  }
  reader=new InputReader(renderer.device,width,height);let reference;const quality=[];
  for(const mode of ['legacy','indexed']){
   variant=mode;renderer.resetTemporalHistory();for(let frame=0;frame<32;frame++)await render(visibilityCamera(0),frame);
   const stages={opaque:await reader.readColor(renderer.opaqueScene),hdr:await reader.readColor(renderer.hdr),taa:await reader.readColor(renderer.taaHistoryIndex===0?renderer.taaA:renderer.taaB)};
   if(reference)for(const [stage,value] of Object.entries(stages))quality.push({stage,...differences(reference[stage],value)});else reference=stages;
   captures.push({mode,frame:31,imageDataURL:canvas.toDataURL('image/png')});
  }
  const afterHash=await hash(fixture.scene.snapshot());if(afterHash!==fixture.replayHash)throw new Error('Paired rendering mutated physical state');
  if(selected.indexed!==128+pairs*6+32||selected.legacy!==pairs*6+32)throw new Error('Production presence selections did not match actual render coverage');
  return{status:'completed',controls:{count,width,height,pairs,warmup:128,settleFramesPerVariant:2,scenarios:['static','camera-motion']},adapter:journal.adapter,sourceHash:fixture.sourceHash,geometryHash:fixture.geometryHash,replayHash:fixture.replayHash,afterHash,selected,preparation:renderer.inspect(false).preparation,runs,quality,captures,
   gates:{nativeTimestamps:true,variantsExecuted:true,physicalReplay:true,finalCanonicalStages:quality.every(x=>x.changedChannels===0)},
   interpretation:'Same-device AB/BA pairs isolate the original three readers versus the published presence index. No shader, scene, physical map value, instance packing, Render IR or pass changes between variants. Counter overhead is one getter selection per frame in both modes. Profiled waits are not display FPS or frame interval. Final snapshots do not replace multi-frame and full wet quality gates.'};
 }finally{reader?.destroy();renderer?.dispose();await hooks.journals.at(-1)?.dispose();renderer?.device.destroy();hooks.uninstall();}
}
