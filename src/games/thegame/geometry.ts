import {primitiveMesh} from '../../procedural/mesh.js';
import type {EntitySpec,Primitive} from '../../scene/types.js';
import {OpenWorld,climateAt,roadCenter,SEA_LEVEL,type RGB} from './world.js';
import {LANDMARKS} from './session.js';
type Point=readonly [number,number,number];
class Mesh {
 positions:number[]=[];normals:number[]=[];colors:number[]=[];indices:number[]=[];
 append(mesh:Primitive,p:Point,color:RGB,scale:Point=[1,1,1]):void{
  const m=primitiveMesh(mesh),offset=this.positions.length/3;
  for(let i=0;i<m.vertices.length;i+=6){this.positions.push(p[0]+m.vertices[i]!*scale[0],p[1]+m.vertices[i+1]!*scale[1],p[2]+m.vertices[i+2]!*scale[2]);const nx=m.vertices[i+3]!/scale[0],ny=m.vertices[i+4]!/scale[1],nz=m.vertices[i+5]!/scale[2],l=Math.hypot(nx,ny,nz)||1;this.normals.push(nx/l,ny/l,nz/l);this.colors.push(...color,1);}
  for(const i of m.indices)this.indices.push(offset+i);
 }
 triangle(a:Point,b:Point,c:Point,color:RGB):void{
  const offset=this.positions.length/3,ab=[b[0]-a[0],b[1]-a[1],b[2]-a[2]],ac=[c[0]-a[0],c[1]-a[1],c[2]-a[2]];
  const nx=ab[1]!*ac[2]!-ab[2]!*ac[1]!,ny=ab[2]!*ac[0]!-ab[0]!*ac[2]!,nz=ab[0]!*ac[1]!-ab[1]!*ac[0]!,l=Math.hypot(nx,ny,nz)||1;
  for(const p of [a,b,c]){this.positions.push(...p);this.normals.push(nx/l,ny/l,nz/l);this.colors.push(...color,1);}this.indices.push(offset,offset+1,offset+2);
 }
 entity(id:string):EntitySpec{return {id,collision:'none',mesh:{kind:'triangle-mesh',positions:this.positions,normals:this.normals,indices:this.indices,colors:this.colors},material:{kind:'plastic',color:[1,1,1,1],roughness:.88}};}
}
/** Geometry is generated in a worker, in chunk-local coordinates. Collision never consumes a render mesh. */
export function chunkGeometry(world:OpenWorld,cx:number,cz:number):EntitySpec[]{
 const chunk=world.chunk(cx,cz),ox=cx*128,oz=cz*128,terrain=new Mesh(),details=new Mesh();
 const ground=(x:number,z:number,offset=0):Point=>[x-ox,world.ground(x,z).y+offset,z-oz];
 for(let z=0;z<16;z++)for(let x=0;x<16;x++){
  const a:Point=[x*8,chunk.heights[z*17+x]!,z*8],b:Point=[x*8+8,chunk.heights[z*17+x+1]!,z*8],c:Point=[x*8,chunk.heights[(z+1)*17+x]!,z*8+8],d:Point=[x*8+8,chunk.heights[(z+1)*17+x+1]!,z*8+8];
  const climate=climateAt(world.seed,ox+x*8+4,oz+z*8+4),color:RGB=climate.biome==='city'?[.31,.40,.29]:climate.color;
  terrain.triangle(a,c,b,color);terrain.triangle(b,c,d,color);
 }
 const box=(x:number,y:number,z:number,sx:number,sy:number,sz:number,color:RGB)=>details.append({kind:'box',size:[1,1,1]},[x-ox,y,z-oz],color,[sx,sy,sz]);
 // Continuous vector strips are clipped to the chunk square; no visible tile-grid road substitute.
 function strip(points:readonly (readonly [number,number])[],color:RGB,height=.025):void{
  let polygon=points.map(p=>[...p] as [number,number]);
  for(const [axis,edge,side] of [[0,ox,1],[0,ox+128,-1],[1,oz,1],[1,oz+128,-1]] as const){const next:[number,number][]=[];for(let i=0;i<polygon.length;i++){const a=polygon[i]!,b=polygon[(i+1)%polygon.length]!,ia=(a[axis]-edge)*side>=0,ib=(b[axis]-edge)*side>=0;if(ia)next.push(a);if(ia!==ib){const t=(edge-a[axis])/(b[axis]-a[axis]);next.push([a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t]);}}polygon=next;}
  for(let i=1;i+1<polygon.length;i++)details.triangle(ground(...polygon[0]!,height),ground(...polygon[i]!,height),ground(...polygon[i+1]!,height),color);
 }
 const rect=(x:number,z:number,w:number,d:number,color:RGB,h=.025)=>strip([[x-w/2,z-d/2],[x-w/2,z+d/2],[x+w/2,z+d/2],[x+w/2,z-d/2]],color,h);
 if(cx>=-3&&cx<3&&cz>=-3&&cz<3){
  for(let n=0;n<=2;n++){
   const x=ox+n*64,z=oz+n*64;
   rect(x,oz+64,20,128,[.62,.59,.52],.012);rect(ox+64,z,128,20,[.62,.59,.52],.012);
   rect(x,oz+64,12,128,[.19,.23,.24]);rect(ox+64,z,128,12,[.19,.23,.24]);
   for(let t=6;t<128;t+=12){if(t%64>12&&t%64<52){rect(x,oz+t,.14,5,[.88,.82,.61],.045);rect(ox+t,z,5,.14,[.88,.82,.61],.045);}}
  }
  for(let z=0;z<2;z++)for(let x=0;x<2;x++){const px=ox+x*64+9,pz=oz+z*64+9;box(px,2.7,pz,.13,5.4,.13,[.21,.25,.25]);box(px,5.45,pz-1,.2,.18,2.2,[.22,.27,.27]);box(px,5.34,pz-1.75,.55,.10,.8,[1,.87,.56]);}
 }else{
  for(const axis of ['e','n'] as const){const base=Math.round(axis==='e'?(oz+64)/1536:(ox+320)/1536),start=axis==='e'?ox:oz;
   for(let k=base-1;k<=base+1;k++)for(let t=start;t<start+128;t+=8){const a=roadCenter(world.seed,axis,k,t),b=roadCenter(world.seed,axis,k,t+8),dx=b.x-a.x,dz=b.z-a.z,l=Math.hypot(dx,dz),nx=dz/l,nz=-dx/l;
    const band=(half:number,color:RGB,h:number)=>strip([[a.x-nx*half,a.z-nz*half],[b.x-nx*half,b.z-nz*half],[b.x+nx*half,b.z+nz*half],[a.x+nx*half,a.z+nz*half]],color,h);
    band(a.width/2+1.5,[.58,.55,.46],.018);band(a.width/2,[.20,.24,.25],.035);if(Math.floor(t/8)%2===0)band(.07,[.92,.83,.60],.055);
   }
  }
 }
 for(const p of chunk.props){
  if(p.kind==='building'){
   box(p.x,p.y+p.height/2,p.z,p.width,p.height,p.depth,p.color);box(p.x,p.y+p.height+.20,p.z,p.width+.45,.40,p.depth+.45,[.34,.35,.33]);
   box(p.x,p.y+1.3,p.z+p.depth/2+.035,1.8,2.6,.08,[.15,.22,.23]);
   for(let row=0;row<Math.min(7,Math.floor(p.height/3.5));row++)for(let col=-2;col<=2;col++)for(const side of [-1,1]){
    const y=p.y+2+row*3.5,glass:RGB=row%3===0?[.65,.71,.61]:[.24,.39,.45];
    box(p.x+col*p.width/6,y,p.z+side*(p.depth/2+.025),1.8,1.55,.04,glass);
    box(p.x+side*(p.width/2+.025),y,p.z+col*p.depth/6,.04,1.55,1.8,glass);
   }
  }else{
   box(p.x,p.y+p.height*.35,p.z,p.width,p.height*.7,p.depth,[.34,.25,.17]);
   details.append({kind:'cylinder',radius:1,topRadius:0,height:1,segments:8},[p.x-ox,p.y+p.height*.62,p.z-oz],p.color,[3,p.height*.8,3]);
  }
 }
 for(const point of LANDMARKS)if(Math.floor(point.x/128)===cx&&Math.floor(point.z/128)===cz){const y=Math.max(SEA_LEVEL,world.ground(point.x,point.z).y);box(point.x,y+.14,point.z,2.4,.28,2.4,[.96,.65,.22]);box(point.x,y+3,point.z,.18,6,.18,[.96,.65,.22]);details.append({kind:'torus',radius:1,tube:.13,segments:20},[point.x-ox,y+4,point.z-oz],[1,.73,.29]);}
 const result=[terrain.entity(`chunk:${chunk.key}/terrain`)];if(details.indices.length)result.push(details.entity(`chunk:${chunk.key}/details`));
 if(chunk.heights.some(y=>y<SEA_LEVEL))result.push({id:`chunk:${chunk.key}/water`,collision:'none',position:[64,SEA_LEVEL,64],mesh:{kind:'plane',size:[128,128]},material:{kind:'plastic',color:[.16,.42,.47,1],roughness:.26,metalness:.08}});
 return result;
}
