import {WebGPURenderer} from '../../dist/render/webgpu.js';
import {SHADOW_FILTER_WGSL,STATIC_SHADOW_SAMPLES,DYNAMIC_SHADOW_SAMPLES} from '../../dist/render/shadow-filter.js';
import {installGPUJournal} from '../engine-compare/gpu-journal.mjs';
import {requireHardware} from '../engine-compare/metrics.mjs';
import {hash} from '../engine-compare/fixture.mjs';

/** Analytic visibility regression on real WGSL. References average each map's
 * individual filtered comparison samples, then combine map coverages. The same
 * function/counts must be present in all actual production material modules. */
export async function diagnoseShadowFilter(){
 const hooks=installGPUJournal(),nativeModule=GPUDevice.prototype.createShaderModule,modules=[],materialModules=[];let renderer,input,output,readback;
 GPUDevice.prototype.createShaderModule=function(descriptor){
  if(descriptor.code.includes('fn shadowAt(')){
   if(!descriptor.code.includes(SHADOW_FILTER_WGSL)||!descriptor.code.includes('combineShadowVisibility(staticValue,dynamicValue)')||!descriptor.code.includes('i<STATIC_SHADOW_SAMPLES')||!descriptor.code.includes('i<DYNAMIC_SHADOW_SAMPLES')||!descriptor.code.includes('dynamicValue=f32(DYNAMIC_SHADOW_SAMPLES)')||!descriptor.code.includes('shadowReceiverGradient(dpdx(plane),dpdy(plane))')||(descriptor.code.match(/clip\.z\+dot\(gradient,offset\)-\.000025/g)??[]).length!==2)throw new Error('Production material bypasses normalized coverage, shared sample counts or receiver-plane depth comparisons');
   modules.push(descriptor.code);
   const module=nativeModule.call(this,descriptor);materialModules.push(module);return module;
  }return nativeModule.call(this,descriptor);
 };
 try{
  renderer=await WebGPURenderer.create(document.querySelector('canvas'),{visibility:'gpu',profiling:false});
  GPUDevice.prototype.createShaderModule=nativeModule;
  if(modules.length!==3)throw new Error('Expected main, relief and instance material modules');
  // Publish initialization commands before querying all material modules;
  // otherwise the headless host can leave compilation-info requests pending.
  renderer.device.queue.submit([]);
  const productionCompilation=await Promise.all(materialModules.map(async(module,index)=>({material:['main','relief','instances'][index],messages:(await module.getCompilationInfo()).messages.map(message=>({type:message.type,message:message.message,lineNum:message.lineNum,linePos:message.linePos,offset:message.offset,length:message.length}))})));
  const journal=hooks.journals.at(-1);requireHardware(journal.adapter);const device=renderer.device,cases=[];
  const add=(staticSamples,dynamicSamples,label)=>cases.push({staticSamples,dynamicSamples,label});
  const total=STATIC_SHADOW_SAMPLES+DYNAMIC_SHADOW_SAMPLES;
  for(let mask=0;mask<2**total;mask++)add(Array.from({length:STATIC_SHADOW_SAMPLES},(_,n)=>(mask>>>n)&1),Array.from({length:DYNAMIC_SHADOW_SAMPLES},(_,n)=>(mask>>>(STATIC_SHADOW_SAMPLES+n))&1),'binary:'+mask);
  let random=731;const sample=()=>{random^=random<<13;random^=random>>>17;random^=random<<5;return(random>>>0&255)/256;};
  for(let n=0;n<4096;n++)add(Array.from({length:STATIC_SHADOW_SAMPLES},sample),Array.from({length:DYNAMIC_SHADOW_SAMPLES},sample),'filtered:'+n);
  for(let n=0;n<=16;n++)add(Array.from({length:STATIC_SHADOW_SAMPLES},()=>n/16),Array(DYNAMIC_SHADOW_SAMPLES).fill(1),'dynamic-disabled:'+n);
  const average=values=>values.reduce((sum,x)=>sum+x,0)/values.length;
  const expected=cases.map(c=>Math.min(average(c.staticSamples),average(c.dynamicSamples))),totals=new Float32Array(cases.length*2);
  for(let n=0;n<cases.length;n++){totals[n*2]=cases[n].staticSamples.reduce((sum,x)=>sum+x,0);totals[n*2+1]=cases[n].dynamicSamples.reduce((sum,x)=>sum+x,0);}
  const code=SHADOW_FILTER_WGSL+`
@group(0) @binding(0) var<storage,read> source:array<vec2<f32>>;
@group(0) @binding(1) var<storage,read_write> results:array<vec2<f32>>;
@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) id:vec3<u32>){
 if(id.x<arrayLength(&source)){let sums=source[id.x];results[id.x]=vec2<f32>(combineShadowVisibility(sums.x,sums.y),min(sums.x,sums.y)*.5);}
}`;
  const module=device.createShaderModule({label:'analytic production shadow filter',code}),info=await module.getCompilationInfo();if(info.messages.some(x=>x.type==='error'))throw new Error('Shadow regression shader did not compile');
  device.pushErrorScope('validation');
  input=device.createBuffer({size:totals.byteLength,usage:0x80|0x08});output=device.createBuffer({size:totals.byteLength,usage:0x80|0x04});readback=device.createBuffer({size:totals.byteLength,usage:0x01|0x08});device.queue.writeBuffer(input,0,totals);
  const pipeline=device.createComputePipeline({layout:'auto',compute:{module,entryPoint:'main'}}),bind=device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:input}},{binding:1,resource:{buffer:output}}]});
  const encoder=device.createCommandEncoder(),pass=encoder.beginComputePass();pass.setPipeline(pipeline);pass.setBindGroup(0,bind);pass.dispatchWorkgroups(Math.ceil(cases.length/64));pass.end();encoder.copyBufferToBuffer(output,0,readback,0,totals.byteLength);device.queue.submit([encoder.finish()]);
  await readback.mapAsync(1);const actual=new Float32Array(readback.getMappedRange().slice(0));readback.unmap();const validation=await device.popErrorScope();if(validation)throw new Error(validation.message);
  let changedLegacyCases=0,maxLegacyError=0,maxError=0;const failures=[],examples=[];
  for(let n=0;n<cases.length;n++){
   const value=actual[n*2],legacy=actual[n*2+1],error=Math.abs(value-expected[n]);if(!Number.isFinite(value)||error!==0)failures.push({case:n,label:cases[n].label,value,expected:expected[n],error});maxError=Math.max(maxError,error);
   const oldError=Math.abs(legacy-expected[n]);if(oldError){changedLegacyCases++;maxLegacyError=Math.max(maxLegacyError,oldError);if(examples.length<8)examples.push({...cases[n],expected:expected[n],actual:value,legacy});}
  }
  if(!changedLegacyCases)throw new Error('Reference cases do not expose the original unequal-kernel error');
  // Affine receiver planes, including mirrored/rotated/sheared screen-to-light
  // coordinates. References use the authored plane coefficients, not the
  // shader's inverse formula. Singular projections must stay finite and neutral.
  const jacobians=[[[1/64,0],[0,1/64]],[[0,1/64],[-1/64,0]],[[-1/64,0],[0,1/64]],[[1/64,1/128],[-1/128,1/64]],[[1/512,0],[0,1/64]],[[1/64,1/256],[0,1/32]],[[1/128,-1/256],[1/256,1/128]],[[0,0],[0,0]],[[1/64,1/64],[1/32,1/32]]],planes=[];
  for(const a of [-4,-1,0,.25,2])for(const b of [-2,-.5,0,.75,4])for(let j=0;j<jacobians.length;j++){
   const [dx,dy]=jacobians[j],singular=j>=7;planes.push({a,b,dx:[...dx,a*dx[0]+b*dx[1],0],dy:[...dy,a*dy[0]+b*dy[1],0],expected:singular?[0,0,.25,1]:[a,b,.25+a/32-b/64,1]});
  }
  const planeInputs=new Float32Array(planes.length*8);planes.forEach((p,n)=>{planeInputs.set(p.dx,n*8);planeInputs.set(p.dy,n*8+4);});
  const planeModule=device.createShaderModule({label:'analytic receiver plane',code:SHADOW_FILTER_WGSL+`
struct Derivatives {dx:vec4<f32>,dy:vec4<f32>};
@group(0) @binding(0) var<storage,read> source:array<Derivatives>;
@group(0) @binding(1) var<storage,read_write> results:array<vec4<f32>>;
@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) id:vec3<u32>){
 if(id.x<arrayLength(&source)){let g=shadowReceiverGradient(source[id.x].dx.xyz,source[id.x].dy.xyz);results[id.x]=vec4<f32>(g,.25+dot(g,vec2<f32>(1.0/32.0,-1.0/64.0)),1.0);}
}`});
  const planeInfo=await planeModule.getCompilationInfo();if(planeInfo.messages.some(x=>x.type==='error'))throw new Error('Receiver plane regression shader did not compile');
  input.destroy();output.destroy();readback.destroy();device.pushErrorScope('validation');
  input=device.createBuffer({size:planeInputs.byteLength,usage:0x80|0x08});output=device.createBuffer({size:planes.length*16,usage:0x80|0x04});readback=device.createBuffer({size:planes.length*16,usage:0x01|0x08});device.queue.writeBuffer(input,0,planeInputs);
  const planePipeline=device.createComputePipeline({layout:'auto',compute:{module:planeModule,entryPoint:'main'}}),planeBind=device.createBindGroup({layout:planePipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:input}},{binding:1,resource:{buffer:output}}]}),planeEncoder=device.createCommandEncoder(),planePass=planeEncoder.beginComputePass();planePass.setPipeline(planePipeline);planePass.setBindGroup(0,planeBind);planePass.dispatchWorkgroups(Math.ceil(planes.length/64));planePass.end();planeEncoder.copyBufferToBuffer(output,0,readback,0,planes.length*16);device.queue.submit([planeEncoder.finish()]);
  await readback.mapAsync(1);const planeValues=new Float32Array(readback.getMappedRange().slice(0));readback.unmap();const planeValidation=await device.popErrorScope();if(planeValidation)throw new Error(planeValidation.message);
  const gradientFailures=[];let maxGradientError=0;
  for(let n=0;n<planes.length;n++)for(let c=0;c<4;c++){const value=planeValues[n*4+c],error=Math.abs(value-planes[n].expected[c]);maxGradientError=Math.max(maxGradientError,error);if(!Number.isFinite(value)||error>1e-6)gradientFailures.push({case:n,channel:c,value,expected:planes[n].expected[c],error});}
  return{status:'completed',controls:{cases:cases.length,staticSamples:STATIC_SHADOW_SAMPLES,dynamicSamples:DYNAMIC_SHADOW_SAMPLES,binaryCases:2**total,filteredCases:4096,dynamicDisabledCases:17,receiverPlanes:planes.length,receiverPlaneAbsoluteTolerance:1e-6},adapter:journal.adapter,shaderContractHash:await hash(SHADOW_FILTER_WGSL),productionModuleHashes:await Promise.all(modules.map(hash)),productionCompilation,inputsHash:await hash(totals),outputsHash:await hash(actual),maxError,failures,changedLegacyCases,maxLegacyError,examples,receiverPlanes:{maxError:maxGradientError,failures:gradientFailures,inputsHash:await hash(planeInputs),outputsHash:await hash(planeValues)},
   gates:{nativeHardware:true,productionContractPresent:true,normalizedCoverage:failures.length===0,receiverPlaneDepth:gradientFailures.length===0,originalErrorExposed:true},
   interpretation:'Actual GPU evaluates the production WGSL helper used by main/relief/instance material shaders. Independent references average individual static/dynamic filtered comparison samples. Binary, fractional and dynamic-disabled coverage cases compare with zero tolerance. The old min(sumStatic,sumDynamic)*0.5 exposes incorrect static weighting. Receiver-plane references use authored affine slopes across mirrored/rotated/sheared projections, with a declared 1e-6 f32 absolute tolerance and finite neutral fallback for singular projections. These kernel checks do not prove image repeatability, full-frame performance or competitive quality.'};
 }finally{GPUDevice.prototype.createShaderModule=nativeModule;input?.destroy();output?.destroy();readback?.destroy();renderer?.dispose();await hooks.journals.at(-1)?.dispose();renderer?.device.destroy();hooks.uninstall();}
}
