// Frozen pre-identity RenderFrameCache, captured 2026-10-21. Shared canonical builder functions retain the production identity contract.
import {compose,type Mat4} from '../../../src/math.js';
import type {Scene,RuntimeEntity} from '../../../src/scene/scene.js';
import type {CameraSpec,Primitive} from '../../../src/scene/types.js';
import {buildRenderFrame,buildProxyRenderFrame,buildDormantRenderFrame,renderPrimitive,renderProxyPrimitive,primitiveBaseScale,type RenderObjectIR,type RenderFrameIR} from '../../../src/render/frame.js';
interface CachedRenderObject {entity:RuntimeEntity;primitive:Primitive;base:readonly [number,number,number];pose:Float64Array;object:RenderObjectIR}
/** Dependent projections consume the same freshly observed transform stream.
 * Only the built-in live projections certify pose observations; custom builders
 * and dormant frames require a consumer's authoritative Scene fallback. */
export interface RenderFrameObserver {
  begin(scene:Scene,observed:boolean):void;
  observe(entity:RuntimeEntity,model:Mat4):void;
  end():void;
  abort():void;
}
/** Renderer-owned live projection. Pure buildRenderFrame snapshots stay independent;
 * this bounded working set reuses topology and replaces matrices only after motion. */
export class RenderFrameCache {
  private scene:Scene|null=null;
  private builder:typeof buildRenderFrame|null=null;
  private entries:CachedRenderObject[]=[];
  private poses=new Float64Array(0);
  private objects:RenderObjectIR[]=[];
  private objectsById=new Map<string,RenderObjectIR>();
  private lights:RuntimeEntity[]=[];
  private changed:RenderObjectIR[]=[];
  private observed=false;
  private builds=0;private modelUpdates=0;private translationUpdates=0;
  build(scene:Scene,camera:CameraSpec,builder:typeof buildRenderFrame=buildRenderFrame,observer?:RenderFrameObserver):RenderFrameIR{
    this.changed.length=0;this.observed=false;
    try{observer?.begin(scene,builder===buildRenderFrame||builder===buildProxyRenderFrame);const result=this.buildProjection(scene,camera,builder,observer);observer?.end();this.observed=builder===buildRenderFrame||builder===buildProxyRenderFrame;return result;}
    catch(error){this.observed=false;observer?.abort();throw error;}
  }
  private buildProjection(scene:Scene,camera:CameraSpec,builder:typeof buildRenderFrame,observer?:RenderFrameObserver):RenderFrameIR{
    if(builder!==buildRenderFrame&&builder!==buildProxyRenderFrame&&builder!==buildDormantRenderFrame){this.clear();return builder(scene,camera);}
    if(this.scene!==scene||this.builder!==builder){this.clear();this.scene=scene;this.builder=builder;}
    if(builder!==buildDormantRenderFrame)this.reservePoses(scene.entities.size);
    const primitiveFor=builder===buildProxyRenderFrame?renderProxyPrimitive:renderPrimitive;
    let index=0,lightIndex=0,topologyChanged=false;
    if(builder!==buildDormantRenderFrame)for(const entity of scene.entities.values()){
      if(entity.renderVisible===false)continue;
      if(entity.light)this.lights[lightIndex++]=entity;
      const primitive=primitiveFor(entity);if(!primitive)continue;
      let entry=this.entries[index];
      if(!entry||entry.entity!==entity||entry.primitive!==primitive){
        this.reservePoses(index+1);
        entry={entity,primitive,base:primitiveBaseScale(primitive),pose:new Float64Array(this.poses.buffer,index*9*8,9).fill(NaN),object:null!};this.entries[index]=entry;topologyChanged=true;
      }
      const p=entity.position,r=entity.rotation,s=entity.scale,pose=entry.pose;
      const linearChanged=pose[3]!==r[0]||pose[4]!==r[1]||pose[5]!==r[2]||pose[6]!==s[0]||pose[7]!==s[1]||pose[8]!==s[2];
      if(linearChanged||pose[0]!==p[0]||pose[1]!==p[1]||pose[2]!==p[2]){
        pose.set(p,0);pose.set(r,3);pose.set(s,6);
        let model:Mat4;
        if(linearChanged)model=compose(p,r,[s[0]*entry.base[0],s[1]*entry.base[1],s[2]*entry.base[2]]);
        else{model=new Float32Array(entry.object.model);model[12]=p[0];model[13]=p[1];model[14]=p[2];this.translationUpdates++;}
        entry.object={entity,surfaceId:entity.id,...(entity.mesh?{physicalPrimitive:entity.mesh}:{}),primitive,model};this.modelUpdates++;
        this.changed.push(entry.object);
        this.objectsById.set(entity.id,entry.object);
      }else if(entry.object.physicalPrimitive!==entity.mesh){
        entry.object={entity,surfaceId:entity.id,...(entity.mesh?{physicalPrimitive:entity.mesh}:{}),primitive,model:entry.object.model};
        this.objectsById.set(entity.id,entry.object);
      }
      this.objects[index++]=entry.object;
      observer?.observe(entity,entry.object.model);
    }
    if(this.entries.length!==index)topologyChanged=true;
    this.entries.length=index;this.objects.length=index;this.lights.length=lightIndex;
    if(topologyChanged){this.objectsById.clear();for(const object of this.objects)this.objectsById.set(object.entity.id,object);this.builds++;}
    return{scene,camera,objects:this.objects,objectsById:this.objectsById,lights:this.lights};
  }
  inspect(){return{entries:this.entries.length,lights:this.lights.length,builds:this.builds,modelUpdates:this.modelUpdates,translationUpdates:this.translationUpdates};}
  /** Only a completed built-in live projection certifies this frame's changes. */
  changedObjects():readonly RenderObjectIR[]|undefined{return this.observed?this.changed:undefined;}
  private reservePoses(count:number):void{
    if(count*9<=this.poses.length)return;
    const capacity=this.poses.length?Math.max(count,this.poses.length/9*2):Math.max(4,count);
    const next=new Float64Array(capacity*9);next.set(this.poses);this.poses=next;
    for(let index=0;index<this.entries.length;index++)this.entries[index]!.pose=new Float64Array(next.buffer,index*9*8,9);
  }
  clear():void{this.scene=null;this.builder=null;this.entries.length=0;this.poses=new Float64Array(0);this.objects.length=0;this.objectsById.clear();this.lights.length=0;this.changed.length=0;this.observed=false;}
}
