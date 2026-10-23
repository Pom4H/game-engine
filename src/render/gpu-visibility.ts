import type {MeshBounds} from './visibility.js';

type GPUAny=any;
export type VisibilityMode='cpu'|'cpu-batched'|'gpu';
/** model, previous model, color and weather (including the per-object seed). */
export const INSTANCE_FLOATS=40;
export const INSTANCE_BYTES=INSTANCE_FLOATS*4;
/** Without velocity/TAA, retain only the current model and instance attributes. */
export const CURRENT_INSTANCE_FLOATS=24;

/** Persistent CPU mirror. Adjacent dirty records share a queue upload. */
export class InstanceStream {
 readonly data:Float32Array;
 private readonly scratch:Float32Array;
 private dirty:number[]=[];
 private initialized=false;
 private uploadedCount=0;
 constructor(readonly capacity:number,readonly floats=INSTANCE_FLOATS){
  if(!Number.isSafeInteger(capacity)||capacity<1)throw new RangeError('Invalid instance capacity');
  if(floats!==INSTANCE_FLOATS&&floats!==CURRENT_INSTANCE_FLOATS)throw new RangeError('Invalid instance stride');
  this.data=new Float32Array(capacity*floats);this.scratch=new Float32Array(floats);
 }
 set(index:number,model:ArrayLike<number>,previous:ArrayLike<number>,color:ArrayLike<number>,weather:ArrayLike<number>):void{
  if(!Number.isSafeInteger(index)||index<0||index>=this.capacity)throw new RangeError('Invalid instance index');
  const next=this.scratch,attributes=this.floats-8;next.set(model,0);if(this.floats===INSTANCE_FLOATS)next.set(previous,16);next.set(color,attributes);next.set(weather,attributes+4);
  const start=index*this.floats;let changed=false;
  for(let n=0;n<this.floats;n++)if(this.data[start+n]!==next[n]){changed=true;break;}
  if(changed){this.data.set(next,start);this.dirty.push(index);}
 }
 upload(queue:GPUAny,buffer:GPUAny,count:number):number{
  if(!Number.isSafeInteger(count)||count<0||count>this.capacity)throw new RangeError('Invalid instance count');
  if(this.initialized&&!this.dirty.length&&count<=this.uploadedCount)return 0;
  let bytes=0;const deferred=this.dirty.filter(index=>index>=count);
  const write=(first:number,end:number)=>{if(end<=first)return;const start=first*this.floats,length=(end-first)*this.floats;queue.writeBuffer(buffer,start*4,this.data,start,length);bytes+=length*4;};
  if(!this.initialized){write(0,count);this.initialized=true;}
  else{
   for(let index=this.uploadedCount;index<count;index++)this.dirty.push(index);
   this.dirty.sort((a,b)=>a-b);let first=-1,end=0;
   for(const index of this.dirty){if(index>=count)continue;if(first<0){first=index;end=index+1;}else if(index<=end+4)end=Math.max(end,index+1);else{write(first,end);first=index;end=index+1;}}
   if(first>=0)write(first,end);
  }
  this.uploadedCount=Math.max(this.uploadedCount,count);this.dirty=deferred;return bytes;
 }
}

export interface VisibilityBatch {
 readonly source:GPUAny;readonly capacity:number;readonly visibleIndices:GPUAny;readonly indirect:GPUAny;
 readonly uniforms:GPUAny;readonly bindGroup:GPUAny;readonly cpuIndices:Uint32Array;
 cpuVisibleCount:number;
 destroy():void;
}
export interface VisibilityRequest {
 readonly batch:VisibilityBatch;readonly count:number;readonly indexCount:number;
 readonly bounds:MeshBounds;readonly viewProjection:ArrayLike<number>;readonly instances:Float32Array;
}
export interface VisibilitySnapshot {
 readonly frame:number|null;readonly sourceInstances:number|null;readonly visibleInstances:number|null;readonly triangles:number|null;
 readonly samples:number;readonly pending:number;readonly droppedSamples:number;readonly readbackErrors:number;
}

