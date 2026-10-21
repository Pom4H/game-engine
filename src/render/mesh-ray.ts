import {V3,type Vec3,type MutableVec3} from '../math.js';
import {primitiveMesh,type MeshData} from '../procedural/mesh.js';
import {triangleStreamRevision} from '../procedural/triangle-stream.js';
import type {Scene,RuntimeEntity} from '../scene/scene.js';
import type {CameraSpec,Primitive} from '../scene/types.js';
import {renderModel,renderPrimitive} from './frame.js';

export interface RenderMeshHit {readonly entity:RuntimeEntity;readonly distance:number;readonly point:Vec3;readonly triangle:number;}
export type RenderMeshFilter=(entity:RuntimeEntity)=>boolean;
type Geometry={mesh:MeshData;bounds:Float64Array;revision:number};
type Prepared={primitive:Primitive;geometry:Geometry;pose:Float64Array;model:Float32Array;origin:Float64Array;inverse:Float64Array;bounds:Float64Array;valid:boolean};

function edgeDistance2(p:Vec3,a:Vec3,b:Vec3):number{
 const x=b[0]-a[0],y=b[1]-a[1],z=b[2]-a[2],px=p[0]-a[0],py=p[1]-a[1],pz=p[2]-a[2],length=x*x+y*y+z*z,t=length?Math.max(0,Math.min(1,(px*x+py*y+pz*z)/length)):0;
 return (px-t*x)**2+(py-t*y)**2+(pz-t*z)**2;
}
function triangleDistance2(p:Vec3,a:Vec3,b:Vec3,c:Vec3):number{
 const x=b[0]-a[0],y=b[1]-a[1],z=b[2]-a[2],u=c[0]-a[0],v=c[1]-a[1],w=c[2]-a[2],px=p[0]-a[0],py=p[1]-a[1],pz=p[2]-a[2];
 const xx=x*x+y*y+z*z,xu=x*u+y*v+z*w,uu=u*u+v*v+w*w,xp=x*px+y*py+z*pz,up=u*px+v*py+w*pz,denominator=xx*uu-xu*xu;
 if(denominator>0){const s=(uu*xp-xu*up)/denominator,t=(xx*up-xu*xp)/denominator;if(s>=0&&t>=0&&s+t<=1){const nx=y*w-z*v,ny=z*u-x*w,nz=x*v-y*u,nn=nx*nx+ny*ny+nz*nz;if(nn>0)return (px*nx+py*ny+pz*nz)**2/nn;}}
 return Math.min(edgeDistance2(p,a,b),edgeDistance2(p,b,c),edgeDistance2(p,c,a));
}

function intersects(o:Vec3,d:Vec3,max:number,b:ArrayLike<number>):boolean{
 let near=0,far=max;
 for(let i=0;i<3;i++){
  if(Math.abs(d[i]!)<1e-12){if(o[i]!<b[i]!||o[i]!>b[i+3]!)return false;continue;}
  let a=(b[i]!-o[i]!)/d[i]!,z=(b[i+3]!-o[i]!)/d[i]!;if(a>z)[a,z]=[z,a];
  near=Math.max(near,a);far=Math.min(far,z);if(near>far)return false;
 }return true;
}

/** Queries the renderer's selected, immutable Scene meshes and exact model
 * transforms. No collision proxies, bodies, simulation steps or GPU readbacks.
 * Weak caches release removed entities/geometry with their Scene ownership. */
