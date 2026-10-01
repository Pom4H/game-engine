import type {Vec3,MutableVec3} from '../math.js';
import type {RigidBody} from './world.js';
import {ForceFrame} from './force-frame.js';
export interface WheelHit {id:string;distance:number;point:MutableVec3;normal:MutableVec3;velocity:MutableVec3;body:RigidBody|null;triangle:number;u:number;v:number;}
export const wheelHit=():WheelHit=>({id:'',distance:Infinity,point:[0,0,0],normal:[0,1,0],velocity:[0,0,0],body:null,triangle:-1,u:0,v:0});
export type WheelSupport=(origin:Vec3,direction:Vec3,maxDistance:number,hit:WheelHit,exclude?:RigidBody)=>boolean;
/** Prepared basis for unchanged colliders; dynamic transforms invalidate by value, not frame. */
class BodySupport {
 private readonly items;
 constructor(bodies:Iterable<RigidBody>,readonly ground:number){
  this.items=Array.from(bodies,body=>({body,frame:new ForceFrame(),key:new Float64Array(9).fill(NaN),extent:new Float64Array(3),offset:new Float64Array(3)}));
 }
 cast:WheelSupport=(o,d,max,hit,exclude)=>{
  if(!Number.isFinite(max)||max<0||!o.every(Number.isFinite)||!d.every(Number.isFinite)||Math.abs(Math.hypot(...d)-1)>1e-6)throw new RangeError('Ray requires finite origin and unit direction');
  hit.id='';hit.distance=max;hit.body=null;hit.triangle=-1;hit.velocity.fill(0);let found=false;
  if(Number.isFinite(this.ground)&&d[1]<-1e-9){const t=(this.ground-o[1])/d[1];if(t>=0&&t<=max){hit.distance=t;hit.normal.splice(0,3,0,1,0);hit.id='ground';found=true;}}
  for(const c of this.items){
   const b=c.body;
   if(b===exclude)continue;
   const dx=o[0]-b.position[0],dy=o[1]-b.position[1],dz=o[2]-b.position[2];
   let t=Infinity,nx=0,ny=0,nz=0;
   if(b.shape.kind==='sphere'){
    const radius=b.shape.radius;if(Math.max(Math.abs(dx),Math.abs(dy),Math.abs(dz))>radius+hit.distance)continue;
    const projection=dx*d[0]+dy*d[1]+dz*d[2],delta=projection*projection-(dx*dx+dy*dy+dz*dz-radius*radius);
    if(delta<0)continue;t=-projection-Math.sqrt(delta);if(t<0)continue;
    nx=(dx+d[0]*t)/radius;ny=(dy+d[1]*t)/radius;nz=(dz+d[2]*t)/radius;
   }else{
    const basis=c.frame.basis,half=b.collisionHalf??b.shape.half,offset=b.collisionOffsetLocal,key=c.key;
    let rotated=false,changed=false;
    for(let k=0;k<3;k++){
     if(key[k]!==b.rotation[k]){key[k]=b.rotation[k]!;rotated=true;}
     if(key[3+k]!==half[k]||key[6+k]!==offset[k]){key[3+k]=half[k]!;key[6+k]=offset[k]!;changed=true;}
    }
    if(rotated)c.frame.update(b.rotation);
    if(rotated||changed)for(let k=0;k<3;k++){
     c.extent[k]=Math.abs(basis[k]!)*half[0]+Math.abs(basis[3+k]!)*half[1]+Math.abs(basis[6+k]!)*half[2];
     c.offset[k]=basis[k]!*offset[0]+basis[3+k]!*offset[1]+basis[6+k]!*offset[2];
    }
    // Prepared exact AABB matters for long, thin wall/ramp slabs; a sphere covers almost the field.
    if(Math.abs(dx-c.offset[0]!)>c.extent[0]!+hit.distance||Math.abs(dy-c.offset[1]!)>c.extent[1]!+hit.distance||Math.abs(dz-c.offset[2]!)>c.extent[2]!+hit.distance)continue;
    let near=0,far=hit.distance,axis=-1,sign=0,miss=false;
    for(let a=0;a<3;a++){
     const i=a*3,p=dx*basis[i]!+dy*basis[i+1]!+dz*basis[i+2]!-b.collisionOffsetLocal[a]!,v=d[0]*basis[i]!+d[1]*basis[i+1]!+d[2]*basis[i+2]!;
     if(Math.abs(v)<1e-10){if(Math.abs(p)>half[a]!){miss=true;break;}continue;}
     let lo=(-half[a]!-p)/v,hi=(half[a]!-p)/v,s=-1;if(lo>hi){[lo,hi]=[hi,lo];s=1;}
     if(lo>=near){near=lo;axis=a;sign=s;}far=Math.min(far,hi);if(near>far){miss=true;break;}
    }
    if(miss||axis<0)continue;t=near;nx=basis[axis*3]!*sign;ny=basis[axis*3+1]!*sign;nz=basis[axis*3+2]!*sign;
   }
   if(t<0||t>hit.distance)continue;found=true;hit.distance=t;hit.normal.splice(0,3,nx,ny,nz);hit.body=b;hit.id=b.id;
  }
  if(found){for(let k=0;k<3;k++)hit.point[k]=o[k]!+d[k]!*hit.distance;
   const b=hit.body;if(b){const x=hit.point[0]-b.position[0],y=hit.point[1]-b.position[1],z=hit.point[2]-b.position[2],w=b.angularVelocity;
    hit.velocity.splice(0,3,b.velocity[0]+w[1]*z-w[2]*y,b.velocity[1]+w[2]*x-w[0]*z,b.velocity[2]+w[0]*y-w[1]*x);
   }
  }return found;
 };
}
/** Ray against the actual deformed triangles. No rigid bounding-sphere contact proxy. */
export function rayTriangles(o:Vec3,d:Vec3,max:number,positions:ArrayLike<number>,indices:ArrayLike<number>,hit:WheelHit,velocity?:ArrayLike<number>):boolean {
 // Conservative broad phase reads the current nodes, including direct editor/solver changes.
 let lx=Infinity,ly=Infinity,lz=Infinity,hx=-Infinity,hy=-Infinity,hz=-Infinity;
 for(let i=0;i<positions.length;i+=3){const x=positions[i]!,y=positions[i+1]!,z=positions[i+2]!;lx=Math.min(lx,x);ly=Math.min(ly,y);lz=Math.min(lz,z);hx=Math.max(hx,x);hy=Math.max(hy,y);hz=Math.max(hz,z);}
 if(o[0]+max<lx||o[0]-max>hx||o[1]+max<ly||o[1]-max>hy||o[2]+max<lz||o[2]-max>hz)return false;
 let found=false;
 for(let i=0;i<indices.length;i+=3){
  const a=indices[i]!*3,b=indices[i+1]!*3,c=indices[i+2]!*3;
  const ax=positions[a]!,ay=positions[a+1]!,az=positions[a+2]!,ex=positions[b]!-ax,ey=positions[b+1]!-ay,ez=positions[b+2]!-az,fx=positions[c]!-ax,fy=positions[c+1]!-ay,fz=positions[c+2]!-az;
  const px=d[1]*fz-d[2]*fy,py=d[2]*fx-d[0]*fz,pz=d[0]*fy-d[1]*fx,det=ex*px+ey*py+ez*pz;if(det<=1e-10)continue;
  const tx=o[0]-ax,ty=o[1]-ay,tz=o[2]-az,u=(tx*px+ty*py+tz*pz)/det;if(u<0||u>1)continue;
  const qx=ty*ez-tz*ey,qy=tz*ex-tx*ez,qz=tx*ey-ty*ex,v=(d[0]*qx+d[1]*qy+d[2]*qz)/det;if(v<0||u+v>1)continue;
  const t=(fx*qx+fy*qy+fz*qz)/det;if(t<0||t>max)continue;
  const nx=ey*fz-ez*fy,ny=ez*fx-ex*fz,nz=ex*fy-ey*fx,l=Math.hypot(nx,ny,nz);if(l<1e-9)continue;
  max=t;found=true;hit.distance=t;hit.normal.splice(0,3,nx/l,ny/l,nz/l);hit.body=null;hit.id='';hit.triangle=i/3;hit.u=u;hit.v=v;
  for(let k=0;k<3;k++){hit.point[k]=o[k]!+d[k]!*t;hit.velocity[k]=velocity?(1-u-v)*velocity[a+k]!+u*velocity[b+k]!+v*velocity[c+k]!:0;}
 }return found;
}

/** Prepare the installed roster once; body poses/shapes remain live. Rebuild on roster changes. */
export const bodyWheelSupport=(bodies:Iterable<RigidBody>,ground:number):WheelSupport=>new BodySupport(bodies,ground).cast;
export const groundSupport=(ground:number):WheelSupport=>bodyWheelSupport([],ground);
