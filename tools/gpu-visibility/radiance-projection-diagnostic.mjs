import {WebGPURenderer} from '../../dist/render/webgpu.js';
import {RenderProfiler} from '../../dist/render/profiler.js';
import {createFixture,visibilityCamera,hash} from '../engine-compare/fixture.mjs';
import {installGPUJournal} from '../engine-compare/gpu-journal.mjs';
import {distribution,requireHardware} from '../engine-compare/metrics.mjs';
import {InputReader,differences} from './temporal-diagnostic.mjs';

/** Isolates the fused traversal from the current authoritative Scene scan.
 * Both variants use the current numeric detector and all production shaders.
 * This is separate from the full historical before/after benchmark. */
export async function diagnoseRadianceProjection({count=10000,width=1920,height=1080,pairs=128}={}){
 const hooks=installGPUJournal();let renderer,reader,variant='fused';const runs=[],captures=[];
 try{
  const fixture=await createFixture(count),canvas=document.querySelector('canvas');renderer=await WebGPURenderer.create(canvas,{visibility:'gpu',profiling:true});
  renderer.profiler.dispose();renderer.profiler=new RenderProfiler(renderer.device,{enabled:true,timestampQueries:false});
  const journal=hooks.journals.at(-1);requireHardware(journal.adapter);if(!renderer.device.features.has('timestamp-query'))throw new Error('Native timestamps required');
  const build=renderer.frameCache.build.bind(renderer.frameCache);
  renderer.frameCache.build=(scene,camera,builder,observer)=>build(scene,camera,builder,variant==='fused'?observer:undefined);
  renderer.setResolution(width,height);await renderer.prepareMaterials(fixture.scene);
  const render=async(camera,frame)=>{renderer.setTimelineFrame(frame);renderer.render(fixture.scene,camera);await renderer.flush();};
  for(let frame=0;frame<128;frame++)await render(visibilityCamera(frame,'camera-motion'),frame);
  await journal.flush();
  for(const scenario of ['static','camera-motion']){
   const samples={scan:[],fused:[]},rawPairs=[];
   for(let pair=0;pair<pairs;pair++){
    const camera=visibilityCamera(pair,scenario),values={};
    for(const mode of pair%2?['fused','scan']:['scan','fused']){
     variant=mode;
     // A pure scan deliberately invalidates model certificates. Two untimed
     // frames establish each variant's own steady state before its sample.
     for(let settle=0;settle<2;settle++)await render(camera,pair);
     journal.beginFrame(pair*2+(mode==='scan'?0:1));renderer.setTimelineFrame(pair);renderer.render(fixture.scene,camera);
     const work=journal.endFrame(),cpu=renderer.profileLatest().cpu;await renderer.flush();await journal.flush();
     if(!Number.isFinite(work.gpuMs)||!Number.isFinite(cpu.quanta.projection)||!Number.isFinite(cpu.quanta.environment))throw new Error('Missing actual paired measurements');
     const sample={projectionMs:cpu.quanta.projection,environmentMs:cpu.quanta.environment,combinedMs:cpu.quanta.projection+cpu.quanta.environment,cpuTotalMs:cpu.totalMs,gpuTotalMs:work.gpuMs};
     samples[mode].push(sample);values[mode]=sample;
    }
    rawPairs.push({pair,first:pair%2?'fused':'scan',scan:values.scan,fused:values.fused,combinedDeltaMs:values.fused.combinedMs-values.scan.combinedMs,totalDeltaMs:values.fused.cpuTotalMs-values.scan.cpuTotalMs});
   }
   const modes=Object.fromEntries(Object.entries(samples).map(([mode,values])=>[mode,Object.fromEntries(Object.keys(values[0]).map(key=>[key,distribution(values.map(x=>x[key]))]))]));
   const byFirst=Object.fromEntries(['scan','fused'].map(first=>[first,distribution(rawPairs.filter(x=>x.first===first).map(x=>x.combinedDeltaMs))]));
   runs.push({scenario,pairs,modes,combinedDeltaMs:distribution(rawPairs.map(x=>x.combinedDeltaMs)),totalDeltaMs:distribution(rawPairs.map(x=>x.totalDeltaMs)),improvedPairs:rawPairs.filter(x=>x.combinedDeltaMs<0).length,byFirst,rawPairs});
   console.info('TEMPORAL_DIAGNOSTIC '+JSON.stringify({kind:'radiance-projection',scenario,modes,delta:runs.at(-1).combinedDeltaMs}));
  }
  reader=new InputReader(renderer.device,width,height);let reference;const quality=[];
  for(const mode of ['scan','fused']){
   variant=mode;renderer.resetTemporalHistory();
   for(let frame=0;frame<32;frame++)await render(visibilityCamera(0),frame);
   const stages={opaque:await reader.readColor(renderer.opaqueScene),hdr:await reader.readColor(renderer.hdr),taa:await reader.readColor(renderer.taaHistoryIndex===0?renderer.taaA:renderer.taaB)};
   if(reference)for(const [stage,value] of Object.entries(stages))quality.push({stage,...differences(reference[stage],value)});else reference=stages;
   captures.push({mode,frame:31,imageDataURL:canvas.toDataURL('image/png')});
  }
  const afterHash=await hash(fixture.scene.snapshot());if(afterHash!==fixture.replayHash)throw new Error('Paired rendering mutated physical state');
  const preparation=renderer.inspect(false).preparation,expectedFusedFrames=128+pairs*3*2+32;
  if(preparation.radiance.fusedFrames!==expectedFusedFrames||preparation.radiance.fallbackFrames!==0)throw new Error('Actual fused/scan switching was not observed');
  return{status:'completed',controls:{count,width,height,pairs,warmup:128,settleFramesPerVariant:2,scenarios:['static','camera-motion']},adapter:journal.adapter,sourceHash:fixture.sourceHash,geometryHash:fixture.geometryHash,replayHash:fixture.replayHash,afterHash,preparation,runs,quality,captures,
   gates:{nativeTimestamps:true,variantsExecuted:true,physicalReplay:true,finalCanonicalStages:quality.every(x=>x.changedChannels===0)},
   interpretation:'Same-device AB/BA pairs isolate steady-state CPU projection + environment cause checking. Both variants use the current numeric detector, same production shaders, scene, camera and timeline. Two untimed settling frames avoid charging certificate invalidation from the preceding opposite variant. CPU/GPU profiler overhead is present; queued waits mean these are not display FPS or frame interval. This does not independently compare the historical detector. Final-only opaque/HDR/TAA snapshots do not replace multi-frame and full wet quality gates.'};
 }finally{reader?.destroy();renderer?.dispose();await hooks.journals.at(-1)?.dispose();renderer?.device.destroy();hooks.uninstall();}
}
