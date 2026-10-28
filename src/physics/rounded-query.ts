import type {SolidBox,SolidRayHit} from './compound.js';
import {castRoundedTrianglePrism} from './triangle-prism.js';
type V=readonly number[];
/** Exact ray / rounded OBB intersection. Between its six face crossings the
 * squared distance to the box is quadratic; no marching, mesh or extra rays. */
export function castRoundedBox(origin:V,direction:V,maxDistance:number,radius:number,box:SolidBox):SolidRayHit|null{
 if(box.triangle!==undefined){const hit=box.triangle&&castRoundedTrianglePrism(origin,direction,maxDistance,radius,box.triangle);return hit?{...hit,p:[...hit.p],n:[...hit.n],body:box.body,tag:box.tag}:null;}
 const o=[0,0,0],d=[0,0,0],cuts=[0,maxDistance];
 let lo=0,hi=maxDistance;
 for(let k=0;k<3;k++){
  const axis=box.axes[k]!;o[k]=(origin[0]!-box.p[0])*axis[0]+(origin[1]!-box.p[1])*axis[1]+(origin[2]!-box.p[2])*axis[2];d[k]=direction[0]!*axis[0]+direction[1]!*axis[1]+direction[2]!*axis[2];
  const h=box.half[k]!;
  if(Math.abs(d[k]!)<1e-12){if(Math.abs(o[k]!)>h+radius)return null;continue;}
  let a=(-h-radius-o[k]!)/d[k]!,b=(h+radius-o[k]!)/d[k]!;if(a>b)[a,b]=[b,a];lo=Math.max(lo,a);hi=Math.min(hi,b);if(lo>hi)return null;
  for(const face of [-h,h]){const t=(face-o[k]!)/d[k]!;if(t>0&&t<maxDistance)cuts.push(t);}
 }
 cuts.push(lo,hi);cuts.sort((a,b)=>a-b);
 for(let i=0;i+1<cuts.length;i++){
  const a=Math.max(lo,cuts[i]!),b=Math.min(hi,cuts[i+1]!);if(a>b||b<0)continue;
  const mid=(a+b)*.5;let A=0,B=0,C=-radius*radius;
  for(let k=0;k<3;k++){const value=o[k]!+d[k]!*mid,h=box.half[k]!;if(Math.abs(value)<=h)continue;const e=o[k]!-Math.sign(value)*h;A+=d[k]!*d[k]!;B+=2*e*d[k]!;C+=e*e;}
  let t=a;if(A*a*a+B*a+C>1e-10){const disc=B*B-4*A*C;if(A<1e-15||disc<0)continue;t=(-B-Math.sqrt(disc))/(2*A);if(t<a-1e-8||t>b+1e-8)continue;}
  const p:[number,number,number]=[...box.p],n:[number,number,number]=[0,0,0];let norm=0;
  for(let k=0;k<3;k++){const value=o[k]!+d[k]!*t,h=box.half[k]!,q=Math.max(-h,Math.min(h,value)),e=value-q,axis=box.axes[k]!;norm+=e*e;for(let j=0;j<3;j++){p[j]!+=axis[j]!*q;n[j]!+=axis[j]!*e;}}
  norm=Math.sqrt(norm);if(norm<1e-8)continue;for(let j=0;j<3;j++)n[j]!/=norm;
  return {t:Math.max(0,t),p,n,body:box.body,tag:box.tag};
 }
 return null;
}
