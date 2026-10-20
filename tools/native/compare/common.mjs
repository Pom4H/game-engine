export function assertComparisonAPI(Scene,Renderer){
 if(typeof Scene.prototype.setVisualTransform!=='function'||['setBackgroundEnvironmentMaps','resetProfile','profileLatest','resetTemporalHistory','setTimelineFrame','flush'].some(key=>typeof Renderer.prototype[key]!=='function'))throw new Error('Comparison requires a current Engine build matching TheGame (visual movers, background environment maps and profiling). Set ENGINE_ROOT to that checkout and build its dist first; the older native PR renderer is not interchangeable.');
}
export function restoreScene(packet,Scene){
 const entities=packet.entities.map(e=>({...e,mesh:e.mesh===null?undefined:packet.primitives[e.mesh],renderMesh:e.renderMesh===null?undefined:packet.primitives[e.renderMesh]}));
 const scene=new Scene({...packet.spec,entities,camera:packet.camera});
 scene.environment=packet.environment;scene.time=packet.time;scene.tick=packet.tick;
 for(const [id,surface]of Object.entries(packet.surfaces)){const e=scene.entities.get(id);if(e)e.material=Object.freeze({...e.material,surface:Object.freeze(surface)});}
 for(const id of packet.movers){const e=scene.entities.get(id);scene.setVisualTransform(id,e.position,e.rotation,e.scale);}
 return scene;
}
const mipShader=`@group(0) @binding(0) var image:texture_2d<f32>;
@group(0) @binding(1) var mipSampler:sampler;
struct O {@builtin(position) p:vec4<f32>,@location(0) uv:vec2<f32>}
@vertex fn vs(@builtin(vertex_index) i:u32)->O{let p=vec2<f32>(f32((i<<1u)&2u),f32(i&2u));var o:O;o.p=vec4<f32>(p*2.0-1.0,0,1);o.uv=vec2<f32>(p.x,1.0-p.y);return o;}
@fragment fn fs(i:O)->@location(0) vec4<f32>{return textureSampleLevel(image,mipSampler,i.uv,0);}`;
const decode=s=>{if(typeof Buffer!=='undefined')return Buffer.from(s,'base64');const b=atob(s),out=new Uint8Array(b.length);for(let i=0;i<b.length;i++)out[i]=b.charCodeAt(i);return out;};

/** Recorded pixel assets use the renderer's original GPU mip pass. Both hosts
 * receive identical bytes; no image/label is removed from the game snapshot. */
