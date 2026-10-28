import {Scene} from '../../dist/scene/scene.js';
import {WebGPURenderer} from '../../dist/render/webgpu.js';
import {EngineTrace,exportChromeTrace} from '../../dist/observability/trace.js';
import {TAA_SHADER} from '../../dist/render/lighting.js';
import {verifyTemporalResolve} from '../agent-office/taa-resolve-check.mjs';
import {verifyTemporalFinite} from '../agent-office/taa-finite-check.mjs';
import {createProbeReader,inspectProbePixels,compareProbePixels} from './probe-readback.mjs';

const assert=(condition,message)=>{if(!condition)throw new Error(message);};
const raf=()=>new Promise(resolve=>requestAnimationFrame(resolve));
const quantiles=values=>{const sorted=[...values].sort((a,b)=>a-b);return{mean:values.reduce((a,b)=>a+b,0)/values.length,p50:sorted[Math.floor((sorted.length-1)*.5)],p95:sorted[Math.floor((sorted.length-1)*.95)],max:sorted.at(-1)};};

async function readFiniteTarget(device,texture){
 const {width,height}=texture,row=Math.ceil(width*8/256)*256,buffer=device.createBuffer({size:row*height,usage:0x01|0x08});
 try{
  const encoder=device.createCommandEncoder({label:'render-stability finite HDR readback'});
  encoder.copyTextureToBuffer({texture},{buffer,bytesPerRow:row},[width,height]);device.queue.submit([encoder.finish()]);
  await buffer.mapAsync(1);const words=new Uint16Array(buffer.getMappedRange());let nonFinite=0,nonblackPixels=0,min=Infinity,max=-Infinity,sum=0;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
   let lit=false;
   for(let c=0;c<4;c++){
    const bits=words[y*row/2+x*4+c],exponent=(bits>>10)&31,fraction=bits&1023;
    if(exponent===31){nonFinite++;continue;}
    if(c===3)continue;
    const value=(bits&32768?-1:1)*(exponent?(1+fraction/1024)*2**(exponent-15):fraction*2**-24);
    min=Math.min(min,value);max=Math.max(max,value);sum+=value;lit||=value>.0001;
   }
   if(lit)nonblackPixels++;
  }
  buffer.unmap();assert(nonFinite===0,`Non-finite ${texture.label||texture.format}: ${nonFinite} channels`);
  assert(nonblackPixels>width*height*.25,'Rendered target is predominantly black');
  return{width,height,format:texture.format,checkedChannels:width*height*4,nonFinite,nonblackPixels,min,max,meanRgb:sum/(width*height*3)};
 }finally{buffer.destroy();}
}

function sceneFixture(){
 const entities=[
  {id:'ground',position:[0,-.12,0],mesh:{kind:'box',size:[42,.2,42]},material:{kind:'asphalt',color:[.37,.39,.42,1],roughness:.2},environmental:{surfaceUse:'road',waterDepthM:.004}},
  {id:'subject',position:[0,1.1,0],mesh:{kind:'sphere',radius:1.1,segments:24},material:{kind:'steel',color:[.32,.46,.7,1],roughness:.13,metalness:.7,clearcoat:1,clearcoatRoughness:.09}},
  {id:'red-wall',position:[-4,2.2,1],mesh:{kind:'box',size:[1,4.4,9]},material:{color:[.9,.13,.07,1],roughness:.45}},
  {id:'gold-wall',position:[4,2.2,-1],mesh:{kind:'box',size:[1,4.4,9]},material:{color:[.9,.65,.1,1],roughness:.45}},
  {id:'back',position:[0,2,-6],mesh:{kind:'box',size:[9,4,.8]},material:{color:[.12,.6,.35,1],roughness:.5}},
 ];
 for(let n=0;n<32;n++)entities.push({id:'pillar:'+n,renderOnly:true,position:[Math.cos(n/32*Math.PI*2)*12,1.5,Math.sin(n/32*Math.PI*2)*12],mesh:{kind:'box',size:[.5,3,.5]},material:{color:[.35+(n%3)*.1,.35,.48,1],roughness:.4}});
 return new Scene({version:1,seed:7018,entities,environment:{snowfall:'none',sunlight:.8,groundMoisture:.8},camera:{position:[0,4,10],target:[0,1,0],fov:55},rendering:{sunDirection:[-.4,.8,.3],sunIntensity:2.3,skyColor:[.25,.35,.5],fogDensity:.001,reflectionProbe:{entity:'subject',radius:30,boxHalfExtents:[6,4,7],facesPerFrame:4,exclude:['subject']}}});
}

