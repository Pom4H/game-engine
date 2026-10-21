import type {Mat4,Vec3} from '../math.js';
import {V3} from '../math.js';
import type {Primitive} from '../scene/types.js';
import type {RuntimeEntity,Scene} from '../scene/scene.js';
import type {RenderFrameObserver} from './frame.js';

export interface RadianceProxy {
  readonly direction:Vec3;
  readonly color:readonly [number,number,number];
  readonly threshold:number;
  readonly strength:number;
}

export interface SceneRadianceProbe {
  readonly origin:Vec3;
  readonly background:readonly [number,number,number];
  readonly ground:readonly [number,number,number];
  readonly proxies:readonly RadianceProxy[];
}

/** Distant fallback lighting follows static radiance causes. Transient actors
 * and snowballs are already represented by the main/reflection/probe passes. */
const radianceGeometryIds=new WeakMap<object,number>();let nextRadianceGeometryId=1;
interface RadianceCause {entity:RuntimeEntity;primitive:Primitive;values:Float64Array;emissive:boolean;model?:Mat4|undefined}
interface RadianceCauses {entries:RadianceCause[];hash:number;rebuilds:number;dirty:boolean}
const radianceCauses=new WeakMap<Scene,RadianceCauses>();
/** Compare numeric causes in place. Serializing and hashing thousands of static
 * entities is only necessary when a cause changes, including direct pose edits. */
function updateRadianceCause(entry:RadianceCause,model?:Mat4):boolean{
  const entity=entry.entity,material=entity.material,values=entry.values;let changed=false;
  // A reused immutable model certifies all nine full-precision pose inputs were
  // unchanged in RenderFrameCache. Pure callers invalidate that observation.
  if(!model||entry.model!==model){
    const p=entity.position,r=entity.rotation,s=entity.scale;
    if(values[0]!==p[0]||values[1]!==p[1]||values[2]!==p[2]||values[3]!==r[0]||values[4]!==r[1]||values[5]!==r[2]||values[6]!==s[0]||values[7]!==s[1]||values[8]!==s[2]){values.set(p,0);values.set(r,3);values.set(s,6);changed=true;}
  }
  entry.model=model;
  const color=material.color,emission=material.emissive;
  if(values[9]!==color[0]||values[10]!==color[1]||values[11]!==color[2]||values[12]!==color[3]){values.set(color,9);changed=true;}
  const ex=emission?.[0]??0,ey=emission?.[1]??0,ez=emission?.[2]??0;
  if(values[13]!==ex||values[14]!==ey||values[15]!==ez){values[13]=ex;values[14]=ey;values[15]=ez;changed=true;}
  const metal=material.metalness??material.profile.optical.metalness,rough=material.roughness??material.surface.roughness,wet=material.surface.wetness;
  if(values[16]!==metal||values[17]!==rough||values[18]!==wet){values[16]=metal;values[17]=rough;values[18]=wet;changed=true;}
  const emissive=!!material.emissive;if(entry.emissive!==emissive){entry.emissive=emissive;changed=true;}
  return changed;
}
function causesFor(scene:Scene):RadianceCauses{
  let cache=radianceCauses.get(scene);if(!cache){cache={entries:[],hash:2166136261,rebuilds:0,dirty:true};radianceCauses.set(scene,cache);}return cache;
}
function observeCause(cache:RadianceCauses,index:number,entity:RuntimeEntity,model?:Mat4):boolean{
  const primitive=entity.renderMesh??entity.mesh!;let entry=cache.entries[index],changed=false;
  if(!entry||entry.entity!==entity||entry.primitive!==primitive){entry={entity,primitive,values:new Float64Array(19),emissive:false};cache.entries[index]=entry;changed=true;}
  return updateRadianceCause(entry,model)||changed;
}
export function distantRadianceCacheStats(scene:Scene):{entries:number;rebuilds:number}{const cache=radianceCauses.get(scene);return{entries:cache?.entries.length??0,rebuilds:cache?.rebuilds??0};}
export function distantRadianceKey(scene:Scene):number{
  const moving=scene.renderMoverIds(),cache=causesFor(scene);let changed=cache.dirty,index=0;
  cache.dirty=true;
  for(const entity of scene.entities.values()){
    if(entity.renderVisible===false)continue;
    if(moving.has(entity.id)||!entity.mesh||entity.material.color[3]<.98||entity.material.decal)continue;
    if(observeCause(cache,index++,entity))changed=true;
  }
  return commitCauses(cache,index,changed);
}
function commitCauses(cache:RadianceCauses,index:number,changed:boolean):number{
  if(index!==cache.entries.length){cache.entries.length=index;changed=true;}
  if(!changed){cache.dirty=false;return cache.hash;}
  let hash=2166136261;
  for(const {entity,primitive} of cache.entries){
    let geometry=radianceGeometryIds.get(primitive);if(!geometry){geometry=nextRadianceGeometryId++;radianceGeometryIds.set(primitive,geometry);}
    const material=entity.material;
    const cause=[entity.id,geometry,...entity.position,...entity.rotation,...entity.scale,...material.color,...material.emissive??[],material.metalness??material.profile.optical.metalness,material.roughness??material.surface.roughness,material.surface.wetness].join(':');
    for(let n=0;n<cause.length;n++)hash=Math.imul(hash^cause.charCodeAt(n),16777619);
  }
  cache.rebuilds++;cache.dirty=false;return cache.hash=hash>>>0;
}