/** Exact local-box reference, including negative/nonuniform scale and WebGPU z=0 near plane. */
export function instanceIntersectsClip(bounds:MeshBounds,vp:ArrayLike<number>,instances:ArrayLike<number>,base=0,scratch=new Float32Array(16)):boolean{
 for(let column=0;column<4;column++)for(let row=0;row<4;row++)scratch[column*4+row]=vp[row]!*instances[base+column*4]!+vp[row+4]!*instances[base+column*4+1]!+vp[row+8]!*instances[base+column*4+2]!+vp[row+12]!*instances[base+column*4+3]!;
 for(let plane=0;plane<6;plane++){
  const row=plane>>1,sign=(plane&1)?-1:1,near=plane===4;
  const a=near?scratch[2]!:scratch[3]!+sign*scratch[row]!,b=near?scratch[6]!:scratch[7]!+sign*scratch[4+row]!,c=near?scratch[10]!:scratch[11]!+sign*scratch[8+row]!,d=near?scratch[14]!:scratch[15]!+sign*scratch[12+row]!;
  if(a*bounds.center[0]+b*bounds.center[1]+c*bounds.center[2]+d+Math.abs(a)*bounds.half[0]+Math.abs(b)*bounds.half[1]+Math.abs(c)*bounds.half[2]<-1e-5)return false;
 }
 return true;
}

/** Adapted from thegame GPU visibility: 40-float source, indexed draw, local AABB.
 * Visibility stays in device memory. Each view owns its own output and args. */
export const VISIBILITY_SHADER=`
struct Parameters {vp:mat4x4<f32>,center:vec4<f32>,half:vec4<f32>,counts:vec4<u32>}
struct IndexedDraw {indexCount:u32,instanceCount:atomic<u32>,firstIndex:u32,baseVertex:i32,firstInstance:u32}
@group(0) @binding(0) var<storage,read> instances:array<f32>;
@group(0) @binding(1) var<storage,read_write> visible:array<u32>;
@group(0) @binding(2) var<storage,read_write> draw:IndexedDraw;
@group(0) @binding(3) var<uniform> params:Parameters;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) invocation:vec3<u32>){
 let index=invocation.x;if(index>=params.counts.x){return;}
 let base=index*params.counts.y;
 let model=mat4x4<f32>(vec4<f32>(instances[base],instances[base+1u],instances[base+2u],instances[base+3u]),vec4<f32>(instances[base+4u],instances[base+5u],instances[base+6u],instances[base+7u]),vec4<f32>(instances[base+8u],instances[base+9u],instances[base+10u],instances[base+11u]),vec4<f32>(instances[base+12u],instances[base+13u],instances[base+14u],instances[base+15u]));
 let clip=params.vp*model;
 for(var p=0u;p<6u;p++){
  let row=p/2u;let sign=select(1.0,-1.0,(p&1u)!=0u);
  var plane=vec4<f32>(clip[0][3]+sign*clip[0][row],clip[1][3]+sign*clip[1][row],clip[2][3]+sign*clip[2][row],clip[3][3]+sign*clip[3][row]);
  if(p==4u){plane=vec4<f32>(clip[0][2],clip[1][2],clip[2][2],clip[3][2]);}
  if(dot(plane.xyz,params.center.xyz)+plane.w+dot(abs(plane.xyz),params.half.xyz)<-0.00001){return;}
 }
 visible[atomicAdd(&draw.instanceCount,1u)]=index;
}`;

