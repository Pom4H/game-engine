import type {RuntimeEntity} from '../scene/scene.js';
import type {Mat4} from '../math.js';

export interface EntityPreparationLease {
 readonly ready:boolean;
 /** One fixed-size buffer allocation, binding creation, or 400-byte uniform
  * upload. Error scopes close in the same call; no frame/GPU execution wait. */
 step():boolean;
 /** Retain the detached binding by exact entity identity. First live prepare
  * adopts it without resource creation, leaving a same-ID old object intact. */
 commit():void;
 /** Cancel a detached object, or release the lease after live adoption. */
 dispose():void;
}
export interface PreparedEntityObject {
 source?:RuntimeEntity;material?:RuntimeEntity['material'];uniform:any;bind:any;texture:any;deformationTexture:any;width:number;height:number;owned?:boolean;label?:string;materialKey?:string;uniformReady?:boolean;lastModel?:Mat4;lastPrevModel?:Mat4;instancedMaterial?:boolean;
 destroy?():void;preparedAdopted?:boolean;preparedTextureURLs?:readonly (string|undefined)[];
 materialTexture?:any;normalTexture?:any;ormTexture?:any;heightTexture?:any;labelTexture?:any;
 uniformStaging?:Float32Array;surfaceStaging?:Float32Array;deformationStaging?:Float32Array;lastSurfaceRevision?:number|undefined;
}
export interface EntityPreparationOwner {
 alive():boolean;
 /** Start at most one authored texture URL request per step. Its existing
  * decoder/upload promise is an explicit readiness prerequisite. */
 prepare():boolean;
 allocate():PreparedEntityObject;
 bind(object:PreparedEntityObject):void;
 write(object:PreparedEntityObject):void;
 valid(object:PreparedEntityObject):boolean;
 publish(object:PreparedEntityObject):void;
 unpublish(object:PreparedEntityObject):void;
 destroy(object:PreparedEntityObject):void;
 retire(lease:EntityPreparationLease):void;
}
/** Cold-only resource owner. It never inserts a partially ready object into the
 * live ID cache. One buffer has an idempotent lifetime shared with the renderer. */
export class StagedEntityLease implements EntityPreparationLease {
 private object:PreparedEntityObject|undefined;
 private stage=0;private disposed=false;private committed=false;private stepping=false;private publishing=false;private cancelPublish=false;
 private pending=0;private failure:Error|undefined;
 constructor(private device:any,private owner:EntityPreparationOwner|undefined){}
 get ready():boolean{return !this.disposed&&this.stage===3&&this.pending===0&&!this.failure&&!!this.owner?.alive()&&this.owner.valid(this.object!);}
 private checked(run:()=>void):void{
  const device=this.device;let opened=0;
  try{if(typeof device.pushErrorScope==='function'&&typeof device.popErrorScope==='function'){device.pushErrorScope('validation');opened++;device.pushErrorScope('out-of-memory');opened++;}run();}
  finally{for(let i=0;i<opened;i++){this.pending++;let result:Promise<unknown>;try{result=Promise.resolve(device.popErrorScope());}catch(error){result=Promise.reject(error);}void result.then(error=>{if(error&&!this.disposed)this.failure??=new Error('Prepared entity GPU error: '+String((error as {message?:unknown}).message??error));},error=>{if(!this.disposed)this.failure??=new Error('Prepared entity GPU error scope failed',{cause:error});}).finally(()=>{this.pending--;});}}
 }
 private assertUsable():void{
  if(this.disposed||!this.owner?.alive())throw new Error('Entity preparation was disposed');
  if(this.stepping||this.publishing)throw new Error('Entity preparation cannot reenter');
  if(this.failure)throw this.failure;
  if(this.object&&!this.owner.valid(this.object))throw new Error('Prepared entity binding changed before publication');
 }
 step():boolean{
  if(this.stepping||this.publishing)throw new Error('Entity preparation cannot reenter');
  try{this.assertUsable();if(this.ready)return true;if(this.stage===3)return false;this.stepping=true;
   const owner=this.owner!;
   if(this.stage===0&&!owner.prepare()){if(this.disposed)throw new Error('Entity preparation was disposed during texture readiness');return false;}
   this.checked(()=>{
    if(this.stage===0){const object=owner.allocate();if(this.disposed){owner.destroy(object);throw new Error('Entity preparation was disposed during allocation');}this.object=object;}
    else if(this.stage===1)owner.bind(this.object!);
    else owner.write(this.object!);
   });
   if(this.disposed)throw new Error('Entity preparation was disposed during GPU work');
   this.stage++;return this.ready;
  }catch(error){if(this.stepping&&this.disposed)throw error;try{this.dispose();}catch(cleanup){throw new AggregateError([error,cleanup],'Entity preparation and cleanup failed');}throw error;}
  finally{this.stepping=false;}
 }
 commit():void{
  this.assertUsable();if(!this.ready)throw new Error('Entity preparation is incomplete');if(this.committed)return;
  const owner=this.owner!;this.publishing=true;
  try{owner.publish(this.object!);if(this.cancelPublish||!owner.alive())throw new Error('Entity preparation was disposed during admission');this.committed=true;}
  catch(error){const errors:unknown[]=[error];try{owner.unpublish(this.object!);}catch(cleanup){errors.push(cleanup);}this.publishing=false;try{this.dispose();}catch(cleanup){errors.push(cleanup);}if(errors.length>1)throw new AggregateError(errors,'Entity admission and cleanup failed');throw error;}
  finally{this.publishing=false;}
 }
 dispose():void{
  if(this.disposed)return;if(this.publishing){this.cancelPublish=true;return;}this.disposed=true;
  const owner=this.owner,object=this.object;this.owner=undefined;this.object=undefined;this.device=undefined;
  try{if(object){if(this.committed)owner?.unpublish(object);else owner?.destroy(object);}}
  finally{owner?.retire(this);}
 }
}
