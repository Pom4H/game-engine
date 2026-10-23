import {WebGPURenderer} from '../../dist/render/webgpu.js';
import {createFixture,visibilityCamera,hash} from '../engine-compare/fixture.mjs';
import {requireHardware} from '../engine-compare/metrics.mjs';
import {InputReader,transform,differences} from './temporal-diagnostic.mjs';
import {flatInstancePayload} from './flat-instance-payload.mjs';
import {lightingProbe,lightingProbeChannels} from './lighting-probe.mjs';
import {ColorReadbackCheck} from './color-readback-check.mjs';
import {OpaqueBoundary} from './opaque-boundary.mjs';
import {velocityExportAgreement} from './velocity-export-check.mjs';
import {materialInputAgreement} from './material-input-check.mjs';
import {MaterialUniformObserver,MATERIAL_UNIFORM_WORDS} from './material-uniforms.mjs';
import {FullPrecisionProbe,installProbePipelines,installProbeDeviceLimit,PROBE_COLOR_ATTACHMENT_BYTES} from './full-precision-probe.mjs';
import {worldInputIndexAgreement} from './world-input-check.mjs';

class IndexReader {
 constructor(device){
  this.device=device;this.targets=new Map();const module=device.createShaderModule({code:`
@group(0) @binding(0) var<storage,read> source:array<u32>;
@group(0) @binding(1) var<storage,read_write> output:array<u32>;
@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) id:vec3<u32>){if(id.x<arrayLength(&output)){output[id.x]=source[id.x];}}`});
  this.pipeline=device.createComputePipeline({layout:'auto',compute:{module,entryPoint:'main'}});
  const frameModule=device.createShaderModule({code:`struct FrameWords{words:array<vec4<u32>,40>};
@group(0) @binding(0) var<uniform> source:FrameWords;
@group(0) @binding(1) var<storage,read_write> output:array<u32>;
@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) id:vec3<u32>){let n=id.x;if(n<arrayLength(&output)){output[n]=source.words[n/4u][n%4u];}}`});
  this.framePipeline=device.createComputePipeline({layout:'auto',compute:{module:frameModule,entryPoint:'main'}});
 }
 async read(source,count,uniform=false){
  if(uniform&&(count!==160||source.size!==640))throw new Error('Unexpected production Frame ABI');
  const bytes=Math.max(4,count*4);let target=this.targets.get(bytes);if(!target){target={output:this.device.createBuffer({size:bytes,usage:0x80|0x04}),readback:this.device.createBuffer({size:bytes,usage:0x01|0x08})};this.targets.set(bytes,target);}
  const pipeline=uniform?this.framePipeline:this.pipeline,bind=this.device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:source}},{binding:1,resource:{buffer:target.output}}]});const encoder=this.device.createCommandEncoder(),pass=encoder.beginComputePass();pass.setPipeline(pipeline);pass.setBindGroup(0,bind);pass.dispatchWorkgroups(Math.ceil(bytes/4/64));pass.end();encoder.copyBufferToBuffer(target.output,0,target.readback,0,bytes);this.device.queue.submit([encoder.finish()]);
  try{await target.readback.mapAsync(1);return new Uint32Array(target.readback.getMappedRange().slice(0,count*4));}finally{target.readback.unmap();}
 }
 destroy(){for(const target of this.targets.values()){target.output.destroy();target.readback.destroy();}}
}
function shuffled(values){
 const result=values.slice();let state=0x731b19;
 for(let index=result.length-1;index>0;index--){state^=state<<13;state^=state>>>17;state^=state<<5;const other=(state>>>0)%(index+1),old=result[index];result[index]=result[other];result[other]=old;}return result;
}
const words=(bytes,encoding)=>encoding.startsWith('depth')||encoding.startsWith('uint32')||encoding.startsWith('rgba32')?new Uint32Array(bytes.buffer):encoding.startsWith('rgba8')?bytes:new Uint16Array(bytes.buffer);
const originalRotation='let phase=fract(sin(dot(floor(p.xz*2.0),vec2<f32>(12.9898,78.233)))*43758.5453)*6.2831853;';

/** Controlled intervention: both branches use the same ordered CPU frustum
 * result and an additional queue write. Only the camera-instance sequence
 * changes; optional diagnostic shader probes are recorded explicitly. */