globalThis.runRenderStability=async({width=480,height=270,trace=false}={})=>{
 const capture=trace?new EngineTrace({source:'native.webgpu',metadata:{width,height,scope:'Correctness fixture with synchronous diagnostic readbacks; not a game FPS benchmark'},budgets:{width,height,minSamples:8,required:['render.cpu.ms','render.gpu.ms']}}):undefined;
 let renderer,probeReader,scopeOpen=false;const report={version:2,status:'running',adapter:null,scenarios:[],probePixels:{method:'nearest cube sampling of every published mip-zero texel',readbacks:0,partialUnchanged:0,sameOriginComplete:0,movedOriginComplete:0,checkedChannels:0},taa:null,rendererErrors:[]};
 try{
  const adapter=await navigator.gpu?.requestAdapter({powerPreference:'high-performance'});assert(adapter,'Native WebGPU adapter unavailable');
  const info=adapter.info??await adapter.requestAdapterInfo?.()??{};
  report.adapter={vendor:info.vendor??'',architecture:info.architecture??'',device:info.device??'',description:info.description??'',isFallbackAdapter:adapter.isFallbackAdapter??info.isFallbackAdapter??null};
  assert(Object.values(report.adapter).some(value=>typeof value==='string'&&value.length>0),'GPU adapter identity unavailable');
  assert(report.adapter.isFallbackAdapter!==true&&!/swiftshader|lavapipe|llvmpipe|software|microsoft basic render/i.test(JSON.stringify(report.adapter)),'Software adapter rejected: '+JSON.stringify(report.adapter));
  globalThis.renderStabilityProgress='initializing native pipelines';
  const canvas=document.querySelector('canvas');renderer=await WebGPURenderer.create(canvas,{profiling:true,visibility:'gpu',logarithmicDepthFar:2000,features:{temporalAA:true,bloom:true,motionBlur:true}});renderer.setTrace(capture);
  renderer.setResolution(width,height);renderer.configurePostProcessing({temporalAA:true,bloom:true,motionBlur:.15});
  const device=renderer.device,scene=sceneFixture(),nativeEncoder=device.createCommandEncoder.bind(device);let currentTrace=null;
  device.createCommandEncoder=(...args)=>{
   const encoder=nativeEncoder(...args),nativeCopy=encoder.copyTextureToTexture.bind(encoder),nativePass=encoder.beginRenderPass.bind(encoder);
   encoder.copyTextureToTexture=(source,target,size)=>{if(source.texture===renderer.gpu.localProbeCapture){assert(target.texture===renderer.gpu.localProbeMap,'Probe published to an unexpected texture');currentTrace?.copies.push({extent:Array.from(size)});}return nativeCopy(source,target,size);};
   encoder.beginRenderPass=descriptor=>{if(/^render\.probe\.\d$/.test(descriptor.label)){assert(descriptor.colorAttachments[0].view!==renderer.gpu.localProbeView,'Capture cannot render into the sampled cubemap');currentTrace?.faces.push(Number(descriptor.label.at(-1)));}if(descriptor.label==='render.probe.filter')currentTrace&&(currentTrace.filters++);return nativePass(descriptor);};
   return encoder;
  };
  device.pushErrorScope('validation');scopeOpen=true;
  probeReader=await createProbeReader(device,renderer.gpu.localProbeMap);let previousCube=null,previousCubeOrigin=null;
  for(const scenario of ['static','camera-motion','probe-motion']){
   globalThis.renderStabilityProgress=scenario;renderer.resetTemporalHistory();const frames=[],cpu=[];
   let expectedOrigin=null,previousPublished=null;
   // Each scenario has an even frame count, ending exactly at a sweep boundary.
   for(let frame=0;frame<6;frame++){
    const position=scenario==='probe-motion'?[frame*.35,1.1,0]:[0,1.1,0];scene.setVisualTransform('subject',position);
    if(scenario!=='static'){scene.camera.position=[frame*.15,4,10-frame*.1];scene.camera.target=[frame*.04,1,0];}
    if(frame%2===0)expectedOrigin=[...position];
    currentTrace={frame,faces:[],filters:0,copies:[]};await raf();renderer.setTimelineFrame(frame);renderer.render(scene);
    const snapshot=renderer.inspect(false);cpu.push(renderer.profileLatest().cpu.totalMs);currentTrace.probe=snapshot.reflectionProbe;
    const completeFrame=frame%2===1;assert(currentTrace.copies.length===(completeFrame?1:0),`${scenario}/${frame}: incomplete probe publication`);
    assert(currentTrace.filters===(completeFrame?42:0),`${scenario}/${frame}: wrong mip filtering cadence`);
    assert(JSON.stringify(currentTrace.faces)===JSON.stringify(completeFrame?[4,5]:[0,1,2,3]),`${scenario}/${frame}: mixed capture sweeps`);
    if(completeFrame){assert(JSON.stringify(snapshot.reflectionProbe.position)===JSON.stringify(expectedOrigin),`${scenario}/${frame}: parallax origin differs from captured origin`);previousPublished=[...expectedOrigin];}
    else if(previousPublished)assert(JSON.stringify(snapshot.reflectionProbe.position)===JSON.stringify(previousPublished),'Partial sweep moved published parallax bounds');
    if(snapshot.reflectionProbe.complete){
     const cube=await probeReader.read(),pixels=inspectProbePixels(cube);assert(pixels.nonblackPixels>0,`${scenario}/${frame}: published probe has no visible radiance`);
     const sameOrigin=JSON.stringify(snapshot.reflectionProbe.position)===JSON.stringify(previousCubeOrigin),kind=previousCube?(completeFrame?(sameOrigin?'same-origin-complete':'moved-origin-complete'):'partial-unchanged'):'initial-publish';
     const difference=previousCube?compareProbePixels(previousCube,cube):null;
     if(kind==='partial-unchanged'){assert(difference.changedChannels===0,`${scenario}/${frame}: partial capture changed ${difference.changedChannels} published channels`);report.probePixels.partialUnchanged++;}
     if(kind==='same-origin-complete'){assert(difference.maxAbsError<=.000001,`${scenario}/${frame}: static recapture changed published radiance by ${difference.maxAbsError}`);report.probePixels.sameOriginComplete++;}
     if(kind==='moved-origin-complete'){assert(difference.changedRgbChannels>0&&difference.maxRgbError>.0001,`${scenario}/${frame}: changed capture origin did not update published radiance`);report.probePixels.movedOriginComplete++;}
     currentTrace.probePixels={kind,...pixels,...difference};report.probePixels.readbacks++;report.probePixels.checkedChannels+=pixels.checkedChannels;
     previousCube=cube;previousCubeOrigin=[...snapshot.reflectionProbe.position];
    }
    assert(snapshot.errors.length===0,snapshot.errors.join('\n'));frames.push(currentTrace);currentTrace=null;
   }
   await renderer.flush();
   const targets={};for(const [name,texture] of Object.entries({hdr:renderer.hdr,effects:renderer.effectsHdr,taa:renderer.taaHistoryIndex===0?renderer.taaA:renderer.taaB,reflection:renderer.reflection}))targets[name]=await readFiniteTarget(device,texture);
   report.scenarios.push({scenario,frames,cpuMs:quantiles(cpu),targets,profile:renderer.profile()});
  }
  assert(report.probePixels.partialUnchanged===8&&report.probePixels.sameOriginComplete===6&&report.probePixels.movedOriginComplete===2,'Published cube pixel checks did not cover every expected transition');
  globalThis.renderStabilityProgress='production TAA coordinate and finite-input checks';
  report.taa={coordinates:await verifyTemporalResolve(device,TAA_SHADER),finiteInputs:await verifyTemporalFinite(device,TAA_SHADER)};
  assert(report.taa.coordinates.status==='passed'&&report.taa.finiteInputs.status==='passed','Native TAA regression failed');
  await renderer.flush();const validation=await device.popErrorScope();scopeOpen=false;assert(!validation,validation?.message);
  report.rendererErrors=[...renderer.inspect(false).errors];assert(report.rendererErrors.length===0,report.rendererErrors.join('\n'));
  // Copy during the render transaction so canvas presentation cannot clear it.
  renderer.render(scene);globalThis.renderStabilityImage=canvas.toDataURL('image/png');await renderer.flush();
  report.rendererErrors=[...renderer.inspect(false).errors];assert(report.rendererErrors.length===0,report.rendererErrors.join('\n'));
  if(capture){await renderer.device.queue.onSubmittedWorkDone();await new Promise(resolve=>setTimeout(resolve,0));capture.stop();globalThis.enginePerformanceCapture=capture.snapshot();globalThis.enginePerformanceTrace=exportChromeTrace([capture.snapshot()]);report.trace={events:capture.snapshot().events.length,cpu:capture.snapshot().events.filter(e=>e.name==='render.cpu.ms').length,gpu:capture.snapshot().events.filter(e=>e.name==='render.gpu.ms').length};assert(report.trace.cpu>=18&&report.trace.gpu>=1,'Native trace must contain actual CPU and GPU samples');}
  report.status='passed';globalThis.renderStabilityProgress='passed';return report;
 }catch(error){report.status='failed';report.error=String(error.stack??error);report.phase=globalThis.renderStabilityProgress;if(renderer)report.rendererErrors=[...renderer.inspect(false).errors];return report;}
 finally{if(scopeOpen)await renderer.device.popErrorScope();probeReader?.dispose();renderer?.dispose();}
};
document.documentElement.dataset.ready='1';
