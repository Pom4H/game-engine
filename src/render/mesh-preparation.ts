import type {MeshBounds} from './visibility.js';
import type {TriangleMeshPacking,TrianglePackedStream} from '../procedural/copied-triangle.js';

export interface MeshPreparationLease {
 readonly ready:boolean;
 /** One allocation or one <=64 KiB packing/upload block per call. No waits. */
 step(maxBytes?:number):boolean;
 /** Admit the complete mesh cache entry and retain its residency pin. */
 commit():void;
 /** Release the pin, or destroy every unpublished buffer. Idempotent. */
 dispose():void;
}
export interface PreparedMeshResources {key:string;bounds:MeshBounds;vertex:any;color:any;index:any;count:number;format:'uint16'|'uint32';triangles:number;destroy?():void}
interface Owner {
 lookup():PreparedMeshResources|undefined;
 publish(mesh:PreparedMeshResources):void;
 unpublish(mesh:PreparedMeshResources):void;
 pin(mesh:PreparedMeshResources,delta:1|-1):void;
 retire(lease:MeshPreparationLease):void;
 alive():boolean;
}
const streams:readonly TrianglePackedStream[]=['vertex','color','index'];
function destroyBuffers(lifetime:{destroyed:boolean},buffers:readonly any[]):void{
 if(lifetime.destroyed)return;lifetime.destroyed=true;const errors:unknown[]=[];
 for(let i=buffers.length-1;i>=0;i--)try{buffers[i]?.destroy();}catch(error){errors.push(error);}
 if(errors.length===1)throw errors[0];if(errors.length)throw new AggregateError(errors,'Mesh cleanup failed');
}
/** Cold-only lease. Buffer references move to the renderer only after a whole
 * upload succeeds. Renderer collection cannot retire a committed pinned mesh. */
