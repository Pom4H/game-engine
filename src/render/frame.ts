import {compose,type Mat4} from '../math.js';
import {primitiveMesh,type MeshData} from '../procedural/mesh.js';
import type {CameraSpec} from '../scene/types.js';
import type {Scene,RuntimeEntity} from '../scene/scene.js';
import type {Primitive} from '../scene/types.js';
import {isTriangleStream,triangleStreamRevision,triangleStreamSnapshot} from '../procedural/triangle-stream.js';
import {snapshotTransparentSort,sameTransparentSort} from './transparent-sort.js';
import type {TransparentSortSpec} from '../scene/types.js';

export interface RenderObjectIR{
  readonly entity:RuntimeEntity;
  /** Stable current surface identity; future part-level surfaces refine this without changing entity identity. */
  readonly surfaceId:string;
  /** Authoritative physical source. Render-only entities may omit it. */
  readonly physicalPrimitive?:Primitive;
  /** Selected visible representation for the compiled render depth. */
  readonly primitive:Primitive;
  /** Live stream observation. Pure builders capture an immutable mesh instead. */
  readonly geometryRevision?:number;
  readonly transparentSort?:TransparentSortSpec;
  readonly mesh?:MeshData;
  readonly model:Mat4;
}
export interface RenderFrameIR{
  readonly scene:Scene;
  readonly camera:CameraSpec;
  readonly objects:readonly RenderObjectIR[];
  readonly objectsById:ReadonlyMap<string,RenderObjectIR>;
  readonly lights:readonly RuntimeEntity[];
}
export function renderPrimitive(entity:RuntimeEntity):Primitive|undefined{return entity.renderVisible===false?undefined:entity.renderMesh??entity.mesh;}
export function renderProxyPrimitive(entity:RuntimeEntity):Primitive|undefined{return entity.renderVisible===false?undefined:entity.mesh;}
export function primitiveBaseScale(primitive:Primitive|undefined):readonly [number,number,number]{
  if(!primitive)return[1,1,1];
  if(primitive.kind==='box'||primitive.kind==='shard'){const s=primitive.size??[1,1,1];return[s[0],s[1],s[2]];}
  if(primitive.kind==='sphere'){const d=2*(primitive.radius??1);return[d,d,d];}
  if(primitive.kind==='plane')return[primitive.size?.[0]??1,1,primitive.size?.[1]??1];
  return[1,1,1];
}
export function renderModel(entity:RuntimeEntity):Mat4{
  const primitive=renderPrimitive(entity),base=primitiveBaseScale(primitive);
  return compose(entity.position,entity.rotation,[entity.scale[0]*base[0],entity.scale[1]*base[1],entity.scale[2]*base[2]]);
}
function buildFrame(scene:Scene,camera:CameraSpec,primitiveFor:(entity:RuntimeEntity)=>Primitive|undefined,includeMeshes=false):RenderFrameIR{
  const objects:RenderObjectIR[]=[],lights:RuntimeEntity[]=[];
  for(const entity of scene.entities.values()){
    if(entity.renderVisible===false)continue;
    if(entity.light)lights.push(entity);
    const source=primitiveFor(entity);if(!source)continue;
    const primitive=isTriangleStream(source)?triangleStreamSnapshot(source):source;if(!primitive)continue;
    const base=primitiveBaseScale(primitive),model=primitive===renderPrimitive(entity)?renderModel(entity):compose(entity.position,entity.rotation,[entity.scale[0]*base[0],entity.scale[1]*base[1],entity.scale[2]*base[2]]);
    const physical=entity.mesh===source?primitive:isTriangleStream(entity.mesh)?triangleStreamSnapshot(entity.mesh):entity.mesh;
    objects.push({entity,surfaceId:entity.id,...(physical?{physicalPrimitive:physical}:{}),primitive,...(isTriangleStream(source)?{geometryRevision:triangleStreamRevision(source)}:{}),...(entity.transparentSort?{transparentSort:snapshotTransparentSort(entity.transparentSort)!}:{}),...(includeMeshes?{mesh:primitiveMesh(primitive)}:{}),model});
  }
  return{scene,camera,objects,objectsById:new Map(objects.map(object=>[object.entity.id,object] as const)),lights};
}
export function buildRenderFrame(scene:Scene,camera:CameraSpec=scene.camera,options:{readonly includeMeshes?:boolean}={}):RenderFrameIR{
  return buildFrame(scene,camera,renderPrimitive,options.includeMeshes??false);
}
export function buildProxyRenderFrame(scene:Scene,camera:CameraSpec=scene.camera,options:{readonly includeMeshes?:boolean}={}):RenderFrameIR{
  return buildFrame(scene,camera,renderProxyPrimitive,options.includeMeshes??false);
}
export function buildDormantRenderFrame(scene:Scene,camera:CameraSpec=scene.camera):RenderFrameIR{
  return{scene,camera,objects:Object.freeze([]),objectsById:new Map(),lights:Object.freeze([])};
}

