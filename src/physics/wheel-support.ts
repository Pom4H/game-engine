import type {MutableVec3,Vec3} from '../math.js';
import type {RigidBody} from './world.js';
import {ForceFrame} from './force-frame.js';
export interface WheelHit {distance:number;normal:MutableVec3;point:MutableVec3;id:string;}
/** Unit ray from the suspension mount toward the wheel. Caller owns the output buffer. */
export type WheelSupport=(origin:Vec3,direction:Vec3,maxDistance:number,out:WheelHit)=>boolean;
export function groundSupport(height:number):WheelSupport{return(o,d,max,out)=>{
 const t=(height-o[1])/d[1];if(d[1]>=-1e-8||t<0||t>max)return false;
 out.distance=t;out.normal.splice(0,3,0,1,0);out.point.splice(0,3,o[0]+d[0]*t,height,o[2]+d[2]*t);out.id='ground';return true;
};}
/** Prepared static OBBs share the actual rigid collision geometry. Rebuild when static geometry changes.
 * No meshes/normal tables are guessed from a car's height or an arena wall name. */
export function staticWheelSupport(bodies:Iterable<RigidBody>,ground:number):WheelSupport {
 const items=[...bodies].filter(b=>!b.invMass&&!b.kinematic&&b.shape.kind==='box').map(body=>{const f=new ForceFrame();f.update(body.rotation);const half=body.shape.kind==='box'?body.shape.half:[0,0,0];return{body,b:f.basis,half,radius:Math.hypot(...half)};});
 const plane=groundSupport(ground),local=new Float64Array(3),ray=new Float64Array(3);
 return (o,d,max,out)=>{
  let found=plane(o,d,max,out),nearest=found?out.distance:max;
  for(const {body,b,half,radius} of items){
   const x=o[0]-body.position[0],y=o[1]-body.position[1],z=o[2]-body.position[2];
   if(Math.abs(x)>radius+max||Math.abs(y)>radius+max||Math.abs(z)>radius+max)continue;
   for(let k=0;k<3;k++){local[k]=x*b[k*3]!+y*b[k*3+1]!+z*b[k*3+2]!;ray[k]=d[0]*b[k*3]!+d[1]*b[k*3+1]!+d[2]*b[k*3+2]!;}
   let enter=0,exit=nearest,axis=-1,sign=0;
   for(let k=0;k<3;k++){
    const p=local[k]!,v=ray[k]!,h=half[k]!;
    if(Math.abs(v)<1e-9){if(Math.abs(p)>h){exit=-1;break;}continue;}
    let a=(-h-p)/v,c=(h-p)/v,n=-1;if(a>c){[a,c]=[c,a];n=1;}
    if(a>enter){enter=a;axis=k;sign=n;}exit=Math.min(exit,c);if(enter>exit)break;
   }
   if(axis<0||enter>exit||enter<0||enter>nearest)continue;
   nearest=enter;found=true;out.distance=enter;out.id=body.id;
   for(let k=0;k<3;k++){out.normal[k]=b[axis*3+k]!*sign;out.point[k]=o[k]!+d[k]!*enter;}
  }
  return found;
 };
}