interface StatsSlot {buffer:GPUAny;pending:boolean;frame:number;generation:number;count:number;sources:number;promise?:Promise<void>}
export class GpuVisibility {
 readonly shader:GPUAny;
 private readonly layout:GPUAny;private readonly pipeline:GPUAny;
 private readonly parameters=new Float32Array(28);private readonly parameterWords=new Uint32Array(this.parameters.buffer);
 private readonly args=new Uint32Array(5);private readonly clipScratch=new Float32Array(16);
 private readonly slots:StatsSlot[]=[];private active:StatsSlot|undefined;private disposed=false;private generation=0;
 private snapshotState:VisibilitySnapshot={frame:null,sourceInstances:null,visibleInstances:null,triangles:null,samples:0,pending:0,droppedSamples:0,readbackErrors:0};
 bufferUploadBytes=0;
 constructor(private readonly device:GPUAny,readonly instanceFloats=INSTANCE_FLOATS){
  if(instanceFloats!==INSTANCE_FLOATS&&instanceFloats!==CURRENT_INSTANCE_FLOATS)throw new RangeError('Invalid instance stride');
  this.layout=device.createBindGroupLayout({entries:[{binding:0,visibility:4,buffer:{type:'read-only-storage'}},{binding:1,visibility:4,buffer:{type:'storage'}},{binding:2,visibility:4,buffer:{type:'storage'}},{binding:3,visibility:4,buffer:{type:'uniform'}}]});
  this.shader=device.createShaderModule({label:'visibility WGSL',code:VISIBILITY_SHADER});
  this.pipeline=device.createComputePipeline({label:'render.visibility',layout:device.createPipelineLayout({bindGroupLayouts:[this.layout]}),compute:{module:this.shader,entryPoint:'main'}});
 }
 createBatch(source:GPUAny,capacity:number,label='camera'):VisibilityBatch{
  if(!Number.isSafeInteger(capacity)||capacity<1||capacity*this.instanceFloats*4>source.size)throw new RangeError('Visibility capacity exceeds source buffer');
  const visibleIndices=this.device.createBuffer({label:label+' visible indices',size:capacity*4,usage:0x80|0x08});
  const indirect=this.device.createBuffer({label:label+' indexed indirect',size:20,usage:0x80|0x100|0x08|0x04});
  const uniforms=this.device.createBuffer({label:label+' visibility parameters',size:112,usage:0x40|0x08});
  const bindGroup=this.device.createBindGroup({layout:this.layout,entries:[{binding:0,resource:{buffer:source}},{binding:1,resource:{buffer:visibleIndices}},{binding:2,resource:{buffer:indirect}},{binding:3,resource:{buffer:uniforms}}]});
  let destroyed=false;return{source,capacity,visibleIndices,indirect,uniforms,bindGroup,cpuIndices:new Uint32Array(capacity),cpuVisibleCount:0,destroy(){if(destroyed)return;destroyed=true;visibleIndices.destroy();indirect.destroy();uniforms.destroy();}};
 }
 encode(encoder:GPUAny,requests:readonly VisibilityRequest[],mode:'gpu'|'cpu-batched',timestampWrites?:Record<string,unknown>):number{
  this.bufferUploadBytes=0;let cpuVisible=0;const seen=new Set<VisibilityBatch>();
  for(const {batch,count,indexCount,bounds,viewProjection,instances} of requests){
   if(seen.has(batch))throw new Error('Each view needs distinct visibility outputs');seen.add(batch);
   if(!Number.isSafeInteger(count)||count<0||count>batch.capacity||Math.ceil(count/64)>(this.device.limits?.maxComputeWorkgroupsPerDimension??65535))throw new RangeError('Invalid visibility count');
   if(!Number.isSafeInteger(indexCount)||indexCount<0||indexCount>0xffffffff||viewProjection.length!==16||instances.length<count*this.instanceFloats)throw new RangeError('Invalid visibility request');
   this.args.set([indexCount,0,0,0,0]);
   if(mode==='gpu'){
    this.parameters.fill(0);this.parameters.set(viewProjection,0);this.parameters.set(bounds.center,16);this.parameters.set(bounds.half,20);this.parameterWords[24]=count;this.parameterWords[25]=this.instanceFloats;
    this.device.queue.writeBuffer(batch.uniforms,0,this.parameters);this.bufferUploadBytes+=112;
   }else{
    let visible=0;for(let n=0;n<count;n++)if(instanceIntersectsClip(bounds,viewProjection,instances,n*this.instanceFloats,this.clipScratch))batch.cpuIndices[visible++]=n;
    this.args[1]=visible;batch.cpuVisibleCount=visible;cpuVisible+=visible;
    if(visible){this.device.queue.writeBuffer(batch.visibleIndices,0,batch.cpuIndices,0,visible);this.bufferUploadBytes+=visible*4;}
   }
   // Always reset, including batches that became empty or entirely hidden.
   this.device.queue.writeBuffer(batch.indirect,0,this.args);this.bufferUploadBytes+=20;
  }
  if(mode==='gpu'&&requests.some(request=>request.count>0)){
   const pass=encoder.beginComputePass({label:'render.visibility',...(timestampWrites?{timestampWrites}:{})});pass.setPipeline(this.pipeline);
   for(const {batch,count} of requests)if(count){pass.setBindGroup(0,batch.bindGroup);pass.dispatchWorkgroups(Math.ceil(count/64));}pass.end();
  }
  return cpuVisible;
 }
 /** Optional diagnostic copies; never feeds the current draw or stalls render(). */
 captureStats(encoder:GPUAny,requests:readonly VisibilityRequest[],frame:number):void{
  if(requests.length>2048){this.snapshotState={...this.snapshotState,droppedSamples:this.snapshotState.droppedSamples+1};return;}
  if(this.active)throw new Error('Visibility diagnostics already encoded for this submission');
  if(!this.slots.length)for(let n=0;n<3;n++)this.slots.push({buffer:this.device.createBuffer({label:'visibility diagnostics '+n,size:2048*20,usage:0x01|0x08}),pending:false,frame:0,generation:0,count:0,sources:0});
  const slot=this.slots.find(candidate=>!candidate.pending);if(!slot){this.snapshotState={...this.snapshotState,droppedSamples:this.snapshotState.droppedSamples+1};return;}
  slot.pending=true;slot.frame=frame;slot.generation=this.generation;slot.count=requests.length;slot.sources=requests.reduce((n,request)=>n+request.count,0);this.active=slot;
  requests.forEach((request,n)=>encoder.copyBufferToBuffer(request.batch.indirect,0,slot.buffer,n*20,20));
 }
 afterSubmit():void{
  const slot=this.active;if(!slot)return;this.active=undefined;
  slot.promise=slot.buffer.mapAsync(1,0,Math.max(8,slot.count*20)).then(()=>{
   if(this.disposed||slot.generation!==this.generation)return;const args=new Uint32Array(slot.buffer.getMappedRange(0,Math.max(8,slot.count*20)));let visible=0,triangles=0;
   for(let n=0;n<slot.count;n++){visible+=args[n*5+1]!;triangles+=args[n*5]!*args[n*5+1]!/3;}
   const current=this.snapshotState;this.snapshotState={...current,samples:current.samples+1,...(current.frame===null||slot.frame>current.frame?{frame:slot.frame,sourceInstances:slot.sources,visibleInstances:visible,triangles}:{})};
  }).catch(()=>{if(!this.disposed&&slot.generation===this.generation)this.snapshotState={...this.snapshotState,readbackErrors:this.snapshotState.readbackErrors+1};}).finally(()=>{if(!this.disposed)slot.buffer.unmap();slot.pending=false;});
 }
 snapshot():VisibilitySnapshot{return{...this.snapshotState,pending:this.slots.filter(slot=>slot.pending).length};}
 resetStats():void{this.generation++;this.snapshotState={frame:null,sourceInstances:null,visibleInstances:null,triangles:null,samples:0,pending:0,droppedSamples:0,readbackErrors:0};}
 async flush():Promise<void>{await Promise.all(this.slots.map(slot=>slot.promise));}
 destroy():void{if(this.disposed)return;this.disposed=true;for(const slot of this.slots)slot.buffer.destroy();}
}