export class RenderMeshQuery{
 private readonly geometry=new WeakMap<Primitive,Geometry>();
 private readonly prepared=new WeakMap<RuntimeEntity,Prepared>();
 constructor(private readonly scene:Scene){}
 private prepare(entity:RuntimeEntity,primitive:Primitive):Prepared{
  let g=this.geometry.get(primitive);
  const revision=triangleStreamRevision(primitive);
  if(!g||g.revision!==revision){const mesh=primitiveMesh(primitive),bounds=new Float64Array([Infinity,Infinity,Infinity,-Infinity,-Infinity,-Infinity]);
   for(let i=0;i<mesh.vertices.length;i+=6)for(let a=0;a<3;a++){const v=mesh.vertices[i+a]!;bounds[a]=Math.min(bounds[a]!,v);bounds[a+3]=Math.max(bounds[a+3]!,v);}
   g={mesh,bounds,revision};this.geometry.set(primitive,g);
  }
  let p=this.prepared.get(entity);
  if(!p){p={primitive,geometry:g,pose:new Float64Array(9).fill(NaN),model:new Float32Array(16),origin:new Float64Array(3),inverse:new Float64Array(9),bounds:new Float64Array(6),valid:false};this.prepared.set(entity,p);}
  let changed=p.primitive!==primitive||p.geometry!==g;
  for(let i=0;i<9;i++){const value=i<3?entity.position[i]!:i<6?entity.rotation[i-3]!:entity.scale[i-6]!;if(p.pose[i]!==value){p.pose[i]=value;changed=true;}}
  if(!changed)return p;
  p.primitive=primitive;p.geometry=g;const m=renderModel(entity),inv=p.inverse;p.model.set(m);p.origin.set(m.subarray(12,15));
  const ax=m[0]!,ay=m[1]!,az=m[2]!,bx=m[4]!,by=m[5]!,bz=m[6]!,cx=m[8]!,cy=m[9]!,cz=m[10]!;
  const x=by*cz-bz*cy,y=bz*cx-bx*cz,z=bx*cy-by*cx,det=ax*x+ay*y+az*z;
  p.valid=Number.isFinite(det)&&Math.abs(det)>1e-15;if(!p.valid)return p;
  inv.set([x/det,y/det,z/det,(cy*az-cz*ay)/det,(cz*ax-cx*az)/det,(cx*ay-cy*ax)/det,(ay*bz-az*by)/det,(az*bx-ax*bz)/det,(ax*by-ay*bx)/det]);
  const b=g.bounds,lx=(b[0]!+b[3]!)/2,ly=(b[1]!+b[4]!)/2,lz=(b[2]!+b[5]!)/2,ex=(b[3]!-b[0]!)/2,ey=(b[4]!-b[1]!)/2,ez=(b[5]!-b[2]!)/2;
  for(let i=0;i<3;i++){const center=m[12+i]!+m[i]!*lx+m[4+i]!*ly+m[8+i]!*lz,extent=Math.abs(m[i]!)*ex+Math.abs(m[4+i]!)*ey+Math.abs(m[8+i]!)*ez;p.bounds[i]=center-extent;p.bounds[i+3]=center+extent;}
  return p;
 }
 /** True when a selected visible triangle is within a world-space clearance.
  * Uses the same mesh/pose cache as rays, including nonuniform render scales. */
 withinDistance(point:Vec3,distance:number,filter?:RenderMeshFilter):boolean{
  if(!Number.isFinite(distance)||distance<0||!point.every(Number.isFinite))throw new RangeError('Mesh clearance requires a finite point and nonnegative distance');
  const limit=distance*distance,a:MutableVec3=[0,0,0],b:MutableVec3=[0,0,0],c:MutableVec3=[0,0,0];
  for(const entity of this.scene.entities.values()){
   const primitive=renderPrimitive(entity);if(!primitive||entity.material.color[3]<=0||filter&&!filter(entity))continue;
   const p=this.prepare(entity,primitive);if(!p.valid)continue;let bound=0;for(let i=0;i<3;i++){const d=Math.max(p.bounds[i]!-point[i]!,0,point[i]!-p.bounds[i+3]!);bound+=d*d;}if(bound>limit)continue;
   const {vertices,indices}=p.geometry.mesh,m=p.model,vertex=(index:number,out:MutableVec3)=>{const k=index*6,x=vertices[k]!,y=vertices[k+1]!,z=vertices[k+2]!;for(let n=0;n<3;n++)out[n]=m[12+n]!+m[n]!*x+m[4+n]!*y+m[8+n]!*z;};
   for(let i=0;i<indices.length;i+=3){vertex(indices[i]!,a);vertex(indices[i+1]!,b);vertex(indices[i+2]!,c);if(triangleDistance2(point,a,b,c)<=limit)return true;}
  }return false;
 }
 cast(origin:Vec3,direction:Vec3,maxDistance:number,filter?:RenderMeshFilter):RenderMeshHit|null{
  if(!Number.isFinite(maxDistance)||maxDistance<0||!origin.every(Number.isFinite)||!direction.every(Number.isFinite)||Math.abs(V3.length(direction)-1)>1e-6)throw new RangeError('Mesh ray requires finite origin, unit direction and nonnegative distance');
  let closest=maxDistance,result:RenderMeshHit|null=null;
  for(const entity of this.scene.entities.values()){
   const primitive=renderPrimitive(entity);if(!primitive||entity.material.color[3]<=0||filter&&!filter(entity))continue;
   const p=this.prepare(entity,primitive);if(!p.valid||!intersects(origin,direction,closest,p.bounds))continue;
   const inv=p.inverse,dx=origin[0]-p.origin[0]!,dy=origin[1]-p.origin[1]!,dz=origin[2]-p.origin[2]!;
   const o:MutableVec3=[0,0,0],d:MutableVec3=[0,0,0];
   for(let i=0;i<3;i++){const a=i*3;o[i]=inv[a]!*dx+inv[a+1]!*dy+inv[a+2]!*dz;d[i]=inv[a]!*direction[0]+inv[a+1]!*direction[1]+inv[a+2]!*direction[2];}
   const {vertices:v,indices}=p.geometry.mesh;
   for(let i=0;i<indices.length;i+=3){
    const a=indices[i]!*6,b=indices[i+1]!*6,c=indices[i+2]!*6,ax=v[a]!,ay=v[a+1]!,az=v[a+2]!,ex=v[b]!-ax,ey=v[b+1]!-ay,ez=v[b+2]!-az,fx=v[c]!-ax,fy=v[c+1]!-ay,fz=v[c+2]!-az;
    const px=d[1]*fz-d[2]*fy,py=d[2]*fx-d[0]*fz,pz=d[0]*fy-d[1]*fx,det=ex*px+ey*py+ez*pz;if(Math.abs(det)<1e-12)continue;
    const tx=o[0]-ax,ty=o[1]-ay,tz=o[2]-az,u=(tx*px+ty*py+tz*pz)/det;if(u<0||u>1)continue;
    const qx=ty*ez-tz*ey,qy=tz*ex-tx*ez,qz=tx*ey-ty*ex,z=(d[0]*qx+d[1]*qy+d[2]*qz)/det;if(z<0||u+z>1)continue;
    const distance=(fx*qx+fy*qy+fz*qz)/det;if(distance<0||distance>closest)continue;
    closest=distance;result={entity,distance,point:V3.add(origin,V3.scale(direction,distance)),triangle:i/3};
   }
  }return result;
 }
}

