import {V3,type Vec3} from '../math.js';
import type {Primitive} from '../scene/types.js';
export type ClothRing=readonly [height:number,depthRadius:number,widthRadius:number,centreDepth?:number];
export interface ClothLoftOptions {
 readonly rings:readonly ClothRing[];readonly radialSegments?:number;readonly subdivisions?:number;
 readonly roundness?:number;readonly folds?:number;readonly seed?:number;
}
/** Closed, smooth garment/soft-goods loft. Ring interpolation makes actual
 * folds in the surface; normals are derived from that geometry, so fabric
 * responds to the same directional/local illumination as other materials. */
export function clothLoftMesh(options:ClothLoftOptions):Primitive {
 const {rings}=options,n=options.radialSegments??48,subdivisions=options.subdivisions??4,power=options.roundness??.8,folds=options.folds??0,seed=options.seed??1;
 if(rings.length<2||rings.length>64||!Number.isInteger(n)||n<8||n>128||!Number.isInteger(subdivisions)||subdivisions<1||subdivisions>16||!Number.isFinite(power)||power<.3||power>2||!Number.isFinite(folds)||folds<0||folds>.2||!Number.isFinite(seed))throw new RangeError('Invalid cloth loft budget or shape');
 for(let r=0;r<rings.length;r++){const ring=rings[r]!;if(!ring.every(Number.isFinite)||ring[1]<=0||ring[2]<=0||r>0&&ring[0]<=rings[r-1]![0])throw new RangeError('Cloth rings require increasing heights and positive radii');}
 const positions:number[]=[],normals:number[]=[],indices:number[]=[];
 const count=(rings.length-1)*subdivisions+1;
 const radius=(r:number,t:number,index:1|2|3)=>{
  const a=rings[Math.max(0,r-1)]![index]??0,b=rings[r]![index]??0,c=rings[Math.min(r+1,rings.length-1)]![index]??0,d=rings[Math.min(r+2,rings.length-1)]![index]??0;
  return .5*((2*b)+(-a+c)*t+(2*a-5*b+4*c-d)*t*t+(-a+3*b-3*c+d)*t*t*t);
 };
 for(let k=0;k<count;k++){
  const r=Math.min(rings.length-2,Math.floor(k/subdivisions)),t=(k-r*subdivisions)/subdivisions,y=rings[r]![0]+(rings[r+1]![0]-rings[r]![0])*t;
  const rx=radius(r,t,1),rz=radius(r,t,2),centre=radius(r,t,3),v=k/(count-1);
  for(let j=0;j<n;j++){
   const angle=j/n*Math.PI*2,c=Math.cos(angle),s=Math.sin(angle);
   // Broad tension folds, smaller diagonal compression folds and unequal hems.
   const hem=Math.exp(-(((v-.12)/.20)**2))+.55*Math.exp(-(((v-.75)/.16)**2));
   const ripple=folds*(Math.sin(angle*7+y*21+seed)*.52+Math.sin(angle*13-y*37+seed*1.7)*.20+hem*Math.sin(y*63+Math.sin(angle*3)*2.7)*.72);
   positions.push(centre+Math.sign(c)*Math.abs(c)**power*(rx+ripple),y,Math.sign(s)*Math.abs(s)**power*(rz+ripple*.75));normals.push(0,0,0);
  }
 }
 for(let k=0;k<count-1;k++)for(let j=0;j<n;j++){const a=k*n+j,b=k*n+(j+1)%n;indices.push(a,a+n,b,b,a+n,b+n);}
 for(const r of [0,count-1]){const centre=positions.length/3;positions.push(rings[r===0?0:rings.length-1]![3]??0,rings[r===0?0:rings.length-1]![0],0);normals.push(0,0,0);for(let j=0;j<n;j++){const a=r*n+j,b=r*n+(j+1)%n;indices.push(centre,r===0?a:b,r===0?b:a);}}
 for(let k=0;k<indices.length;k+=3){const ids=[indices[k]!,indices[k+1]!,indices[k+2]!] as const,point=(i:number)=>positions.slice(i*3,i*3+3) as unknown as Vec3;const a=point(ids[0]),b=point(ids[1]),c=point(ids[2]),normal=V3.cross(V3.sub(b,a),V3.sub(c,a));for(const id of ids)for(let axis=0;axis<3;axis++)normals[id*3+axis]=normals[id*3+axis]!+normal[axis]!;}
 for(let i=0;i<normals.length;i+=3){const normal=V3.normalize(normals.slice(i,i+3) as unknown as Vec3);normals[i]=normal[0];normals[i+1]=normal[1];normals[i+2]=normal[2];}
 return{kind:'triangle-mesh',positions,normals,indices};
}
