import {WebGPURenderer} from '../../dist/render/webgpu.js';
import {buildRenderFrame} from '../../dist/render/frame.js';
import {primitiveMesh} from '../../dist/procedural/mesh.js';
import {lookAt,perspective,multiply4} from '../../dist/math.js';
import {meshBounds,intersectsClip} from '../../dist/render/visibility.js';
import {createFixture,hash} from '../engine-compare/fixture.mjs';
import {requireHardware} from '../engine-compare/metrics.mjs';

// Read real production storage/uniform bindings after rendering. The extra
// dispatch never modifies those bindings, their usage flags, or render inputs.
class BufferReader {
 constructor(device){
  this.device=device;this.targets=new Map();this.pipelines={};
  for(const kind of ['instance','uniform']){
   const source=kind==='instance'?'@group(0) @binding(0) var<storage,read> source:array<f32>;':'struct Object {words:array<vec4<f32>,23>}; @group(0) @binding(0) var<uniform> source:Object;';
   const value=kind==='instance'?'source[n]':'source.words[n/4u][n%4u]';
   const module=device.createShaderModule({label:'history diagnostic '+kind,code:`${source}
@group(0) @binding(1) var<storage,read_write> output:array<f32>;
@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) id:vec3<u32>){let n=id.x;if(n<arrayLength(&output)){output[n]=${value};}}`});
   this.pipelines[kind]=device.createComputePipeline({layout:'auto',compute:{module,entryPoint:'main'}});
  }
 }
 async read(source,kind,bytes){
  let target=this.targets.get(bytes);if(!target){target={output:this.device.createBuffer({size:bytes,usage:0x80|0x04}),readback:this.device.createBuffer({size:bytes,usage:0x01|0x08})};this.targets.set(bytes,target);}
  const pipeline=this.pipelines[kind],bind=this.device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:source}},{binding:1,resource:{buffer:target.output}}]});
  const encoder=this.device.createCommandEncoder(),pass=encoder.beginComputePass();pass.setPipeline(pipeline);pass.setBindGroup(0,bind);pass.dispatchWorkgroups(Math.ceil(bytes/4/64));pass.end();encoder.copyBufferToBuffer(target.output,0,target.readback,0,bytes);this.device.queue.submit([encoder.finish()]);
  try{await target.readback.mapAsync(1);return new Float32Array(target.readback.getMappedRange().slice(0));}finally{target.readback.unmap();}
 }
 destroy(){for(const target of this.targets.values()){target.output.destroy();target.readback.destroy();}}
}
function equal(actual,expected,label){if(actual.length!==expected.length||actual.some((value,index)=>value!==expected[index]))throw new Error(label+' differs');}
const singleSpec=position=>({id:'history-single',visualOnly:true,position,mesh:{kind:'box',size:[1,2,1]},material:{kind:'glass',color:[.4,.7,.9,.6]}});

/** A correctness workload, not a timed benchmark. Exercises actual rigid-body
 * motion, published/direct visual poses, offscreen single reentry, replacement,
 * removal, reset, and a same-ID scene swap on fresh native devices in both modes. */