export interface CameraObstruction {readonly camera:CameraSpec;readonly desiredDistance:number;readonly distance:number;readonly hit:RenderMeshHit|null;}
/** Five parallel rays reserve room for the near plane as well as its centre.
 * The caller supplies an anchor in free space, normally the presented body. */
export function avoidCameraObstacles(query:RenderMeshQuery,camera:CameraSpec,options:{radius?:number;padding?:number;filter?:RenderMeshFilter}={}):CameraObstruction{
 const radius=options.radius??.18,padding=options.padding??.12;
 if(!Number.isFinite(radius)||radius<0||!Number.isFinite(padding)||padding<0)throw new RangeError('Camera clearance must be finite and nonnegative');
 const delta=V3.sub(camera.position,camera.target),length=V3.length(delta);if(!Number.isFinite(length)||length<1e-8)return {camera,desiredDistance:length,distance:length,hit:null};
 const direction=V3.scale(delta,1/length),right=V3.normalize(V3.cross(direction,Math.abs(direction[1])>.99?[1,0,0]:[0,1,0])),up=V3.cross(right,direction);
 let distance=length,hit:RenderMeshHit|null=null;
 for(const [x,y]of (radius?[[0,0],[-1,-1],[-1,1],[1,-1],[1,1]]:[[0,0]])){
  const origin=V3.add(camera.target,V3.add(V3.scale(right,x!*radius),V3.scale(up,y!*radius))),found=query.cast(origin,direction,length,options.filter);
  if(found&&found.distance-padding<distance){distance=Math.max(.001,found.distance-padding);hit=found;}
 }
 return {camera:hit?{...camera,position:V3.add(camera.target,V3.scale(direction,distance))}:camera,desiredDistance:length,distance,hit};
}
