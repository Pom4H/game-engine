import {multiply4Into,type Mat4,type Vec3} from '../math.js';
import type {Scene,RuntimeEntity} from '../scene/scene.js';
import type {Primitive} from '../scene/types.js';
import {renderPrimitive,type RenderObjectIR} from './frame.js';
import {intersectsClip,type MeshBounds} from './visibility.js';
import {MAX_SURFACE_DISPLACEMENT_M} from '../environment/deformable-surface.js';
import {triangleStreamRevision} from '../procedural/triangle-stream.js';

const CAMERA_OPAQUE=1,CAMERA_TRANSPARENT=2,REFLECTION=4,STATIC_SHADOW=8,DYNAMIC_SHADOW=16,ALL=31;
export function castsRenderShadow(entity:RuntimeEntity):boolean{
 const emission=entity.material.emissive;
 return entity.material.color[3]>=.98&&entity.material.groundCover!=='grass-blade'&&!entity.material.decal&&!(emission&&Math.max(...emission)>1);
}
interface Entry {entity:RuntimeEntity;primitive:Primitive;model:Mat4;roles:number;mover:boolean;deformed:boolean;heightUrl:string|undefined;reliefDepth:number;reliefSize:number;observation:number;geometryRevision:number}
type BoundsFor=(primitive:Primitive)=>MeshBounds;
const sameMatrix=(a:Mat4|null,b:Mat4)=>a!==null&&a.every((value,index)=>value===b[index]);
const staticRoles=(roles:number,mover:boolean)=>roles&(mover?STATIC_SHADOW:ALL^DYNAMIC_SHADOW);

/** A pass owns only its current candidates and latest static projection. View
 * matrices are copied: callers can reuse their uniform buffers in place. */
class VisibilityPass {
  private statics:Entry[]=[];
  private movers:Entry[]=[];
  private visibleStatics:RuntimeEntity[]=[];
  private matrix:Mat4|null=null;
  private staticDirty=true;
  private sourceBuilds=0;
  private staticBuilds=0;
  private tests=0;
  private lastTests=0;
  private readonly scratch=new Float32Array(16);
  revision=0;
  constructor(readonly role:number){}
  configure(entries:readonly Entry[],moverOrder:ReadonlyMap<string,number>):void{
    const statics:Entry[]=[],movers:Entry[]=[];
    for(const entry of entries){
      if(!(entry.roles&this.role))continue;
      const moving=this.role===DYNAMIC_SHADOW||(this.role!==STATIC_SHADOW&&entry.mover);
      (moving?movers:statics).push(entry);
    }
    movers.sort((a,b)=>(moverOrder.get(a.entity.id)??-1)-(moverOrder.get(b.entity.id)??-1));
    const sameEntries=(a:readonly Entry[],b:readonly Entry[])=>a.length===b.length&&a.every((entry,index)=>entry===b[index]);
    // A different source pass may insert/remove a visual without changing this
    // pass's ordered candidates. Keep both its projection and source certificate.
    if(sameEntries(statics,this.statics)&&sameEntries(movers,this.movers))return;
    if(statics.length!==this.statics.length||statics.some((entry,index)=>entry!==this.statics[index]))this.staticDirty=true;
    this.statics=statics;this.movers=movers;this.sourceBuilds++;
  }
  invalidateStatics():void{this.staticDirty=true;}
  skip():void{this.lastTests=0;}
  project(matrix:Mat4,boundsFor:BoundsFor):readonly RuntimeEntity[]{
    this.lastTests=0;
    if(!sameMatrix(this.matrix,matrix)){this.matrix=new Float32Array(matrix);this.staticDirty=true;}
    const displacement={projection:matrix,worldY:MAX_SURFACE_DISPLACEMENT_M};
    const visible=(entry:Entry)=>{
      this.lastTests++;this.tests++;
      multiply4Into(matrix,entry.model,this.scratch);
      return intersectsClip(boundsFor(entry.primitive),this.scratch,entry.deformed?displacement:undefined);
    };
    if(this.staticDirty){
      this.visibleStatics=this.statics.filter(visible).map(entry=>entry.entity);
      this.staticDirty=false;this.staticBuilds++;this.revision++;
    }
    if(!this.movers.length)return this.visibleStatics;
    const result=this.visibleStatics.slice();
    for(const entry of this.movers)if(visible(entry))result.push(entry.entity);
    return result;
  }
  inspect(){return{staticCandidates:this.statics.length,movingCandidates:this.movers.length,sourceBuilds:this.sourceBuilds,staticBuilds:this.staticBuilds,tests:this.tests,lastTests:this.lastTests,revision:this.revision};}
  clear():void{this.statics=[];this.movers=[];this.visibleStatics=[];this.matrix=null;this.staticDirty=true;}
}

