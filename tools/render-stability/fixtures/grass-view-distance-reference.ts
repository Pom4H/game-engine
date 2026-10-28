// Frozen original nearest-distance concatenation, 2026-10-21, for exact-order-independent geometry and native pixel oracles.
import {MeshBuilder} from '../../../../thegame/src/game/runtime/render.js';
import type {PrimitiveInstances} from '../../../../thegame/src/game/primitive-instances.ts';
import type {V3} from '../../../../thegame/src/game/biomes.ts';
export type GrassGround=(x:number,z:number)=>number|null|undefined;
const hash=(x:number,z:number,s:number)=>{let n=Math.imul(x^s,374761393)^Math.imul(z,668265263);n=Math.imul(n^(n>>>13),1274126177);return ((n^(n>>>16))>>>0)/4294967296;};
/** Bounded near-camera visual patches. Each immutable mesh is shared by both backends;
 * absolute cell seeds and patch-local vertices survive render-origin changes. */
export class GrassView{
 readonly cache=new Map<string,Float32Array>();created=0;visible=0;private signature='';private geometry=new Float32Array(0);
 draw(batch:PrimitiveInstances,eye:V3,origin:V3,ground:GrassGround){
  let budget=2;this.visible=0;const cx=Math.floor(eye[0]/2),cz=Math.floor(eye[2]/2),cells:{x:number;z:number;d:number}[]=[];
  for(let z=cz-4;z<=cz+4;z++)for(let x=cx-4;x<=cx+4;x++){const d=Math.hypot(x*2+1-eye[0],z*2+1-eye[2]);if(d<7)cells.push({x,z,d});}
  cells.sort((a,b)=>a.d-b.d);
  const live=new Set(cells.map(p=>`${p.x}:${p.z}`)),parts:{x:number;z:number;data:Float32Array}[]=[];
  for(const key of batch.groups.keys())if(key.startsWith('custom:grass:')&&key!=='custom:grass:near')batch.groups.delete(key);
  for(const p of cells){const key=`${p.x}:${p.z}`;let geometry=this.cache.get(key);
   if(!geometry){if(!budget)continue;budget--;geometry=this.build(p.x,p.z,ground);if(!geometry)continue;this.cache.set(key,geometry);this.created++;}
   if(geometry.length){parts.push({x:p.x,z:p.z,data:geometry});this.visible++;}
  }
  const signature=`${cx}:${cz}:`+parts.map(p=>`${p.x}:${p.z}`).join(',');
  if(signature!==this.signature){this.signature=signature;const data=new Float32Array(parts.reduce((n,p)=>n+p.data.length,0));let start=0;
   for(const p of parts){data.set(p.data,start);for(let i=start;i<start+p.data.length;i+=13){data[i]=data[i]!+(p.x-cx)*2;data[i+2]=data[i+2]!+(p.z-cz)*2;}start+=p.data.length;}
   this.geometry=data;
  }
  if(this.geometry.length)batch.writer(cx*2-origin[0],-origin[1],cz*2-origin[2]).geometry('grass:near',this.geometry);
  while(this.cache.size>64){const key=[...this.cache.keys()].find(k=>!live.has(k))??this.cache.keys().next().value!;this.cache.delete(key);}
 }
 build(px:number,pz:number,ground:GrassGround):Float32Array|undefined{
  const center=ground(px*2+1,pz*2+1);if(center===undefined)return;
  const m=new MeshBuilder();
  for(let z=0;z<12;z++)for(let x=0;x<12;x++){
   const ix=px*12+x,iz=pz*12+z,a=hash(ix,iz,13),b=hash(ix,iz,71),wx=px*2+(x+.12+a*.76)*(2/12),wz=pz*2+(z+.12+b*.76)*(2/12),y=ground(wx,wz);if(y==null)continue;
   for(let i=0;i<2;i++){
    const r=hash(ix,iz,101+i),angle=r*6.283185+i*2.1,width=.006+r*.006,height=.04+b*.045+i*.008,lean=.012+a*.018;
    const dx=Math.cos(angle)*width,dz=Math.sin(angle)*width;
    const A:V3=[wx-px*2-dx,y+.008,wz-pz*2-dz],B:V3=[wx-px*2+dx,y+.008,wz-pz*2+dz],C:V3=[wx-px*2+Math.sin(angle)*lean,y+height,wz-pz*2+Math.cos(angle)*lean];
    const color=[.27+r*.045,.35+r*.055,.13+r*.025];
    m.tri(A,B,C,color,23,0,[[0,0],[1,0],[.5,height]]);m.tri(B,A,C,color,23,0,[[1,0],[0,0],[.5,height]]);
    // Tip colour is per-vertex, attached to the shared mesh; no animated lighting noise.
    for(let k=m.data.length-6*13;k<m.data.length;k+=13)if(m.data[k+1]>y+.02){m.data[k+6]*=1.22;m.data[k+7]*=1.17;m.data[k+8]*=1.08;}
   }
  }
  return new Float32Array(m.data);
 }
}