interface CachedRenderObject {entity:RuntimeEntity;primitive:Primitive;base:readonly [number,number,number];slot:number;seen:number;pose:Float64Array;object:RenderObjectIR;geometryRevision:number;isStream:boolean;sort:TransparentSortSpec|undefined}
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
  private entriesByEntity=new Map<RuntimeEntity,CachedRenderObject>();
  private poses=new Float64Array(0);
  private poseSlots=0;
  private freePoseSlots:number[]=[];
  private observation=0;
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
    const observation=++this.observation;
    if(builder!==buildDormantRenderFrame)for(const entity of scene.entities.values()){
      if(entity.renderVisible===false)continue;
      if(entity.light)this.lights[lightIndex++]=entity;
      const primitive=primitiveFor(entity);if(!primitive)continue;
      let entry=this.entries[index];if(entry?.entity!==entity)entry=this.entriesByEntity.get(entity);
      if(!entry){
        const slot=this.freePoseSlots.pop()??this.poseSlots++;
        this.reservePoses(slot+1);
        const isStream=isTriangleStream(primitive);
        entry={entity,primitive,base:primitiveBaseScale(primitive),slot,seen:observation,pose:new Float64Array(this.poses.buffer,slot*9*8,9).fill(NaN),object:null!,geometryRevision:isStream?triangleStreamRevision(primitive):0,isStream,sort:snapshotTransparentSort(entity.transparentSort)};
        this.entriesByEntity.set(entity,entry);
      }else if(entry.primitive!==primitive){
        entry.primitive=primitive;entry.base=primitiveBaseScale(primitive);entry.isStream=isTriangleStream(primitive);entry.geometryRevision=entry.isStream?triangleStreamRevision(primitive):0;entry.pose.fill(NaN);topologyChanged=true;
      }
      // Source order controls coplanar ties, but removing an earlier entity must
      // not manufacture motion or replace the immutable matrices of survivors.
      if(this.entries[index]!==entry)topologyChanged=true;
      this.entries[index]=entry;entry.seen=observation;
      const p=entity.position,r=entity.rotation,s=entity.scale,pose=entry.pose;
      const linearChanged=pose[3]!==r[0]||pose[4]!==r[1]||pose[5]!==r[2]||pose[6]!==s[0]||pose[7]!==s[1]||pose[8]!==s[2];
      if(linearChanged||pose[0]!==p[0]||pose[1]!==p[1]||pose[2]!==p[2]){
        pose.set(p,0);pose.set(r,3);pose.set(s,6);
        let model:Mat4;
        if(linearChanged)model=compose(p,r,[s[0]*entry.base[0],s[1]*entry.base[1],s[2]*entry.base[2]]);
        else{model=new Float32Array(entry.object.model);model[12]=p[0];model[13]=p[1];model[14]=p[2];this.translationUpdates++;}
        entry.object={entity,surfaceId:entity.id,...(entity.mesh?{physicalPrimitive:entity.mesh}:{}),primitive,...(entry.isStream?{geometryRevision:triangleStreamRevision(primitive)}:{}),...(entry.sort?{transparentSort:entry.sort}:{}),model};this.modelUpdates++;
        this.changed.push(entry.object);
        this.objectsById.set(entity.id,entry.object);
      }else if(entry.object.physicalPrimitive!==entity.mesh){
        entry.object={entity,surfaceId:entity.id,...(entity.mesh?{physicalPrimitive:entity.mesh}:{}),primitive,...(entry.isStream?{geometryRevision:entry.geometryRevision}:{}),...(entry.sort?{transparentSort:entry.sort}:{}),model:entry.object.model};
        this.objectsById.set(entity.id,entry.object);
      }
      const geometryRevision=entry.isStream?triangleStreamRevision(primitive):0;
      if(entry.geometryRevision!==geometryRevision){entry.geometryRevision=geometryRevision;entry.object={...entry.object,geometryRevision};this.objectsById.set(entity.id,entry.object);this.changed.push(entry.object);}
      if(!sameTransparentSort(entry.sort,entity.transparentSort)){entry.sort=snapshotTransparentSort(entity.transparentSort);const {transparentSort:previousSort,...object}=entry.object;entry.object={...object,...(entry.sort?{transparentSort:entry.sort}:{})};this.objectsById.set(entity.id,entry.object);this.changed.push(entry.object);}
      this.objects[index++]=entry.object;
      observer?.observe(entity,entry.object.model);
    }
    if(this.entries.length!==index||this.entriesByEntity.size!==index)topologyChanged=true;
    this.entries.length=index;this.objects.length=index;this.lights.length=lightIndex;
    if(topologyChanged){
      // Strong identity keys are retained only for this completed projection.
      // Recycle their numeric rows; the arena stays bounded by peak live demand.
      for(const [entity,entry] of this.entriesByEntity)if(entry.seen!==observation){this.entriesByEntity.delete(entity);this.freePoseSlots.push(entry.slot);}
      this.objectsById.clear();for(const object of this.objects)this.objectsById.set(object.entity.id,object);this.builds++;
    }
    return{scene,camera,objects:this.objects,objectsById:this.objectsById,lights:this.lights};
  }
  inspect(){return{entries:this.entries.length,lights:this.lights.length,builds:this.builds,modelUpdates:this.modelUpdates,translationUpdates:this.translationUpdates};}
  /** Only a completed built-in live projection certifies this frame's changes. */
  changedObjects():readonly RenderObjectIR[]|undefined{return this.observed?this.changed:undefined;}
  private reservePoses(count:number):void{
    if(count*9<=this.poses.length)return;
    const capacity=this.poses.length?Math.max(count,this.poses.length/9*2):Math.max(4,count);
    const next=new Float64Array(capacity*9);next.set(this.poses);this.poses=next;
    for(const entry of this.entriesByEntity.values())entry.pose=new Float64Array(next.buffer,entry.slot*9*8,9);
  }
  clear():void{this.scene=null;this.builder=null;this.entries.length=0;this.entriesByEntity.clear();this.poses=new Float64Array(0);this.poseSlots=0;this.freePoseSlots.length=0;this.observation=0;this.objects.length=0;this.objectsById.clear();this.lights.length=0;this.changed.length=0;this.observed=false;}
}