export interface VisibilityPlanSnapshot {
  entries:number;sourceBuilds:number;
  passes:Record<'cameraOpaque'|'cameraTransparent'|'reflection'|'staticShadow'|'dynamicShadow',ReturnType<VisibilityPass['inspect']>>;
}

/** Compile membership once per relevant cause, then project independent views.
 * Camera motion cannot invalidate the light's static projection. Model identity
 * comes from RenderFrameCache; geometry and numeric material classification are
 * observed every frame, including direct edits and newly posed visual objects.
 * This is a renderer-owned projection, never a second physical world. */
export class RenderVisibilityPlan {
  private scene:Scene|null=null;
  private entries:Entry[]=[];
  private nextEntries:Entry[]=[];
  private entriesByEntity=new WeakMap<RuntimeEntity,Entry>();
  private observation=0;
  private sourceBuilds=0;
  private moverIds:ReadonlySet<string>|null=null;
  private readonly cameraOpaque=new VisibilityPass(CAMERA_OPAQUE);
  private readonly cameraTransparent=new VisibilityPass(CAMERA_TRANSPARENT);
  private readonly reflection=new VisibilityPass(REFLECTION);
  private readonly staticShadow=new VisibilityPass(STATIC_SHADOW);
  private readonly dynamicShadow=new VisibilityPass(DYNAMIC_SHADOW);
  private readonly passes=[this.cameraOpaque,this.cameraTransparent,this.reflection,this.staticShadow,this.dynamicShadow];
  prepare(scene:Scene,entities:readonly RuntimeEntity[],movers:ReadonlySet<string>,batches:ReadonlySet<string>,modelFor:(entity:RuntimeEntity)=>Mat4,changes?:readonly RenderObjectIR[]):void{
    if(this.scene!==scene){this.clear();this.scene=scene;}
    let membershipDirty=this.moverIds!==movers?ALL^STATIC_SHADOW:0,staticDirty=0,index=0,orderChanged=false;
    const observation=++this.observation,nextEntries=this.nextEntries;
    this.moverIds=movers;
    for(const entity of entities){
      const primitive=renderPrimitive(entity);if(!primitive)continue;
      const existing=this.entriesByEntity.get(entity),model=changes!==undefined&&existing?existing.model:modelFor(entity),mover=movers.has(entity.id),opaque=entity.material.color[3]>=.98,batched=batches.has(entity.id);
      const kind=entity.material.kind,emission=entity.material.emissive;
      const texture=entity.material.texture,heightUrl=texture?.heightUrl,reliefDepth=heightUrl?texture?.heightScaleM??0:0,reliefSize=heightUrl?texture?.sizeM??1:1;
      const castsShadow=castsRenderShadow(entity);
      const deformed=!!scene.surfaces.field?.(entity.id)?.deformation.hasStampedDeformation;
      // Stamped surface geometry keeps evolving without a model/mesh revision.
      // Move it out of the resident static map once; subsequent stamps and
      // relaxation then reach the dynamic map without redrawing other statics.
      const staticCaster=!mover&&!deformed&&(!entity.body||(!entity.body.kinematic&&entity.body.invMass===0));
      const roles=primitive.kind==='triangle-stream'&&primitive.triangleCount===0?0:(batched||entity.renderCameraVisible===false?0:opaque?CAMERA_OPAQUE:CAMERA_TRANSPARENT)|(!batched&&opaque&&kind!=='snow'&&kind!=='asphalt'?REFLECTION:0)|(castsShadow?(staticCaster?STATIC_SHADOW:DYNAMIC_SHADOW):0);
      let entry=existing;
      if(!entry){
        entry={entity,primitive,model,roles,mover,deformed,heightUrl,reliefDepth,reliefSize,observation,geometryRevision:triangleStreamRevision(primitive)};membershipDirty|=roles;
        this.entriesByEntity.set(entity,entry);
      }else{
        membershipDirty|=entry.roles^roles;
        if(entry.mover!==mover)membershipDirty|=(entry.roles|roles)&(CAMERA_OPAQUE|CAMERA_TRANSPARENT|REFLECTION);
        if(entry.model!==model||entry.primitive!==primitive||entry.deformed!==deformed)staticDirty|=staticRoles(entry.roles,entry.mover)|staticRoles(roles,mover);
        const geometryRevision=triangleStreamRevision(primitive);if(entry.geometryRevision!==geometryRevision){staticDirty|=staticRoles(entry.roles,entry.mover)|staticRoles(roles,mover);entry.geometryRevision=geometryRevision;}
        if(entry.heightUrl!==heightUrl||entry.reliefDepth!==reliefDepth||entry.reliefSize!==reliefSize)staticDirty|=(entry.roles|roles)&STATIC_SHADOW;
        entry.primitive=primitive;entry.model=model;entry.roles=roles;entry.mover=mover;entry.deformed=deformed;
        entry.heightUrl=heightUrl;entry.reliefDepth=reliefDepth;entry.reliefSize=reliefSize;
      }
      const previous=this.entries[index];
      if(previous!==entry){orderChanged=true;membershipDirty|=(previous?.roles??0)|roles;}
      entry.observation=observation;nextEntries[index++]=entry;
    }
    if(index!==this.entries.length)orderChanged=true;
    if(orderChanged)for(const entry of this.entries)if(entry.observation!==observation){
      membershipDirty|=entry.roles;this.entriesByEntity.delete(entry.entity);
    }
    nextEntries.length=index;this.nextEntries=this.entries;this.entries=nextEntries;this.nextEntries.length=0;
    if(changes)for(const {entity,model} of changes){const entry=this.entriesByEntity.get(entity);if(entry&&entry.model!==model){staticDirty|=staticRoles(entry.roles,entry.mover);entry.model=model;}}
    if(membershipDirty){
      const order=new Map([...movers].map((id,index)=>[id,index]));
      for(const pass of this.passes)if(pass.role&membershipDirty)pass.configure(this.entries,order);
      this.sourceBuilds++;
    }
    for(const pass of this.passes)if(pass.role&staticDirty)pass.invalidateStatics();
  }
  project(views:{camera:Mat4;reflection:Mat4|null;light:Mat4|null},position:Vec3,boundsFor:BoundsFor){
    const distance=(entity:RuntimeEntity)=>(entity.position[0]-position[0])**2+(entity.position[1]-position[1])**2+(entity.position[2]-position[2])**2;
    const cameraOpaque=this.cameraOpaque.project(views.camera,boundsFor).slice().sort((a,b)=>distance(a)-distance(b));
    const cameraTransparent=this.cameraTransparent.project(views.camera,boundsFor).slice().sort((a,b)=>distance(b)-distance(a));
    if(!views.reflection)this.reflection.skip();
    if(!views.light){this.staticShadow.skip();this.dynamicShadow.skip();}
    const reflectedObjects=views.reflection?this.reflection.project(views.reflection,boundsFor):[];
    const staticShadowDrawables=views.light?this.staticShadow.project(views.light,boundsFor):[],dynamicShadowDrawables=views.light?this.dynamicShadow.project(views.light,boundsFor):[];
    return{cameraOpaque,cameraTransparent,reflectedObjects,staticShadowDrawables,dynamicShadowDrawables,shadowRevision:this.staticShadow.revision};
  }
  inspect():VisibilityPlanSnapshot{return{entries:this.entries.length,sourceBuilds:this.sourceBuilds,passes:{cameraOpaque:this.cameraOpaque.inspect(),cameraTransparent:this.cameraTransparent.inspect(),reflection:this.reflection.inspect(),staticShadow:this.staticShadow.inspect(),dynamicShadow:this.dynamicShadow.inspect()}};}
  clear():void{this.scene=null;this.entries=[];this.nextEntries=[];this.entriesByEntity=new WeakMap();this.observation=0;this.moverIds=null;for(const pass of this.passes)pass.clear();}
}