export async function installAssets(renderer,assets){
 const device=renderer.device,shader=device.createShaderModule({code:mipShader});
 const pipeline=device.createRenderPipeline({layout:'auto',vertex:{module:shader,entryPoint:'vs'},fragment:{module:shader,entryPoint:'fs',targets:[{format:'rgba8unorm'}]},primitive:{topology:'triangle-list'}});
 const sampler=device.createSampler({minFilter:'linear',magFilter:'linear'}),encoder=device.createCommandEncoder();
 for(const a of assets){
  const mipLevelCount=a.kind==='label'?1:1+Math.floor(Math.log2(Math.max(a.width,a.height)));
  const texture=device.createTexture({label:'recorded game '+a.kind,size:[a.width,a.height],mipLevelCount,format:'rgba8unorm',usage:4|2|16});
  const bytes=decode(a.rgba);if(bytes.length!==a.width*a.height*4)throw new Error('Recorded texture byte count mismatch');
  device.queue.writeTexture({texture},bytes,{bytesPerRow:a.width*4,rowsPerImage:a.height},[a.width,a.height]);
  for(let level=1;level<mipLevelCount;level++){
   const bind=device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:texture.createView({baseMipLevel:level-1,mipLevelCount:1})},{binding:1,resource:sampler}]});
   const pass=encoder.beginRenderPass({colorAttachments:[{view:texture.createView({baseMipLevel:level,mipLevelCount:1}),loadOp:'clear',clearValue:{r:0,g:0,b:0,a:1},storeOp:'store'}]});pass.setPipeline(pipeline);pass.setBindGroup(0,bind);pass.draw(3);pass.end();
  }
  if(a.kind==='label')renderer.labels.set(a.key,texture);else renderer.surfaceTextures.textures.set(a.key,texture);
 }
 device.queue.submit([encoder.finish()]);await renderer.flush();
}
export const rendererOptions={profiling:true,visibility:'gpu',logarithmicDepthFar:2000,features:{temporalAA:true,bloom:true,motionBlur:true}};
export const postOptions={temporalAA:true,bloom:false,motionBlur:0};
export function cameraAt(base,frame,moving,period=180){
 if(!moving)return structuredClone(base);
 const t=frame/period*Math.PI*2,delta=[Math.sin(t)*2,Math.sin(t)*.15,(Math.cos(t)-1)*1];
 return {...base,position:base.position.map((v,i)=>v+delta[i]),target:base.target.map((v,i)=>v+delta[i])};
}
const percentile=(sorted,p)=>sorted[Math.max(0,Math.min(sorted.length-1,Math.ceil(sorted.length*p)-1))];
export function summarize(samples){
 if(!samples.length||samples.some(s=>!Number.isFinite(s.intervalMs)||s.intervalMs<=0))throw new RangeError('Frame intervals must be positive finite numbers');
 const stats=key=>{const v=samples.map(s=>s[key]).filter(Number.isFinite).sort((a,b)=>a-b);return v.length?{samples:v.length,mean:v.reduce((a,b)=>a+b,0)/v.length,p50:percentile(v,.5),p95:percentile(v,.95),p99:percentile(v,.99),max:v.at(-1)}:null;};
 const interval=stats('intervalMs'),sorted=samples.map(s=>s.intervalMs).sort((a,b)=>b-a),slow=sorted.slice(0,Math.max(1,Math.ceil(sorted.length*.01)));
 return {interval,averageFPS:1000/interval.mean,onePercentLowFPS:1000/(slow.reduce((a,b)=>a+b,0)/slow.length),framesOver33ms:samples.filter(s=>s.intervalMs>1000/30).length,
  framesOver50ms:samples.filter(s=>s.intervalMs>50).length,cpuSubmit:stats('cpuSubmitMs'),completedFrame:stats('completedFrameMs'),gpuWait:stats('gpuWaitMs'),gpu:stats('gpuMs')};
}
export async function measure({scene,renderer,baseCamera,frames=180,warmup=60,moving=false,beforeFrame=async()=>{},present=()=>{},afterFrame=async()=>{}}){
 if(!Number.isInteger(frames)||frames<1||!Number.isInteger(warmup)||warmup<1)throw new RangeError('Measurement needs positive integer frames and warmup');
 renderer.resetTemporalHistory();renderer.resetProfile();const samples=[],gpuSeen=new Set();let previous;
 for(let i=0;i<frames+warmup;i++){
  await beforeFrame();const start=performance.now();scene.camera=cameraAt(baseCamera,i,moving,frames);scene.time=moving?i/60:0;
  renderer.setTimelineFrame(i);renderer.render(scene);const submitted=performance.now();
  await renderer.flush();const completed=performance.now();present();const presented=performance.now();
  if(i>=warmup){const p=renderer.profileLatest?.(),gpu=p?.gpu;
   samples.push({frame:i-warmup,intervalMs:start-previous,cpuSubmitMs:submitted-start,gpuWaitMs:completed-submitted,completedFrameMs:presented-start,
    gpuMs:gpu&&gpu.frame>=warmup&&!gpuSeen.has(gpu.frame)?gpu.totalMs:null,gpuFrame:gpu?.frame??null});if(gpu)gpuSeen.add(gpu.frame);
  }
  previous=start;await afterFrame(start);
 }
 const stats=renderer.inspect();if(stats.errors.length)throw new Error(stats.errors.join('\n'));
 return {moving,frames,warmup,summary:summarize(samples),samples,renderer:stats};
}
export async function settleCanonical({scene,renderer,baseCamera,present=()=>{},beforeFrame=async()=>{}}){
 renderer.resetTemporalHistory();scene.camera=structuredClone(baseCamera);scene.time=0;
 for(let i=0;i<64;i++){await beforeFrame();renderer.setTimelineFrame(i);renderer.render(scene);await renderer.flush();present();}
}
export async function readPresentation(device,texture,width,height,format='bgra8unorm'){
 const bytesPerRow=Math.ceil(width*4/256)*256,buffer=device.createBuffer({size:bytesPerRow*height,usage:1|8}),encoder=device.createCommandEncoder();
 try{encoder.copyTextureToBuffer({texture},{buffer,bytesPerRow,rowsPerImage:height},[width,height]);device.queue.submit([encoder.finish()]);await buffer.mapAsync(1);
  const source=new Uint8Array(buffer.getMappedRange()),rgba=new Uint8Array(width*height*4);
  for(let y=0;y<height;y++)rgba.set(source.subarray(y*bytesPerRow,y*bytesPerRow+width*4),y*width*4);
  if(format.startsWith('bgra'))for(let i=0;i<rgba.length;i+=4)[rgba[i],rgba[i+2]]=[rgba[i+2],rgba[i]];buffer.unmap();return rgba;
 }finally{buffer.destroy();}
}
