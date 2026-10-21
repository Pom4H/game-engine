import {SPOT_SHADOW_WGSL,selectSpotShadows,SPOT_SHADOW_SIZE} from '../../src/render/spot-shadow.ts';
import {SHADOW_FILTER_WGSL} from '../../src/render/shadow-filter.ts';
const legacy=`fn oldSpotShadowVisibility(source:PointSource,world:vec3<f32>,normal:vec3<f32>)->f32{
 if(source.housing.x>0.0||source.housing.w<.5){return 1.0;}
 let slot=i32(source.housing.w)-1;let shadow=shadowSpots[slot];let clip=shadow.vp*vec4<f32>(world+normal*.008,1);
 if(clip.w<=0.0){return 1.0;}let ndc=clip.xyz/clip.w;let uv=ndc.xy*vec2<f32>(.5,-.5)+.5;
 if(any(uv<vec2<f32>(0))||any(uv>vec2<f32>(1))||ndc.z<0.0||ndc.z>1.0){return 1.0;}
 let texel=1.0/vec2<f32>(textureDimensions(spotShadowMap));var visibility=0.0;
 for(var i=0u;i<4u;i++){visibility+=textureSampleCompareLevel(spotShadowMap,shadowSampler,uv+SHADOW_TAPS[i]*texel,slot,ndc.z-.000002);}
 return mix(1.0,visibility*.25,shadow.params.x);
}`;
(async()=>{try{
 const adapter=await navigator.gpu.requestAdapter({powerPreference:'high-performance'});if(!adapter)throw Error('No adapter');
 const info=adapter.info,adapterInfo={vendor:info.vendor,architecture:info.architecture,device:info.device,description:info.description,isFallbackAdapter:(adapter as any).isFallbackAdapter??(info as any).isFallbackAdapter??false};
 if(adapterInfo.isFallbackAdapter||/swiftshader|software|llvmpipe/i.test(JSON.stringify(adapterInfo)))throw Error('Native hardware required '+JSON.stringify(adapterInfo));
 const device=await adapter.requestDevice(),errors:string[]=[];device.addEventListener('uncapturederror',e=>errors.push((e as GPUUncapturedErrorEvent).error.message));
 device.pushErrorScope('validation');
 const source:any={id:'headlamp',position:[0,.7,0],light:{kind:'point',intensity:12,range:24,castShadow:true,emission:{axis:[0,-.025,1],innerAngle:.2,outerAngle:.55}}};
 const [{matrix}]=selectSpotShadows([source],[0,2,-3]);
 const project=(p:number[])=>{const c=[0,1,2,3].map(r=>matrix[r]!*p[0]!+matrix[r+4]!*p[1]!+matrix[r+8]!*p[2]!+matrix[r+12]!);return[c[0]!/c[3]!*.5+.5,-c[1]!/c[3]!*.5+.5,c[2]!/c[3]!];};
 // Independent plane fit from three rasterized world points, rather than the
 // shader's analytic tangent/Jacobian calculation.
 const [a,b,c]=[[-1,0,3],[1,0,3],[0,0,12]].map(project),du=b![0]!-a![0]!,dv=b![1]!-a![1]!,dz=b![2]!-a![2]!,eu=c![0]!-a![0]!,ev=c![1]!-a![1]!,ez=c![2]!-a![2]!,det=du*ev-dv*eu;
 const gradient=[(ev*dz-dv*ez)/det,(du*ez-eu*dz)/det],constant=a![2]!-gradient[0]!*a![0]!-gradient[1]!*a![1]!;
 const points:number[]=[];
 for(let z=2;z<23;z+=.1)for(let x=-2;x<=2;x+=.25){const p=project([x,.008,z]);if(p[0]!<.02||p[0]!>.98||p[1]!<.02||p[1]!>.98||p[2]!<0||p[2]!>1)continue;points.push(x,0,z,0);}
 const depth=device.createTexture({size:[SPOT_SHADOW_SIZE,SPOT_SHADOW_SIZE,2],format:'depth32float',usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING});
 const depthModule=device.createShaderModule({code:`@group(0) @binding(0) var<uniform> plane:vec4f;
 @vertex fn vertex(@builtin(vertex_index)i:u32)->@builtin(position)vec4f{let p=array<vec2f,3>(vec2f(-1,-1),vec2f(3,-1),vec2f(-1,3));return vec4f(p[i],0,1);}
 @fragment fn fragment(@builtin(position)p:vec4f)->@builtin(frag_depth)f32{return clamp(dot(plane.xy,p.xy/${SPOT_SHADOW_SIZE}.0)+plane.z-plane.w,0,1);}`});
 const depthPipeline=await device.createRenderPipelineAsync({layout:'auto',vertex:{module:depthModule,entryPoint:'vertex'},fragment:{module:depthModule,entryPoint:'fragment',targets:[]},depthStencil:{format:'depth32float',depthWriteEnabled:true,depthCompare:'always'}});
 const encoder=device.createCommandEncoder();
 for(let slot=0;slot<2;slot++){const uniform=device.createBuffer({size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});device.queue.writeBuffer(uniform,0,new Float32Array([...gradient,constant,slot*.01]));const pass=encoder.beginRenderPass({colorAttachments:[],depthStencilAttachment:{view:depth.createView({dimension:'2d',baseArrayLayer:slot,arrayLayerCount:1}),depthClearValue:1,depthLoadOp:'clear',depthStoreOp:'store'}});pass.setPipeline(depthPipeline);pass.setBindGroup(0,device.createBindGroup({layout:depthPipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:uniform}}]}));pass.draw(3);pass.end();}
 const module=device.createShaderModule({code:`struct PointSource{position:vec4f,color:vec4f,axis:vec4f,shape:vec4f,housing:vec4f}
 @group(1) @binding(2) var shadowSampler:sampler_comparison;
 @group(1) @binding(4) var reflectionSampler:sampler;
 ${SHADOW_FILTER_WGSL}\n${SPOT_SHADOW_WGSL}\n${legacy}
 @group(0) @binding(0) var<storage,read> points:array<vec4f>;
 @group(0) @binding(1) var<storage,read_write> results:array<vec4f>;
 @compute @workgroup_size(64) fn main(@builtin(global_invocation_id)i:vec3u){if(i.x>=arrayLength(&points)){return;}
 var source:PointSource;source.housing=vec4f(0,0,0,1);let p=points[i.x].xyz;let n=vec3f(0,1,0);
 let old=oldSpotShadowVisibility(source,p,n);let next=spotShadowVisibility(source,p,n);source.housing.w=2;
 results[i.x]=vec4f(old,next,oldSpotShadowVisibility(source,p,n),spotShadowVisibility(source,p,n));}`});
 const compilation=await module.getCompilationInfo();if(compilation.messages.some(m=>m.type==='error'))throw Error(JSON.stringify(compilation.messages));
 const pipeline=await device.createComputePipelineAsync({layout:'auto',compute:{module,entryPoint:'main'}}),input=device.createBuffer({size:points.length*4,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST}),output=device.createBuffer({size:points.length*4,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC}),readback=device.createBuffer({size:points.length*4,usage:GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST}),shadows=device.createBuffer({size:160,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
 device.queue.writeBuffer(input,0,new Float32Array(points));const uniforms=new Float32Array(40);for(let i=0;i<2;i++){uniforms.set(matrix,i*20);uniforms.set([1,0,0,0],i*20+16);}device.queue.writeBuffer(shadows,0,uniforms);
 const pass=encoder.beginComputePass();pass.setPipeline(pipeline);pass.setBindGroup(0,device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:input}},{binding:1,resource:{buffer:output}}]}));pass.setBindGroup(1,device.createBindGroup({layout:pipeline.getBindGroupLayout(1),entries:[{binding:2,resource:device.createSampler({compare:'less-equal',minFilter:'linear',magFilter:'linear'})},{binding:13,resource:depth.createView({dimension:'2d-array'})},{binding:14,resource:{buffer:shadows}}]}));pass.dispatchWorkgroups(Math.ceil(points.length/4/64));pass.end();encoder.copyBufferToBuffer(output,0,readback,0,points.length*4);device.queue.submit([encoder.finish()]);await readback.mapAsync(GPUMapMode.READ);const values=new Float32Array(readback.getMappedRange()),mins=[1,1,1,1],maxes=[0,0,0,0];let oldFalseShadow=0,newFalseShadow=0,newOccluderLeaks=0;
 for(let i=0;i<values.length;i++){const lane=i%4;mins[lane]=Math.min(mins[lane]!,values[i]!);maxes[lane]=Math.max(maxes[lane]!,values[i]!);if(lane===0&&values[i]!<.999)oldFalseShadow++;if(lane===1&&values[i]!<.999)newFalseShadow++;if(lane===3&&values[i]!>.001)newOccluderLeaks++;}
 const bad=[];for(let i=0;i<values.length;i+=4)if(values[i+1]!<.999&&bad.length<8)bad.push({p:points.slice(i,i+3),visibility:[...values.slice(i,i+4)]});
 const validation=await device.popErrorScope();if(validation)errors.push(validation.message);
 (window as any).result={status:errors.length===0&&oldFalseShadow>0&&newFalseShadow===0&&newOccluderLeaks===0?'pass':'fail',adapter:adapterInfo,samples:points.length/4,gradient,bad,oldFalseShadow,newFalseShadow,newOccluderLeaks,mins,maxes,errors,compileMessages:compilation.messages};
 (window as any).ready=true;
}catch(error){(window as any).qaError=String(error);console.error(error);}})();