export class StagedMeshLease implements MeshPreparationLease {
 private packing:TriangleMeshPacking|undefined;
 private resources:PreparedMeshResources|undefined;
 private readonly allocated:Partial<Record<TrianglePackedStream,any>>={};
 private allocation=0;
 private disposed=false;
 private committed=false;
 private stepping=false;
 private committing=false;
 private cancelCommit=false;
 private readonly bufferLifetime={destroyed:false};
 private pendingChecks=0;
 private rejection:Error|undefined;
 private owner:Owner|undefined;
 private device:any;
 constructor(device:any,private readonly key:string,packing:TriangleMeshPacking|undefined,owner:Owner,cached?:PreparedMeshResources){
  this.device=device;this.owner=owner;this.packing=packing;
  if(cached){owner.pin(cached,1);if(!owner.alive()){owner.pin(cached,-1);throw new Error('Renderer was disposed during mesh preparation');}this.resources=cached;this.committed=true;}
  if(packing){const limit=device.limits?.maxBufferSize??268435456;for(const kind of streams)if(packing.lengths[kind]>limit)throw new RangeError('Prepared mesh exceeds the device buffer limit');}
 }
 get ready():boolean{return !this.disposed&&this.resources!==undefined&&this.pendingChecks===0&&this.rejection===undefined;}
 private checked<T>(run:()=>T):T{
  const device=this.device;
  if(typeof device.pushErrorScope!=='function'||typeof device.popErrorScope!=='function')return run();
  let opened=0;
  try{device.pushErrorScope('validation');opened++;device.pushErrorScope('out-of-memory');opened++;return run();}finally{
   // Open and close scopes in this same synchronous step: live frame work can
   // never become part of a cold lease's error scope. No GPU completion wait.
   for(let i=0;i<opened;i++){
    this.pendingChecks++;
    let check:Promise<unknown>;try{check=Promise.resolve(device.popErrorScope());}catch(error){check=Promise.reject(error);}
    void check.then(error=>{if(error&&!this.disposed)this.rejection??=new Error('Prepared mesh GPU error: '+String((error as {message?:unknown}).message??error));},error=>{if(!this.disposed)this.rejection??=new Error('Prepared mesh GPU error scope failed',{cause:error});}).finally(()=>{this.pendingChecks--;});
   }
  }
 }
 private rejectIfFailed():void{
  const failure=this.rejection;if(!failure)return;
  try{this.dispose();}catch(cleanup){throw new AggregateError([failure,cleanup],'GPU rejection and cleanup failed');}throw failure;
 }
 step(maxBytes=65536):boolean{
  if(!Number.isSafeInteger(maxBytes)||maxBytes<4)throw new RangeError('Mesh upload requires at least four bytes');
  if(this.disposed||!this.owner?.alive())throw new Error('Mesh preparation was disposed');
  if(this.stepping||this.committing)throw new Error('Mesh preparation cannot reenter');
  this.rejectIfFailed();
  if(this.ready)return true;
  if(this.resources||this.pendingChecks>=16)return false;
  this.stepping=true;
  try{
   const packing=this.packing!;
   if(this.allocation<streams.length){
    const kind=streams[this.allocation]!;
    this.checked(()=>{
     const buffer=this.device.createBuffer({label:'prepared mesh '+kind,size:Math.max(4,packing.lengths[kind]),usage:(kind==='index'?0x10:0x20)|0x08});
     if(this.disposed){const error=new Error('Mesh preparation was disposed during allocation');try{buffer.destroy();}catch(cleanup){throw new AggregateError([error,cleanup],'Cancelled allocation cleanup failed');}throw error;}
     // Own immediately, before error-scope callbacks can synchronously cancel.
     this.allocated[kind]=buffer;
    });
    if(this.disposed)throw new Error('Mesh preparation was disposed during allocation');
    this.allocation++;return false;
   }
   const block=packing.next(Math.min(65536,maxBytes));
   if(block)this.checked(()=>this.device.queue.writeBuffer(this.allocated[block.stream],block.offset,block.bytes));
   if(this.disposed)throw new Error('Mesh preparation was disposed during upload');
   if(packing.done){const lifetime=this.bufferLifetime,buffers=[this.allocated.vertex,this.allocated.color,this.allocated.index];this.resources={key:this.key,bounds:packing.bounds,vertex:buffers[0],color:buffers[1],index:buffers[2],count:packing.count,format:packing.format,triangles:packing.count/3,destroy:()=>destroyBuffers(lifetime,buffers)};this.packing=undefined;}
   return this.ready;
  }catch(error){try{this.dispose();}catch(cleanup){throw new AggregateError([error,cleanup],'Mesh preparation and cleanup failed');}throw error;}finally{this.stepping=false;}
 }
 commit():void{
  if(this.disposed||!this.owner?.alive())throw new Error('Mesh preparation was disposed');
  if(this.stepping||this.committing)throw new Error('Mesh preparation cannot reenter');
  this.rejectIfFailed();
  if(!this.ready)throw new Error('Mesh preparation is incomplete');
  if(this.committed)return;
  const owner=this.owner;let pinned=false,published=false;this.committing=true;
  try{
   const old=owner.lookup();
   if(old){this.destroyAllocated();this.resources=old;owner.pin(old,1);pinned=true;}
   else{
    owner.pin(this.resources!,1);pinned=true;published=true;owner.publish(this.resources!);
   }
   if(this.cancelCommit||!owner.alive())throw new Error('Mesh preparation was disposed during cache admission');
   this.committed=true;
   // Ownership transferred to the complete cache entry; no duplicate cleanup.
   for(const key of streams)delete this.allocated[key];
  }catch(error){
   const errors:unknown[]=[error];
   if(published)try{owner.unpublish(this.resources!);}catch(cleanup){errors.push(cleanup);}
   if(pinned)try{owner.pin(this.resources!,-1);}catch(cleanup){errors.push(cleanup);}
   this.committing=false;try{this.dispose();}catch(cleanup){errors.push(cleanup);}
   if(errors.length>1)throw new AggregateError(errors,'Mesh cache admission and cleanup failed');throw error;
  }finally{this.committing=false;}
 }
 private destroyAllocated():void{
  const buffers=[this.allocated.vertex,this.allocated.color,this.allocated.index];for(const key of streams)delete this.allocated[key];destroyBuffers(this.bufferLifetime,buffers);
 }
 dispose():void{
  if(this.disposed)return;if(this.committing){this.cancelCommit=true;return;}this.disposed=true;
  const owner=this.owner;this.owner=undefined;this.packing=undefined;
  try{if(this.committed&&this.resources)owner?.pin(this.resources,-1);else this.destroyAllocated();}
  finally{this.resources=undefined;this.device=undefined;owner?.retire(this);}
 }
}