/** Renderer-owned dataflow consumer. Material numbers remain observable every
 * frame; pose checks reuse only freshly certified live projection identities.
 * The hash/probe still consumes authoritative Scene values, never GPU matrices. */
export interface RadianceProjectionSnapshot {fusedFrames:number;observations:number;reusedPoses:number;checkedPoses:number;fallbackFrames:number}
export class RenderRadianceProjection implements RenderFrameObserver {
  private scene:Scene|null=null;private cache:RadianceCauses|null=null;private moving:ReadonlySet<string>|null=null;
  private index=0;private changed=false;private ready=false;private key=2166136261;
  private fusedFrames=0;private observations=0;private reusedPoses=0;private checkedPoses=0;private fallbackFrames=0;
  begin(scene:Scene,observed:boolean):void{
    this.scene=scene;this.ready=false;this.index=0;this.cache=observed?causesFor(scene):null;this.moving=observed?scene.renderMoverIds():null;
    this.changed=this.cache?.dirty??false;if(this.cache)this.cache.dirty=true;
  }
  observe(entity:RuntimeEntity,model:Mat4):void{
    const cache=this.cache;if(!cache||this.moving!.has(entity.id)||!entity.mesh||entity.material.color[3]<.98||entity.material.decal)return;
    const old=cache.entries[this.index];if(old?.entity===entity&&old.model===model)this.reusedPoses++;else this.checkedPoses++;
    if(observeCause(cache,this.index++,entity,model))this.changed=true;this.observations++;
  }
  end():void{
    if(!this.scene)throw new Error('Radiance projection has no active Scene');
    if(this.cache){this.key=commitCauses(this.cache,this.index,this.changed);this.fusedFrames++;}
    else{this.key=distantRadianceKey(this.scene);this.fallbackFrames++;}
    this.ready=true;
  }
  abort():void{if(this.cache)this.cache.dirty=true;this.ready=false;}
  /** Consume one completed projection in the synchronous render transaction.
   * Standalone/repeated reads check Scene again; shared-cache updates invalidate
   * a pending observation rather than returning an older committed hash. */
  value(scene:Scene):number{
    const cache=this.cache??radianceCauses.get(scene),fresh=this.ready&&this.scene===scene&&!!cache&&!cache.dirty&&cache.hash===this.key;this.ready=false;
    return fresh?this.key:distantRadianceKey(scene);
  }
  inspect():RadianceProjectionSnapshot{return{fusedFrames:this.fusedFrames,observations:this.observations,reusedPoses:this.reusedPoses,checkedPoses:this.checkedPoses,fallbackFrames:this.fallbackFrames};}
  clear():void{if(this.cache)for(const entry of this.cache.entries)entry.model=undefined;this.scene=null;this.cache=null;this.moving=null;this.ready=false;}
}

