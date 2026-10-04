import type {Primitive} from '../scene/types.js';
import {detailedRoadWheelMeshes,type RoadWheelGeometrySpec} from './passenger-wheel.js';

type V3=readonly[number,number,number];
type Mesh=Extract<Primitive,{kind:'triangle-mesh'}>;
export interface OffroadWheelGeometrySpec extends RoadWheelGeometrySpec {
  readonly treadBlocks?:number;
  readonly treadDepthM?:number;
  /** Loaded radial deflection used by the visual projection of the physical tyre. */
  readonly deflectionM?:number;
  readonly sidewallBulge?:number;
}
class Builder{
  positions:number[]=[];normals:number[]=[];indices:number[]=[];
  tri(a:V3,b:V3,c:V3){const base=this.positions.length/3,ux=b[0]-a[0],uy=b[1]-a[1],uz=b[2]-a[2],vx=c[0]-a[0],vy=c[1]-a[1],vz=c[2]-a[2],nx=uy*vz-uz*vy,ny=uz*vx-ux*vz,nz=ux*vy-uy*vx,l=Math.hypot(nx,ny,nz)||1;for(const p of [a,b,c]){this.positions.push(...p);this.normals.push(nx/l,ny/l,nz/l);}this.indices.push(base,base+1,base+2);}
  quad(a:V3,b:V3,c:V3,d:V3){this.tri(a,b,c);this.tri(a,c,d);}
  box(center:V3,tangent:V3,radial:V3,width:number,length:number,height:number){
    const corners:V3[]=[];for(const t of [-1,1])for(const r of [-1,1])for(const z of [-1,1])corners.push([center[0]+t*tangent[0]*length/2+r*radial[0]*height/2,center[1]+t*tangent[1]*length/2+r*radial[1]*height/2,center[2]+z*width/2]);
    const q=(a:number,b:number,c:number,d:number)=>this.quad(corners[a]!,corners[b]!,corners[c]!,corners[d]!);q(0,4,6,2);q(1,3,7,5);q(0,1,5,4);q(2,6,7,3);q(0,2,3,1);q(4,5,7,6);
  }
  mesh():Mesh{return{kind:'triangle-mesh',positions:this.positions,normals:this.normals,indices:this.indices};}
}
const clamp=(v:number,a:number,b:number)=>Math.max(a,Math.min(b,v));

/** Aggressive off-road tyre. The bottom flattening is a projection of tyre
 * deflection, while tread lugs remain real geometry for silhouettes/shadows. */
export function detailedOffroadWheelMeshes(p:OffroadWheelGeometrySpec,side:-1|1=1){
  const radius=p.radius,width=p.width,deflection=clamp(p.deflectionM??0,0,radius*.32),flatten=-radius+deflection,bulge=clamp(p.sidewallBulge??deflection/Math.max(.01,radius)*.65,0,.28);
  const segments=Math.max(24,Math.min(96,Math.round(p.treadBlocks??40))),profile=[[-.50,.78],[-.44,.91],[-.31,.985],[0,1],[.31,.985],[.44,.91],[.50,.78]] as const,b=new Builder(),rings:V3[][]=[];
  for(const [zNorm,rNorm] of profile){const ring:V3[]=[];for(let i=0;i<segments;i++){const a=i/segments*Math.PI*2,s=Math.sin(a),c=Math.cos(a),proximity=clamp((-c-.18)/.82,0,1),r=radius*rNorm*(1+bulge*proximity*(1-Math.abs(zNorm)*.72));let x=s*r,y=c*r;if(y<flatten)y=flatten;ring.push([x,y,zNorm*width]);}rings.push(ring);}
  for(let j=0;j<rings.length-1;j++)for(let i=0;i<segments;i++){const n=(i+1)%segments;b.quad(rings[j]![i]!,rings[j+1]![i]!,rings[j+1]![n]!,rings[j]![n]!);}
  const tread=Math.max(.008,p.treadDepthM??Math.min(.032,radius*.065)),lugLength=2*Math.PI*radius/segments*.62;
  for(let i=0;i<segments;i++){const a=(i+.5)/segments*Math.PI*2,s=Math.sin(a),c=Math.cos(a),radial:V3=[s,c,0],tangent:V3=[c,-s,0];for(const band of [-.31,0,.31]){if(band===0&&i%2!==0)continue;const stagger=band===0?0:(i%2?1:-1)*.05,widthScale=band===0?.34:.28,rr=radius+tread*.45;let cx=s*rr,cy=c*rr;if(cy-tread/2<flatten)cy=flatten+tread/2;b.box([cx,cy,(band+stagger)*width],tangent,radial,width*widthScale,lugLength*(band===0?1.15:.9),tread);}}
  const road=detailedRoadWheelMeshes(p,side);return Object.freeze({tire:b.mesh(),rim:road.rim});
}
