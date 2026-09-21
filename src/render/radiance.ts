import type {Vec3} from '../math.js';
import {V3} from '../math.js';
import type {Primitive} from '../scene/types.js';
import type {RuntimeEntity,Scene} from '../scene/scene.js';

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
const triangleMeshExtents=new WeakMap<object,readonly [number,number,number]>();

export function buildSceneRadianceProbe(scene:Scene,origin:Vec3=scene.camera.target,maxProxies=128):SceneRadianceProbe{
  const candidates:{proxy:RadianceProxy;score:number;ground:boolean}[]=[];
  const background:[number,number,number]=[0,0,0],ground:[number,number,number]=[0,0,0];let backgroundWeight=0,groundWeight=0;

  for(const entity of scene.entities.values()){
    if(entity.material.color[3]<.98)continue;
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
  // Triangle meshes are immutable render assets in Scene. Their local extents are
  // a property of the mesh, not of the frame, so never rescan every vertex while
  // rebuilding the radiance projection. Non-uniform entity scale is still applied
  // exactly here, preserving the same authoritative geometry result.
  let extents=triangleMeshExtents.get(primitive as object);
  if(!extents){
    let minX=Infinity,minY=Infinity,minZ=Infinity,maxX=-Infinity,maxY=-Infinity,maxZ=-Infinity;
    for(let i=0;i<primitive.positions.length;i+=3){
      const x=primitive.positions[i]!,y=primitive.positions[i+1]!,z=primitive.positions[i+2]!;
      minX=Math.min(minX,x);minY=Math.min(minY,y);minZ=Math.min(minZ,z);
      maxX=Math.max(maxX,x);maxY=Math.max(maxY,y);maxZ=Math.max(maxZ,z);
    }
    extents=Number.isFinite(minX)?[maxX-minX,maxY-minY,maxZ-minZ] as const:[1,1,1] as const;
    triangleMeshExtents.set(primitive as object,extents);
  }
  return .5*Math.hypot(extents[0]*sx,extents[1]*sy,extents[2]*sz);
}