export async function diagnoseInstanceOrder({count=10000,width=1920,height=1080,repetitions=2,flatPayload=false,continuousShadow=false,shadowInputs=false,instanceInputs=false,materialUniforms=false,readbackChecks=false,opaqueBoundary=false,lightingProbe:probe=false,probeKind='scalars',probeF32=false}={}){
 if(probe&&(flatPayload||continuousShadow))throw new Error('Observe production lighting before combining shader interventions');
 const velocityExports=probe&&probeKind==='velocity-input';
 const materialInputs=probe&&probeKind==='material-input';
 const worldInputs=probe&&probeKind==='world-input';
 if(probeF32&&(!probe||velocityExports||materialInputs))throw new Error('Full-precision probe requires scalar, environment or world-input lighting observation');
 if(worldInputs&&(!probeF32||!instanceInputs))throw new Error('World input probe requires full precision and instance source observations');
 if(materialInputs&&(!instanceInputs||count>30719))throw new Error('Material input probe requires source observations and at most 30719 instances');
 if(opaqueBoundary&&probe&&!velocityExports&&!materialInputs&&!probeF32)throw new Error('Only fragment input or full-precision probes support opaque boundary observations');
 if(probe)lightingProbeChannels(probeKind);
 const adapter=await navigator.gpu.requestAdapter({powerPreference:'high-performance'}),info=adapter.info,adapterInfo={vendor:info.vendor,architecture:info.architecture,description:info.description,isFallbackAdapter:adapter.isFallbackAdapter};requireHardware(adapterInfo);
 const fixture=await createFixture(count),canvas=document.querySelector('canvas'),reference=[],repeatHashes=new Map(),runs=[],captures=[];
 for(const ordering of ['ascending','shuffled'])for(let repetition=0;repetition<repetitions;repetition++){
  let renderer,reader,indices,staticReader,dynamicReader,colorCheck,boundary,uniformObserver,precisionProbe;const candidateModules=[],nativeCreateShader=GPUDevice.prototype.createShaderModule,pipelineHook=probeF32?installProbePipelines(GPUDevice.prototype):null,limitHook=probeF32?installProbeDeviceLimit(GPUAdapter.prototype):null;
  if(flatPayload||continuousShadow||probe)GPUDevice.prototype.createShaderModule=function(descriptor){let code=flatPayload?flatInstancePayload(descriptor.code):descriptor.code;if(continuousShadow)code=code.replace(originalRotation,'let phase=dot(p.xz,vec2<f32>(.31,.73));');if(probe)code=lightingProbe(code,probeKind);if(code!==descriptor.code)candidateModules.push(code);return nativeCreateShader.call(this,{...descriptor,code});};
  try{renderer=await WebGPURenderer.create(canvas,{visibility:'cpu-batched',profiling:false});}finally{GPUDevice.prototype.createShaderModule=nativeCreateShader;pipelineHook?.restore();limitHook?.restore();}
  if(flatPayload&&!continuousShadow&&candidateModules.length!==2)throw new Error('Expected main/reflection candidate modules');
  if(continuousShadow&&!candidateModules.length)throw new Error('Shadow rotation candidate not applied');
  if(probe&&candidateModules.length!==3)throw new Error('Expected main/relief/instanced lighting probes');
  try{
   renderer.setResolution(width,height);await renderer.prepareMaterials(fixture.scene);reader=new InputReader(renderer.device,width,height);indices=new IndexReader(renderer.device);
   if(readbackChecks)colorCheck=new ColorReadbackCheck(renderer.device,width,height);
   if(probeF32){if(!pipelineHook.state.promoted)throw new Error('No full-precision pipelines promoted');precisionProbe=new FullPrecisionProbe(renderer,width,height);}
   if(materialUniforms)uniformObserver=new MaterialUniformObserver(renderer);
   if(opaqueBoundary)boundary=new OpaqueBoundary(renderer,reader,width,height,precisionProbe?.texture);
   if(shadowInputs){staticReader=new InputReader(renderer.device,renderer.gpu.shadow.width,renderer.gpu.shadow.height);dynamicReader=new InputReader(renderer.device,renderer.gpu.dynamicShadow.width,renderer.gpu.dynamicShadow.height);}
   const visibility=renderer.gpu.visibility,encode=visibility.encode.bind(visibility);let expected=[];
   visibility.encode=(encoder,requests,mode,timestamps)=>{
    const result=encode(encoder,requests,mode,timestamps);expected=[];
    for(const request of requests)if(request.batch.visibleIndices.label.startsWith('camera')){
     const original=request.batch.cpuIndices.slice(0,request.batch.cpuVisibleCount),values=ordering==='ascending'?original:shuffled(original);
     if(values.length)renderer.device.queue.writeBuffer(request.batch.visibleIndices,0,values);
     expected.push({batch:request.batch,values,sorted:original});
    }return result;
   };
   for(let frame=0;frame<288;frame++){renderer.setTimelineFrame(frame);renderer.render(fixture.scene,visibilityCamera(frame,'camera-motion'));await renderer.flush();}
   renderer.resetTemporalHistory();const frames=[];
   if(boundary&&(renderer.collectedTransparent.length||fixture.scene.environment.snowfallRate!==0))throw new Error('Boundary agreement requires no transparent objects or snowfall');
   for(let frame=0;frame<32;frame++){
    precisionProbe?.beginFrame();uniformObserver?.beginFrame();boundary?.beginFrame();
    renderer.setTimelineFrame(frame);renderer.render(fixture.scene,visibilityCamera(0));await renderer.flush();
    const visible=[];
    for(const entry of expected){
     const actual=await indices.read(entry.batch.visibleIndices,entry.values.length);if(actual.some((value,index)=>value!==entry.values[index]))throw new Error('GPU did not consume requested order');
     const sorted=actual.slice().sort();if(sorted.some((value,index)=>value!==entry.sorted[index]))throw new Error('Visible set changed');visible.push({count:actual.length,setHash:await hash(sorted),orderHash:await hash(actual)});
    }
    const stages={opaque:await reader.readColor(renderer.opaqueScene),hdr:await reader.readColor(renderer.hdr),normal:await reader.readColor(precisionProbe?.texture??renderer.normal),specular:await reader.readPacked(renderer.specular,'specular'),current:await reader.readColor(renderer.effectsHdr),velocity:await reader.readPacked(renderer.velocity,'velocity'),depth:await reader.readPacked(renderer.depth,'depth'),taa:await reader.readColor(renderer.taaHistoryIndex===0?renderer.taaA:renderer.taaB)},result={frame,visible,stages:{}};
    if(precisionProbe)result.probe32Checks={...precisionProbe.finishFrame(),promotedPipelines:pipelineHook.state.promoted,adapterColorAttachmentLimit:limitHook.state.adapterLimit,requestedColorAttachmentLimit:limitHook.state.requestedLimit};
    if(boundary){const observed=await boundary.read(stages);Object.assign(stages,observed.stages);result.opaqueBoundaryChecks=observed.checks;}
    if(uniformObserver){const observed=await uniformObserver.read();Object.assign(stages,observed.stages);result.materialUniformChecks=observed.checks;}
    if(velocityExports)result.velocityExportChecks={final:velocityExportAgreement(stages.normal,stages.velocity,stages.depth),...(boundary?{afterOpaque:velocityExportAgreement(stages.normalAfterOpaque,stages.velocityAfterOpaque,stages.depth)}:{})};
    if(materialInputs){
     if(expected.length!==1||renderer.cameraBatches.size!==1)throw new Error('Material input fixture requires one camera instance batch');
     const entry=expected[0],batch=renderer.cameraBatches.values().next().value;
     if(batch.visibility!==entry.batch)throw new Error('Material input camera/source association changed');
     const source=batch.stream.data.subarray(0,batch.items.length*40);
     result.materialInputChecks={final:materialInputAgreement(stages.normal,stages.depth,source,entry.sorted),...(boundary?{afterOpaque:materialInputAgreement(stages.normalAfterOpaque,stages.depth,source,entry.sorted)}:{})};
    }
    if(worldInputs){if(expected.length!==1)throw new Error('World input fixture requires one camera instance batch');result.worldInputChecks={final:worldInputIndexAgreement(stages.normal,stages.depth,count,expected[0].sorted),...(boundary?{afterOpaque:worldInputIndexAgreement(stages.normalAfterOpaque,stages.depth,count,expected[0].sorted)}:{})};}
    if(probe){stages.lightingProbe=stages.normal;delete stages.normal;if(boundary){stages.lightingProbeAfterOpaque=stages.normalAfterOpaque;delete stages.normalAfterOpaque;}}
    if(colorCheck)result.readbackChecks={opaque:await colorCheck.check(renderer.opaqueScene,stages.opaque,reader),[probe?'lightingProbe':'normal']:await colorCheck.check(precisionProbe?.texture??renderer.normal,stages[probe?'lightingProbe':'normal'],reader)};
    if(colorCheck&&velocityExports)result.readbackChecks.velocity=await colorCheck.checkVelocity(renderer.velocity,stages.velocity,reader);
    if(instanceInputs)for(const [key,batch] of renderer.cameraBatches){
     const count=batch.items.length*40,pixels=await indices.read(batch.buffer,count),cpuWords=new Uint32Array(batch.stream.data.buffer,batch.stream.data.byteOffset,count);
     if(pixels.some((value,index)=>value!==cpuWords[index]))throw new Error('GPU instance source differs from production CPU records');
     stages['instanceSource:'+key]={width:pixels.length,height:1,channels:1,encoding:'uint32 instance source words',pixels};
    }
    if(shadowInputs){
     if(frame===0)stages.staticShadow=await staticReader.readPacked(renderer.gpu.shadow,'depth');
     stages.dynamicShadow=await dynamicReader.readPacked(renderer.gpu.dynamicShadow,'depth');
     for(const [name,buffer,uniform] of [['frameUniform',renderer.gpu.frame,true],['lightSources',renderer.gpu.lightBuffer,false],['lightCells',renderer.gpu.cellBuffer,false]]){
      const pixels=await indices.read(buffer,buffer.size/4,uniform);stages[name]={width:pixels.length,height:1,channels:1,encoding:'uint32 buffer words',pixels};
     }
    }
    for(const [name,stage] of Object.entries(stages)){
     const bytes=new Uint8Array(stage.pixels.buffer),digest=await hash(bytes);let comparison=null;
     if(ordering==='ascending'&&repetition===0)(reference[frame]??={})[name]={width:stage.width,height:stage.height,channels:stage.channels,encoding:stage.encoding,hash:digest,compressed:await transform(bytes,new CompressionStream('deflate-raw'))};
     else{
      const old=reference[frame][name];if(digest===old.hash)comparison={changedChannels:0,maxEncodedError:0,coordinates:[]};else{const bytes=await transform(old.compressed,new DecompressionStream('deflate-raw'));comparison=differences({...old,pixels:words(bytes,old.encoding)},stage);}
     }
     const key=ordering+':'+frame+':'+name;if(repetition===0)repeatHashes.set(key,digest);const sameOrderingRepeat=digest===repeatHashes.get(key);
     result.stages[name]={hash:digest,width:stage.width,height:stage.height,channels:stage.channels,encoding:stage.encoding,comparison,sameOrderingRepeat};
    }
    frames.push(result);if(repetition===0&&frame===31)captures.push({mode:ordering,frame,imageDataURL:canvas.toDataURL('image/png')});
   }
   const afterHash=await hash(fixture.scene.snapshot());if(afterHash!==fixture.replayHash)throw new Error('Order intervention mutated physics');const inspect=renderer.inspect(false);if(inspect.errors.length)throw new Error(inspect.errors.join('\n'));
   runs.push({mode:ordering,repetition,afterHash,candidateModuleHashes:await Promise.all(candidateModules.map(hash)),frames,stages:frames.at(-1).stages,firstDivergentFrame:frames.find(f=>Object.values(f.stages).some(s=>s.comparison?.changedChannels))?.frame??null,repeatable:frames.every(f=>Object.values(f.stages).every(s=>s.sameOrderingRepeat))});
   console.info('TEMPORAL_DIAGNOSTIC '+JSON.stringify({ordering,repetition,firstDivergentFrame:runs.at(-1).firstDivergentFrame,repeatable:runs.at(-1).repeatable}));
  }finally{boundary?.destroy();uniformObserver?.destroy();precisionProbe?.destroy();reader?.destroy();indices?.destroy();staticReader?.destroy();dynamicReader?.destroy();colorCheck?.destroy();renderer.dispose();renderer.device.destroy();}
 }
 return{status:'completed',controls:{count,width,height,repetitions,flatPayload,continuousShadow,shadowInputs,instanceInputs,materialUniforms,readbackChecks,opaqueBoundary,lightingProbe:probe,probeKind,probeF32,warmupMotionFrames:288,canonicalFrames:32},lightingProbe:probe?{kind:probeKind,attachment:probeF32?'diagnostic normal replacement rgba32float':'normal rgba16float',channels:lightingProbeChannels(probeKind),productionRadiancePreserved:true,postprocessUsesProbeNormals:!probeF32,postprocessNormalInput:probeF32?'original normal texture remains untouched and initialized to zero':'probe values in original normal attachment',qualityMeasurement:false,performanceMeasurement:false}:null,adapter:adapterInfo,sourceHash:fixture.sourceHash,geometryHash:fixture.geometryHash,replayHash:fixture.replayHash,runs,captures,
  fullPrecisionProbe:probeF32?{format:'rgba32float',encoding:'rgba32float raw words',colorAttachmentBytesPerSample:PROBE_COLOR_ATTACHMENT_BYTES,requiredColorAttachmentLimit:PROBE_COLOR_ATTACHMENT_BYTES,deviceLimitsChanged:true,originalNormalWritten:false,shaderOutputChanged:true,pipelineTargetsChanged:true,opaqueRenderInputsChanged:false,postprocessNormalInputChanged:true,optionalFeaturesRequested:false,qualityMeasurement:false,performanceMeasurement:false}:null,
  worldInput:worldInputs?{attachment:'diagnostic normal replacement rgba32float',position:'actual fragment in.worldPos xyz',index:'exact float32 input.sourceIndex for instanced geometry; -1 for regular geometry',checks:'source index membership in actual GPU-validated CPU frustum set; no reconstructed world-position tolerance',sourceAgreement:'actual GPU source words must equal production CPU records every captured frame',checkedStages:['final',...(opaqueBoundary?['afterOpaque']:[])]}:null,
  materialUniforms:materialUniforms?{words:MATERIAL_UNIFORM_WORDS,bytes:MATERIAL_UNIFORM_WORDS*4,hostReference:'complete captured queue.writeBuffer byte image at each actual opaque material draw',gpuObservation:'uniform vec4<u32> compute read immediately after opaque pass end in the original command encoder',sourceBinding:'actual binding 0 resource, zero static/dynamic offset, mapped to one renderer object',renderShadersModified:flatPayload||continuousShadow||probe,qualityMeasurement:false,performanceMeasurement:false}:null,
  materialInput:materialInputs?{attachment:'normal rgba16float',sourceStrideFloats:40,colorOffsetFloats:32,indexRawWordOffset:1024,nonInstancedSentinel:0x7bff,indexPrecision:'exact normal binary16 value decoded by raw word',colorConversion:'only the adjacent representable binary16 interval from each recorded binary32 source component; cross-frame image comparisons remain exact',checkedStages:['final',...(opaqueBoundary?['afterOpaque']:[])],sourceAgreement:'actual GPU source words must equal production CPU records every captured frame'}:null,
  interpretation:'Fresh native devices with the same CPU frustum set. Both controls add one equal-size queue write per camera list; only ascending versus fixed-seed shuffled instance order changes within each experiment. Actual GPU storage indices must match the intervention, and their sorted set must be identical. Reflection lists, source matrices/materials, camera and physical state are unchanged. flatPayload selects a diagnostic-only color/seed vertex payload candidate; continuousShadow selects smooth world-space PCF rotation instead of a discontinuous half-metre hash. lightingProbe observes selected fragment values while preserving production color arithmetic. Binary16 probes replace the original normal output consumed by effects. probeF32 instead promotes only the diagnostic normal attachment and pipeline slot to rgba32float, retains full float words in native copies and independent compute checks, and leaves the original normal texture untouched but bound to postprocessing. Its downstream images cannot certify quality. The world-input probe observes fragment world XYZ and an exact source index, validating index membership in the actual visible set. These observations do not reconstruct or establish equality of every fragment input. The velocity-input probe duplicates interpolated in.velocity in another binary16 MRT; velocityExportChecks compares every geometry-covered x/y word exactly, excluding and counting depth-clear background. The material-input probe checks fragment RGB against the actual source record selected by its exactly encoded index and the recorded visible set; conversion bounds and source ABI are recorded separately. An opaqueBoundary probe also compares the fragment observations at pass end. Shader instrumentation may change compiler scheduling. Candidate module hashes and probe channel meanings are recorded. Every captured stage channel is compared exactly against ascending references; shadowInputs additionally reads the initial static map, per-frame dynamic shadow, Frame uniform and light source/cell buffers. instanceInputs reads every camera batch source buffer, requires exact equality with production CPU 40-float records and compares repeat hashes. readbackChecks compares native opaque/normal binary16 copies with independent compute textureLoad binary32 bitcasts and another native copy without a new render. For velocity-input it also checks packed RG16 velocity against the independent binary32 path and a repeated packed read; the packed specular codec is not independently validated. opaqueBoundary captures all four MRT outputs immediately after the opaque pass in the original command encoder and compares them with the same textures after the full frame; the fixture must have no transparent or snow draws. Observations preserve original texture usage but can alter GPU scheduling; render shaders are unchanged only when shader intervention flags are absent. Missing checks fail coverage; disagreements fail their agreement gates and strict repeatability. Same-order repeat SHA256 is checked independently. Additional dispatches/readbacks/waits are correctness observations, not performance measurements. Divergence and same-order repeatability must be considered together: variation alone does not establish deterministic dependence on instance order or identify a shader/driver cause.'};
}