export async function diagnoseModelHistory({count=5000,width=1920,height=1080,temporalAA=true}={}){
 const adapter=await navigator.gpu.requestAdapter({powerPreference:'high-performance'}),info=adapter.info;
 const adapterInfo={vendor:info.vendor,architecture:info.architecture,description:info.description,isFallbackAdapter:adapter.isFallbackAdapter};requireHardware(adapterInfo);
 const canvas=document.querySelector('canvas'),camera={position:[7,8,14],target:[0,1,0],fov:60,near:.05,far:10000},runs=[],captures=[],physicsReference=[];
 for(const mode of ['gpu','cpu-batched']){
  const renderer=await WebGPURenderer.create(canvas,{visibility:mode,profiling:false,features:{temporalAA}});let reader;
  try{
   renderer.setResolution(width,height);reader=new BufferReader(renderer.device);
   let fixture=await createFixture(count),scene=fixture.scene;scene.add(singleSpec([-2,2,1]));await renderer.prepareMaterials(scene);
   const sourceHash=fixture.sourceHash,geometryHash=fixture.geometryHash,observed=new Map(),frames=[];let lastSingleUpload=null,modelChannels=0,uploadChannels=0,physicalMotionFrames=0,previousBodyY=null;
   for(let frame=0;frame<40;frame++){
    const events=[];
    if(frame===16){scene.remove('cube:2');scene.add({...scene.spec.entities.find(e=>e.id==='cube:2'),position:[2,1,3]});events.push('same-ID source replacement');}
    if(frame===20){scene.remove('cube:3');events.push('source removal');}
    if(frame===24){renderer.resetTemporalHistory();observed.clear();events.push('temporal reset');}
    if(frame===32){fixture=await createFixture(count);scene=fixture.scene;scene.add(singleSpec([-2,2,1]));observed.clear();lastSingleUpload=null;previousBodyY=null;await renderer.prepareMaterials(scene);events.push('same-ID scene swap');}
    scene.step(1/60);
    scene.setVisualTransform('cube:0',[Math.sin(frame*.14)*2,2,2],[0,frame*.08,0]);
    const direct=scene.entities.get('cube:1');direct.position[0]=3;direct.position[1]=1.2;direct.position[2]=Math.cos(frame*.17)*2;direct.rotation[1]=frame*.11;
    scene.setVisualTransform('history-single',frame>=8&&frame<=10?[1e6,2,1]:[-2+Math.sin(frame*.1),2,1]);
    if(frame===8)events.push('single hidden');if(frame===11)events.push('single reentry');
    const bodyY=scene.entities.get('replay:0').position[1];if(previousBodyY!==null&&bodyY!==previousBodyY)physicalMotionFrames++;previousBodyY=bodyY;
    // Pure Render IR is independent of the renderer's cached model table.
    const current=buildRenderFrame(scene,camera),beforeHash=await hash(scene.snapshot());
    renderer.setTimelineFrame(frame);renderer.render(scene,camera);await renderer.flush();
    const afterHash=await hash(scene.snapshot());if(beforeHash!==afterHash)throw new Error('Renderer mutated moving physical state');
    if(mode==='gpu')physicsReference.push(beforeHash);else if(beforeHash!==physicsReference[frame])throw new Error('Visibility mode changed physical replay at '+frame);
    const expectedPrevious=object=>{const old=observed.get(object.entity.id);return old?.source===object.entity&&old.frame===frame-1?old.model:object.model;};
    let checkedInstances=0;
    for(const batch of renderer.cameraBatchPlans){
     const stride=temporalAA?40:24;if(batch.stream.floats!==stride)throw new Error('Unexpected production instance stride');
     const values=await reader.read(batch.buffer,'instance',batch.items.length*stride*4);
     equal(values,batch.stream.data.subarray(0,values.length),'GPU instance upload at '+frame);uploadChannels+=values.length;
     for(let index=0;index<batch.items.length;index++){
      const entity=batch.items[index],object=current.objectsById.get(entity.id);if(!object)throw new Error('Missing pure Render IR object');
      equal(values.subarray(index*stride,index*stride+16),object.model,'Current instance '+entity.id+' at '+frame);modelChannels+=16;
      if(temporalAA){equal(values.subarray(index*stride+16,index*stride+32),expectedPrevious(object),'Previous instance '+entity.id+' at '+frame);modelChannels+=16;}checkedInstances++;
     }
    }
    const single=current.objectsById.get('history-single'),vp=multiply4(perspective(camera.fov*Math.PI/180,width/height,camera.near,camera.far),lookAt(camera.position,camera.target));
    const bodies=current.objects.filter(object=>object.entity.body?.invMass>0);if(bodies.length!==8)throw new Error('Missing physical movers');
    for(const object of bodies){
     if(!intersectsClip(meshBounds(primitiveMesh(object.primitive).vertices),multiply4(vp,object.model)))throw new Error('Physical mover outside diagnostic camera');
     const uniform=renderer.objects.get(object.entity.id);if(!uniform?.uniformReady)throw new Error('Physical mover uniform missing');
     const values=await reader.read(uniform.uniform,'uniform',32*4);
     equal(values.subarray(0,16),object.model,'Current physical mover '+object.entity.id+' at '+frame);
     equal(values.subarray(16,32),expectedPrevious(object),'Previous physical mover '+object.entity.id+' at '+frame);modelChannels+=32;
    }
    const visible=intersectsClip(meshBounds(primitiveMesh(single.primitive).vertices),multiply4(vp,single.model)),uniform=renderer.objects.get('history-single');
    if(!uniform)throw new Error('Single-object uniform never created');
    const values=await reader.read(uniform.uniform,'uniform',32*4);
    if(visible){
     equal(values.subarray(0,16),single.model,'Current single at '+frame);equal(values.subarray(16,32),expectedPrevious(single),'Previous single at '+frame);modelChannels+=32;lastSingleUpload=values;
    }else{if(!lastSingleUpload)throw new Error('Hidden single has no baseline');equal(values,lastSingleUpload,'Hidden single retained upload at '+frame);}
    for(const batch of renderer.cameraBatchPlans)for(const entity of batch.items){const object=current.objectsById.get(entity.id);observed.set(entity.id,{source:entity,model:object.model.slice(),frame});}
    for(const object of bodies)observed.set(object.entity.id,{source:object.entity,model:object.model.slice(),frame});
    if(visible)observed.set(single.entity.id,{source:single.entity,model:single.model.slice(),frame});
    const preparation=renderer.inspect(false).preparation,history=preparation.modelHistory;if(history.entries>current.objects.length)throw new Error('History retained dead sources');
    if(frame===11&&values.subarray(16,32).some((value,index)=>value!==single.model[index]))throw new Error('Reentry produced stale velocity');
    frames.push({frame,events,physicsHash:beforeHash,checkedInstances,checkedBodies:bodies.length,singleVisible:visible,modelHistory:history});
    if([7,9,11,31,39].includes(frame))captures.push({mode,frame,imageDataURL:canvas.toDataURL('image/png')});
   }
   const inspected=renderer.inspect(false);if(inspected.errors.length)throw new Error(inspected.errors.join('\n'));if(!physicalMotionFrames)throw new Error('No real rigid-body motion observed');
   runs.push({mode,sourceHash,geometryHash,frames,modelChannels,uploadChannels,physicalMotionFrames,errors:inspected.errors});
   console.info('TEMPORAL_DIAGNOSTIC '+JSON.stringify({mode,kind:'model-history',frames:frames.length,modelChannels,uploadChannels,physicalMotionFrames}));
  }finally{reader?.destroy();renderer.dispose();renderer.device.destroy();}
 }
 return{status:'completed',controls:{count,width,height,temporalAA,instanceFloats:temporalAA?40:24,frames:40,modes:['gpu','cpu-batched']},adapter:adapterInfo,runs,captures,gates:{productionMatrices:true,productionUploads:true,physicalMatrices:true,physicalReplay:true,offscreenReentry:true,replacementRemovalResetSceneSwap:true},
  interpretation:`Every actual GPU instance current matrix and all eight rigid-body current/previous uniforms are compared exactly against pure Render IR and independent last-observed snapshots. ${temporalAA?'Instance previous matrices are also checked.':'TAA is disabled; instance previous matrices are absent.'} All ${temporalAA?40:24}-float instance uploads are checked against the CPU mirror. The isolated transparent single has no shadow/reflection role; independent clip testing verifies hidden uploads remain unchanged and reentry uses its current pose. Scene stepping and visual edits occur before rendering; physical hashes must remain unchanged across render and match between visibility modes. Read-only diagnostic dispatches, readbacks and queue waits occur after production rendering. This establishes correctness of the exercised cases, not performance, canonical repeatability or competitive quality.`};
}
