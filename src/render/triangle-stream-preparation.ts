import {triangleMeshPacking} from '../procedural/copied-triangle.js';
import {createTriangleStreamState,type AggregateTriangleStream,type TriangleStreamState,type TriangleStreamUpdate,type TriangleStreamUpdatePreparation} from '../procedural/triangle-stream.js';
import {StagedMeshLease,type PreparedMeshResources} from './mesh-preparation.js';

export interface TriangleStreamOptions {capacityTriangles:number;color:readonly[number,number,number,number]}
export interface TriangleStreamPreparation {
 readonly ready:boolean;
 /** One cold allocation or one <=64 KiB packing/upload block. */
 step(maxBytes?:number):boolean;
 /** Transfer the complete resource to its explicit live owner. */
 commit():AggregateTriangleStream;
 dispose():void;
}
interface Owner {
 alive():boolean;publish(primitive:TriangleStreamState['primitive'],mesh:PreparedMeshResources):void;
 unpublish(primitive:TriangleStreamState['primitive'],mesh:PreparedMeshResources):void;
 pin(mesh:PreparedMeshResources,delta:1|-1):void;
 retire(preparation:TriangleStreamPreparation):void;
 adopted(stream:AggregateTriangleStream):void;released(stream:AggregateTriangleStream):void;
}
class UpdateTicket implements TriangleStreamUpdate{
 #owner:PreparedTriangleStream|undefined;
 readonly #revision:number;
 constructor(owner:PreparedTriangleStream,revision:number){this.#owner=owner;this.#revision=revision;}
 commit():void{const owner=this.#owner;if(!owner)throw new Error('Triangle stream update ticket is settled');owner.commitUpdate(this.#revision);this.#owner=undefined;}
 dispose():void{const owner=this.#owner;this.#owner=undefined;owner?.cancelUpdate(this.#revision);}
}
type UpdateJob={revision:number;source:Float32Array|undefined;vertexCount:number;copied:number;uploaded:number;pending:number;failure:unknown};
class IncrementalUpdateTicket implements TriangleStreamUpdatePreparation{
 #owner:PreparedTriangleStream|undefined;readonly #revision:number;
 constructor(owner:PreparedTriangleStream,revision:number){this.#owner=owner;this.#revision=revision;}
 get ready(){return this.#owner?.updateReady(this.#revision)??false;}
 step(maxBytes=65536):boolean{const owner=this.#owner;if(!owner)throw new Error('Triangle stream update ticket is settled');return owner.stepUpdate(this.#revision,maxBytes);}
 commit():void{const owner=this.#owner;if(!owner)throw new Error('Triangle stream update ticket is settled');owner.commitUpdate(this.#revision);this.#owner=undefined;}
 dispose():void{const owner=this.#owner;this.#owner=undefined;owner?.cancelUpdate(this.#revision);}
}
/** Fixed-capacity packed stream. Static attributes/index upload once; vertex
 * banks alternate so a failed update cannot corrupt the current publication.
 * Driver time is not bounded by a JS byte count. No completion wait occurs. */
export class PreparedTriangleStream implements TriangleStreamPreparation {
 #state:TriangleStreamState;
 readonly #inner:StagedMeshLease;
 #mesh:PreparedMeshResources|undefined;#back:any;#originalBack:any;
 #stage=0;#pending=0;#failure:unknown;#disposed=false;#committed=false;#stepping=false;#updating=false;
 #controller:AggregateTriangleStream|undefined;
 readonly #lower=[0,0,0];readonly #upper=[0,0,0];
 #updateSerial=0;#pendingUpdate=0;#pendingVertices=0;
 #updateJob:UpdateJob|undefined;
 #device:any;#owner:Owner;
 constructor(device:any,options:TriangleStreamOptions,owner:Owner){
  this.#device=device;this.#owner=owner;
  const state=this.#state=createTriangleStreamState(options.capacityTriangles,options.color),count=state.capacity*3;
  const packing=triangleMeshPacking((channel,index)=>channel==='indices'?index:channel==='colors'?state.color[index%4]!/255:channel==='uvs'?(index%6===2||index%6===5?1:0):0,count,count,true,true);
  this.#inner=new StagedMeshLease(device,state.key,packing,{lookup:()=>undefined,alive:()=>!this.#disposed&&owner.alive(),publish:mesh=>{mesh.count=0;mesh.triangles=0;mesh.bounds=state.bounds;this.#mesh=mesh;owner.publish(state.primitive,mesh);},unpublish:mesh=>owner.unpublish(state.primitive,mesh),pin:(mesh,delta)=>owner.pin(mesh,delta),retire:()=>{}});
 }
 get ready(){return !this.#disposed&&this.#stage===4&&this.#inner.ready&&this.#pending===0&&this.#failure===undefined;}
 step(maxBytes=65536):boolean{
  if(!Number.isSafeInteger(maxBytes)||maxBytes<4)throw new RangeError('Triangle stream preparation requires at least four bytes');
  if(this.#disposed||!this.#owner.alive())throw new Error('Triangle stream preparation was disposed');
  if(this.#stepping)throw new Error('Triangle stream preparation cannot reenter');
  if(this.#failure!==undefined){const error=this.#failure;this.dispose();throw new Error('Triangle stream GPU preparation failed',{cause:error});}
  if(this.ready)return true;this.#stepping=true;
  try{
   if(this.#stage===0){this.#state.active=new Float32Array(this.#state.capacity*18);this.#stage++;return false;}
   if(this.#stage===1){this.#state.staging=new Float32Array(this.#state.capacity*18);this.#stage++;return false;}
   if(this.#stage===2){if(this.#inner.step(maxBytes))this.#stage++;return false;}
   if(this.#stage===3){
    const device=this.#device;let scopes=0;
    try{
     if(device.pushErrorScope&&device.popErrorScope){device.pushErrorScope('validation');scopes++;device.pushErrorScope('out-of-memory');scopes++;}
     const buffer=device.createBuffer({label:'triangle stream alternate vertex',size:this.#state.capacity*18*4,usage:0x20|0x08});
     if(this.#disposed||!this.#owner.alive()){buffer.destroy();throw new Error('Triangle stream cancelled during allocation');}
     this.#back=this.#originalBack=buffer;this.#stage++;
    }finally{for(let i=0;i<scopes;i++){this.#pending++;let check:Promise<any>;try{check=Promise.resolve(device.popErrorScope());}catch(error){check=Promise.reject(error);}void check.then(error=>{if(error&&!this.#disposed)this.#failure??=error;},error=>{if(!this.#disposed)this.#failure??=error;}).finally(()=>this.#pending--);}}
   }
   return this.ready;
  }catch(error){try{this.dispose();}catch(cleanup){throw new AggregateError([error,cleanup],'Triangle stream preparation cleanup failed');}throw error;}finally{this.#stepping=false;}
 }
 commit():AggregateTriangleStream{
  if(this.#disposed||this.#state.disposed)throw new Error('Triangle stream preparation was disposed');
  if(this.#committed)return this.#controller!;
  if(!this.ready||this.#stepping||!this.#owner.alive())throw new Error('Triangle stream preparation is incomplete');
  try{this.#inner.commit();}catch(error){try{this.dispose();}catch(cleanup){throw new AggregateError([error,cleanup],'Triangle stream cache admission cleanup failed');}throw error;}
  const state=this.#state,mesh=this.#mesh!;state.ready=true;
  const originalDestroy=mesh.destroy;let destroyed=false;
  mesh.destroy=()=>{if(destroyed)return;destroyed=true;state.disposed=true;state.ready=false;state.count=0;state.revision++;state.active=state.staging=undefined;const errors:unknown[]=[];try{originalDestroy?.();}catch(error){errors.push(error);}try{this.#originalBack?.destroy();}catch(error){errors.push(error);}if(errors.length)throw new AggregateError(errors,'Triangle stream buffer cleanup failed');};
  const controller:AggregateTriangleStream=Object.freeze({primitive:state.primitive,capacityTriangles:state.capacity,get triangleCount(){return state.count;},get revision(){return state.revision;},update:(vertices:Float32Array,vertexCount:number)=>this.commitUpdate(this.#stageUpdate(vertices,vertexCount)),stage:(vertices:Float32Array,vertexCount:number)=>new UpdateTicket(this,this.#stageUpdate(vertices,vertexCount)),prepareUpdate:(vertices:Float32Array,vertexCount:number)=>this.#prepareUpdate(vertices,vertexCount),dispose:()=>this.release()});
  this.#controller=controller;this.#committed=true;
  try{this.#owner.adopted(controller);if(this.#disposed||!this.#owner.alive()||state.disposed)throw new Error('Triangle stream disposed during ownership transfer');this.#owner.retire(this);if(this.#disposed||!this.#owner.alive()||state.disposed)throw new Error('Triangle stream disposed during ownership transfer');return controller;}
  catch(error){try{this.release();}catch(cleanup){throw new AggregateError([error,cleanup],'Triangle stream ownership transfer cleanup failed');}throw error;}
 }
 #stageUpdate(vertices:Float32Array,vertexCount:number):number{
  const state=this.#state,mesh=this.#mesh;
  if(!this.#committed||this.#disposed||state.disposed||!mesh||!this.#owner.alive())throw new Error('Triangle stream was disposed');
  if(this.#updating)throw new Error('Triangle stream update cannot reenter');
  if(this.#pendingUpdate)throw new Error('Triangle stream already has a pending update');
  if(!(vertices instanceof Float32Array)||!Number.isSafeInteger(vertexCount)||vertexCount<0||vertexCount%3||vertexCount>state.capacity*3||vertices.length<vertexCount*6)throw new RangeError('Triangle stream update exceeds its packed page');
  this.#updating=true;
  try{
   const target=state.staging!,lo=this.#lower,hi=this.#upper;lo.fill(Infinity);hi.fill(-Infinity);
   // Finite validation and the owned copy finish BEFORE any GPU/visible change.
   for(let i=0;i<vertexCount*6;i++){const value=vertices[i]!;if(!Number.isFinite(value))throw new TypeError('Triangle stream contains a nonfinite packed scalar');target[i]=value;if(i%6<3){const axis=i%6;lo[axis]=Math.min(lo[axis]!,value);hi[axis]=Math.max(hi[axis]!,value);}}
   for(let offset=0,length=vertexCount*24;offset<length;offset+=65536){const bytes=Math.min(65536,length-offset);this.#device.queue.writeBuffer(this.#back,offset,target.buffer,offset,bytes);if(this.#disposed||state.disposed||!this.#owner.alive())throw new Error('Triangle stream disposed during upload');}
   this.#pendingVertices=vertexCount;this.#pendingUpdate=++this.#updateSerial;return this.#pendingUpdate;
  }finally{this.#updating=false;}
 }
 #prepareUpdate(vertices:Float32Array,vertexCount:number):TriangleStreamUpdatePreparation{
  const state=this.#state;
  if(!this.#committed||this.#disposed||state.disposed||!this.#mesh||!this.#owner.alive())throw new Error('Triangle stream was disposed');
  if(this.#updating)throw new Error('Triangle stream update cannot reenter');
  if(this.#pendingUpdate)throw new Error('Triangle stream already has a pending update');
  if(!(vertices instanceof Float32Array)||!Number.isSafeInteger(vertexCount)||vertexCount<0||vertexCount%3||vertexCount>state.capacity*3||vertices.length<vertexCount*6)throw new RangeError('Triangle stream update exceeds its packed page');
  const revision=++this.#updateSerial;this.#pendingUpdate=revision;this.#pendingVertices=vertexCount;
  this.#lower.fill(Infinity);this.#upper.fill(-Infinity);
  this.#updateJob={revision,source:vertexCount?vertices:undefined,vertexCount,copied:0,uploaded:0,pending:0,failure:undefined};
  return new IncrementalUpdateTicket(this,revision);
 }
 updateReady(revision:number):boolean{
  const job=this.#updateJob;
  return !this.#disposed&&!this.#state.disposed&&this.#pendingUpdate===revision&&job?.revision===revision&&job.copied===job.vertexCount*6&&job.uploaded===job.vertexCount*24&&job.pending===0&&job.failure===undefined;
 }
 stepUpdate(revision:number,maxBytes:number):boolean{
  if(!Number.isSafeInteger(maxBytes)||maxBytes<4)throw new RangeError('Triangle stream update step requires at least four bytes');
  if(this.#disposed||this.#state.disposed||!this.#owner.alive())throw new Error('Triangle stream was disposed');
  if(this.#updating)throw new Error('Triangle stream update cannot reenter');
  const job=this.#updateJob;
  if(!job||job.revision!==revision||this.#pendingUpdate!==revision)throw new Error('Triangle stream update ticket is stale');
  if(job.failure!==undefined){const failure=job.failure;this.cancelUpdate(revision);throw new Error('Triangle stream GPU update failed',{cause:failure});}
  if(this.updateReady(revision))return true;
  const bytes=Math.min(65536,Math.floor(maxBytes/4)*4),target=this.#state.staging!;
  this.#updating=true;
  try{
   if(job.copied<job.vertexCount*6){
    const end=Math.min(job.vertexCount*6,job.copied+bytes/4),source=job.source!;
    if(source.length<job.vertexCount*6)throw new Error('Triangle stream borrowed update source was detached');
    for(let i=job.copied;i<end;i++){const value=source[i]!;if(!Number.isFinite(value))throw new TypeError('Triangle stream contains a nonfinite packed scalar');target[i]=value;if(i%6<3){const axis=i%6;this.#lower[axis]=Math.min(this.#lower[axis]!,value);this.#upper[axis]=Math.max(this.#upper[axis]!,value);}}
    job.copied=end;if(end===job.vertexCount*6)job.source=undefined;
   }else if(job.uploaded<job.vertexCount*24){
    if(job.pending>=16)return false;
    const device=this.#device,offset=job.uploaded,length=Math.min(bytes,job.vertexCount*24-offset);let scopes=0;
    try{
     if(device.pushErrorScope&&device.popErrorScope){device.pushErrorScope('validation');scopes++;device.pushErrorScope('out-of-memory');scopes++;}
     if(this.#disposed||this.#state.disposed||this.#pendingUpdate!==revision||!this.#owner.alive())throw new Error('Triangle stream disposed during upload');
     device.queue.writeBuffer(this.#back,offset,target.buffer,offset,length);
     if(this.#disposed||this.#state.disposed||this.#pendingUpdate!==revision||!this.#owner.alive())throw new Error('Triangle stream disposed during upload');
     job.uploaded+=length;
    }finally{
     for(let i=0;i<scopes;i++){job.pending++;let check:Promise<any>;try{check=Promise.resolve(device.popErrorScope());}catch(error){check=Promise.reject(error);}void check.then(error=>{if(error)job.failure??=error;},error=>{job.failure??=error;}).finally(()=>job.pending--);}
    }
   }
   return this.updateReady(revision);
  }catch(error){this.cancelUpdate(revision);throw error;}finally{this.#updating=false;}
 }
 /** Internal fixed-work transaction tail; no driver or user callbacks. */
 commitUpdate(revision:number):void{
  const state=this.#state,mesh=this.#mesh;
  if(this.#disposed||state.disposed||!mesh)throw new Error('Triangle stream was disposed');
  if(this.#updating||revision!==this.#pendingUpdate||!revision)throw new Error('Triangle stream update ticket is stale');
  if(this.#updateJob&&!this.updateReady(revision))throw new Error('Triangle stream update preparation is incomplete');
  const vertexCount=this.#pendingVertices;
  if(vertexCount){const front=mesh.vertex;mesh.vertex=this.#back;this.#back=front;const old=state.active;state.active=state.staging;state.staging=old;}
  const center=state.bounds.center as number[],half=state.bounds.half as number[];
  for(let axis=0;axis<3;axis++){center[axis]=vertexCount?(this.#lower[axis]!+this.#upper[axis]!)*.5:0;half[axis]=vertexCount?(this.#upper[axis]!-this.#lower[axis]!)*.5:0;}
  state.count=vertexCount/3;mesh.count=vertexCount;mesh.triangles=state.count;state.revision++;this.#pendingUpdate=0;this.#updateJob=undefined;
 }
 cancelUpdate(revision:number):void{if(this.#pendingUpdate===revision){this.#pendingUpdate=0;if(this.#updateJob)this.#updateJob.source=undefined;this.#updateJob=undefined;}}
 private release():void{
  if(this.#disposed)return;this.#disposed=true;const errors:unknown[]=[];
  try{if(this.#mesh)this.#owner.unpublish(this.#state.primitive,this.#mesh);}catch(error){errors.push(error);}
  try{this.#inner.dispose();}catch(error){errors.push(error);}
  try{this.#mesh?.destroy?.();}catch(error){errors.push(error);}
  this.#state.disposed=true;this.#state.ready=false;this.#state.active=this.#state.staging=undefined;if(this.#updateJob)this.#updateJob.source=undefined;this.#updateJob=undefined;this.#pendingUpdate=0;
  this.#device=undefined;this.#back=this.#originalBack=undefined;if(this.#controller)this.#owner.released(this.#controller);this.#owner.retire(this);this.#mesh=undefined;this.#controller=undefined;this.#owner=undefined!;
  if(errors.length)throw new AggregateError(errors,'Triangle stream disposal failed');
 }
 dispose():void{if(this.#committed)return;if(this.#disposed)return;this.#disposed=true;const errors:unknown[]=[];try{this.#inner.dispose();}catch(error){errors.push(error);}try{this.#originalBack?.destroy();}catch(error){errors.push(error);}this.#state.disposed=true;this.#state.active=this.#state.staging=undefined;this.#device=undefined;this.#back=this.#originalBack=undefined;this.#owner.retire(this);this.#owner=undefined!;if(errors.length)throw new AggregateError(errors,'Triangle stream preparation disposal failed');}
}