/**
 * Compact world-radiance representation used by the real-time renderer.
 *
 * This deliberately consumes the authoritative Scene state: geometry determines
 * angular coverage, PhysicalMaterial optical/surface state determines reflected
 * radiance, and authored emission is the only extra energy source. It contains
 * no renderer-only knowledge such as "brick", "window", "car" or "snow".
 *
 * The current implementation is one camera-local probe. Keeping the contract
 * world-space lets it become a clipmapped/probe-grid cache without changing
 * material shading or reflection semantics.
 */
export function buildSceneRadianceProbe(scene:Scene,origin:Vec3=scene.camera.target,maxProxies=128,staticOnly=false):SceneRadianceProbe{
  const candidates:{proxy:RadianceProxy;score:number;ground:boolean}[]=[];
  const background:[number,number,number]=[0,0,0],ground:[number,number,number]=[0,0,0];let backgroundWeight=0,groundWeight=0;

  const moving=staticOnly?scene.renderMoverIds():undefined;
  for(const entity of scene.entities.values()){
    if(entity.renderVisible===false)continue;
    if(moving?.has(entity.id))continue;
    if(entity.material.color[3]<.98||entity.material.decal)continue;
    const primitive=entity.renderMesh??entity.mesh;if(!primitive)continue;
    const radius=primitiveRadius(primitive,entity.scale);
    if(radius<.08)continue;

    const delta=V3.sub(entity.position,origin),distance=V3.length(delta);
    if(distance<Math.max(.15,radius*.15)||distance>120)continue;

    const optical=entity.material.profile.optical;
    const surface=entity.material.surface;
    const base=entity.material.color;
    const emission=entity.material.emissive??[0,0,0];
    const metal=Math.max(0,Math.min(1,entity.material.metalness??optical.metalness));
    const wet=Math.max(0,Math.min(1,surface.wetness));
    const rough=Math.max(.02,Math.min(1,entity.material.roughness??surface.roughness));
    const incident=.22+.78*Math.max(0,Math.min(1,scene.environment.sunlight));
    const diffuseWeight=(1-metal)*(.72+.18*wet);
    const specularWeight=(.04*(1-metal)+metal)*(.35+.65*(1-rough));
    const response=incident*(.34+.66*(diffuseWeight+specularWeight));
    const color:readonly[number,number,number]=[
      base[0]*response+emission[0],
      base[1]*response+emission[1],
      base[2]*response+emission[2],
    ];

    const angularRadius=Math.min(.82,Math.atan2(radius,distance)+.012);
    const threshold=Math.cos(angularRadius);
    const projectedArea=Math.max(.0001,(radius*radius)/(distance*distance));
    const strength=Math.min(3.5,projectedArea*95*(.55+.45*(1-rough))+.02*Math.max(...emission));
    const direction=V3.scale(delta,1/distance);
    const proxy={direction,color,threshold,strength} satisfies RadianceProxy;
    const isGround=!!entity.environmental?.surfaceUse||Math.abs(direction[1])>.72&&direction[1]<0;
    candidates.push({proxy,score:strength*(1+.35*projectedArea),ground:isGround});

    if(radius>1.2){
      const weight=Math.min(12,radius*radius/(1+distance*.04));
      if(isGround){
        ground[0]+=color[0]*weight;ground[1]+=color[1]*weight;ground[2]+=color[2]*weight;groundWeight+=weight;
      }else{
        background[0]+=color[0]*weight;background[1]+=color[1]*weight;background[2]+=color[2]*weight;backgroundWeight+=weight;
      }
    }
  }

  candidates.sort((a,b)=>b.score-a.score);
  const proxies=Object.freeze(candidates.slice(0,maxProxies).map(candidate=>Object.freeze(candidate.proxy)));
  const sky=scene.spec.rendering?.skyColor??[.26,.34,.47];
  const backgroundColor:readonly[number,number,number]=backgroundWeight
    ?[background[0]!/backgroundWeight,background[1]!/backgroundWeight,background[2]!/backgroundWeight]
    :[sky[0]*.55,sky[1]*.58,sky[2]*.62];
  const groundColor:readonly[number,number,number]=groundWeight
    ?[ground[0]!/groundWeight,ground[1]!/groundWeight,ground[2]!/groundWeight]
    :[sky[0]*.09,sky[1]*.085,sky[2]*.08];

  return Object.freeze({origin:[...origin] as Vec3,background:backgroundColor,ground:groundColor,proxies});
}

// City mesh positions are owned frozen arrays. Reusing their full-precision
// extrema avoids walking millions of unchanged vertices for each probe origin.
// Weak ownership follows geometry residency; mutable authoring arrays still
// take the original scan so direct edits remain observable.
const radianceMeshBounds=new WeakMap<readonly number[],readonly number[]>();
function primitiveRadius(primitive:Primitive,scale:Vec3):number{
  const sx=Math.abs(scale[0]),sy=Math.abs(scale[1]),sz=Math.abs(scale[2]);
  if(primitive.kind==='sphere')return (primitive.radius??1)*Math.max(sx,sy,sz);
  if(primitive.kind==='torus')return (primitive.radius+primitive.tube)*Math.max(sx,sy,sz);
  if(primitive.kind==='cylinder')return Math.hypot(primitive.radius*Math.max(sx,sz),primitive.height*.5*sy);
  if(primitive.kind==='box'||primitive.kind==='shard'||primitive.kind==='snowdrift'){
    const s=primitive.size??[1,1,1];return .5*Math.hypot(s[0]*sx,s[1]*sy,s[2]*sz);
  }
  if(primitive.kind==='plane'){const s=primitive.size??[1,1];return .5*Math.hypot(s[0]*sx,s[1]*sz);}
  if(primitive.kind==='polygon-prism'){
    let r2=0;for(const p of primitive.points)r2=Math.max(r2,p[0]*p[0]+p[1]*p[1]);
    return Math.hypot(Math.sqrt(r2)*Math.max(sx,sy,sz),primitive.thickness*.5*Math.max(sx,sy,sz));
  }
  const positions=primitive.positions,cachedBounds=radianceMeshBounds.get(positions);
  // Once an array was verified frozen it stays frozen. In some JS runtimes
  // Object.isFrozen walks every indexed property, even on a cache hit.
  if(Number.isFinite(sx)&&Number.isFinite(sy)&&Number.isFinite(sz)&&(cachedBounds||Object.isFrozen(positions))){
    let bounds=cachedBounds;
    if(!bounds){
      let minX=Infinity,minY=Infinity,minZ=Infinity,maxX=-Infinity,maxY=-Infinity,maxZ=-Infinity;
      for(let i=0;i<positions.length;i+=3){
        minX=Math.min(minX,positions[i]!);minY=Math.min(minY,positions[i+1]!);minZ=Math.min(minZ,positions[i+2]!);
        maxX=Math.max(maxX,positions[i]!);maxY=Math.max(maxY,positions[i+1]!);maxZ=Math.max(maxZ,positions[i+2]!);
      }
      bounds=[minX,minY,minZ,maxX,maxY,maxZ];radianceMeshBounds.set(positions,bounds);
    }
    // Multiply the extrema before subtraction, just as the vertex scan does.
    // Scaling a precomputed extent would round differently at large offsets.
    const minX=bounds[0]!*sx;
    return Number.isFinite(minX)?.5*Math.hypot(bounds[3]!*sx-minX,bounds[4]!*sy-bounds[1]!*sy,bounds[5]!*sz-bounds[2]!*sz):.5*Math.max(sx,sy,sz);
  }
  let minX=Infinity,minY=Infinity,minZ=Infinity,maxX=-Infinity,maxY=-Infinity,maxZ=-Infinity;
  for(let i=0;i<primitive.positions.length;i+=3){
    const x=primitive.positions[i]!*sx,y=primitive.positions[i+1]!*sy,z=primitive.positions[i+2]!*sz;
    minX=Math.min(minX,x);minY=Math.min(minY,y);minZ=Math.min(minZ,z);
    maxX=Math.max(maxX,x);maxY=Math.max(maxY,y);maxZ=Math.max(maxZ,z);
  }
  return Number.isFinite(minX)?.5*Math.hypot(maxX-minX,maxY-minY,maxZ-minZ):.5*Math.max(sx,sy,sz);
}
