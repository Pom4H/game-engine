import {primitiveMesh,type MeshData} from '../../procedural/mesh.js';
import {meshBounds} from '../../render/visibility.js';
import type {PreparedMeshPacket} from '../../procedural/prepared-mesh.js';
import type {EntitySpec,MaterialSpec,Primitive} from '../../scene/types.js';
import {OpenWorld,climateAt,roadCenter,SEA_LEVEL,hash01,type RGB} from './world.js';
import {LANDMARKS} from './session.js';
type Point=readonly [number,number,number];
const primitives=new Map<string,MeshData>();
function unit(primitive:Primitive):MeshData{
 const key=JSON.stringify(primitive);let mesh=primitives.get(key);
 if(!mesh){mesh=primitiveMesh(primitive);if(primitives.size>=16)primitives.delete(primitives.keys().next().value!);primitives.set(key,mesh);}return mesh;
}
class Mesh {
 positions:number[]=[];normals:number[]=[];colors:number[]=[];indices:number[]=[];
 constructor(readonly material:MaterialSpec={kind:'plastic',color:[1,1,1,1],roughness:.88}){}
 append(mesh:Primitive,p:Point,color:RGB,scale:Point=[1,1,1]):void{
  const m=unit(mesh),offset=this.positions.length/3;
  for(let i=0;i<m.vertices.length;i+=6){this.positions.push(p[0]+m.vertices[i]!*scale[0],p[1]+m.vertices[i+1]!*scale[1],p[2]+m.vertices[i+2]!*scale[2]);const nx=m.vertices[i+3]!/scale[0],ny=m.vertices[i+4]!/scale[1],nz=m.vertices[i+5]!/scale[2],l=Math.hypot(nx,ny,nz)||1;this.normals.push(nx/l,ny/l,nz/l);this.colors.push(...color,1);}
  for(const i of m.indices)this.indices.push(offset+i);
 }
 triangle(a:Point,b:Point,c:Point,color:RGB):void{
  const offset=this.positions.length/3,ab=[b[0]-a[0],b[1]-a[1],b[2]-a[2]],ac=[c[0]-a[0],c[1]-a[1],c[2]-a[2]];
  const nx=ab[1]!*ac[2]!-ab[2]!*ac[1]!,ny=ab[2]!*ac[0]!-ab[0]!*ac[2]!,nz=ab[0]!*ac[1]!-ab[1]!*ac[0]!,l=Math.hypot(nx,ny,nz)||1;
  for(const p of [a,b,c]){this.positions.push(...p);this.normals.push(nx/l,ny/l,nz/l);this.colors.push(...color,1);}this.indices.push(offset,offset+1,offset+2);
 }
 quad(a:Point,b:Point,c:Point,d:Point,color:RGB):void{this.triangle(a,b,c,color);this.triangle(a,c,d,color);}
 entity(id:string):EntitySpec{return {id,collision:'none',mesh:{kind:'triangle-mesh',positions:this.positions,normals:this.normals,indices:this.indices,colors:this.colors},material:this.material};}
}
/** Scenery is a projection of the original collision records, never a second world.
 * Geometry/detail/material batches are built ONLY in the geometry worker. */
export function chunkGeometry(world:OpenWorld,cx:number,cz:number):EntitySpec[]{
 const chunk=world.chunk(cx,cz),ox=cx*128,oz=cz*128;
 const terrain=new Mesh({kind:'plastic',color:[1,1,1,1],roughness:.98,pattern:'plaster'});
 const masonry=new Mesh({kind:'concrete',color:[1,1,1,1],roughness:.86,pattern:'brick'});
 const trim=new Mesh({kind:'concrete',color:[1,1,1,1],roughness:.8,pattern:'plaster'});
 const asphalt=new Mesh({kind:'asphalt',color:[1,1,1,1],roughness:.68});
 const details=new Mesh({kind:'plastic',color:[1,1,1,1],roughness:.86});
 // Opaque coated facade panels keep reflection and early depth. No fake transparency
 // over a solid building shell, no thousands of individual draw calls for windows.
 const windows=new Mesh({kind:'plastic',color:[1,1,1,1],roughness:.19,metalness:.25,clearcoat:.65,clearcoatRoughness:.13});
 const metal=new Mesh({kind:'steel',color:[1,1,1,1],roughness:.42,metalness:.65});
 const ground=(x:number,z:number,offset=0):Point=>[x-ox,world.ground(x,z).y+offset,z-oz];
 const box=(mesh:Mesh,x:number,y:number,z:number,sx:number,sy:number,sz:number,color:RGB)=>mesh.append({kind:'box',size:[1,1,1]},[x-ox,y,z-oz],color,[sx,sy,sz]);
 for(let z=0;z<16;z++)for(let x=0;x<16;x++){
  const a:Point=[x*8,chunk.heights[z*17+x]!,z*8],b:Point=[x*8+8,chunk.heights[z*17+x+1]!,z*8],c:Point=[x*8,chunk.heights[(z+1)*17+x]!,z*8+8],d:Point=[x*8+8,chunk.heights[(z+1)*17+x+1]!,z*8+8];
  const climate=climateAt(world.seed,ox+x*8+4,oz+z*8+4),color:RGB=climate.biome==='city'?[.32,.37,.26]:climate.color;
  terrain.triangle(a,c,b,color);terrain.triangle(b,c,d,color);
 }
 function strip(mesh:Mesh,points:readonly (readonly [number,number])[],color:RGB,height=.025):void{
  let polygon=points.map(p=>[...p] as [number,number]);
  for(const [axis,edge,side] of [[0,ox,1],[0,ox+128,-1],[1,oz,1],[1,oz+128,-1]] as const){const next:[number,number][]=[];for(let i=0;i<polygon.length;i++){const a=polygon[i]!,b=polygon[(i+1)%polygon.length]!,ia=(a[axis]-edge)*side>=0,ib=(b[axis]-edge)*side>=0;if(ia)next.push(a);if(ia!==ib){const t=(edge-a[axis])/(b[axis]-a[axis]);next.push([a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t]);}}polygon=next;}
  for(let i=1;i+1<polygon.length;i++)mesh.triangle(ground(...polygon[0]!,height),ground(...polygon[i]!,height),ground(...polygon[i+1]!,height),color);
 }
 const rect=(mesh:Mesh,x:number,z:number,w:number,d:number,color:RGB,h=.025)=>strip(mesh,[[x-w/2,z-d/2],[x-w/2,z+d/2],[x+w/2,z+d/2],[x+w/2,z-d/2]],color,h);
 if(cx>=-3&&cx<3&&cz>=-3&&cz<3){
  for(let n=0;n<=2;n++){
   const x=ox+n*64,z=oz+n*64;
   rect(trim,x,oz+64,20,128,[.58,.56,.5],.012);rect(trim,ox+64,z,128,20,[.58,.56,.5],.012);
   rect(asphalt,x,oz+64,12,128,[.16,.18,.18]);rect(asphalt,ox+64,z,128,12,[.16,.18,.18]);
   for(let t=6;t<128;t+=12)if(t%64>12&&t%64<52){rect(details,x,oz+t,.14,5,[.87,.77,.49],.045);rect(details,ox+t,z,5,.14,[.87,.77,.49],.045);}
   // Crosswalks and kerb lines lie on the canonical surface and add no obstacles.
   for(let crossing=0;crossing<2;crossing++)for(let k=-4;k<=4;k++){
    rect(details,x+k,oz+crossing*64+10,.55,3,[.78,.77,.68],.05);
    rect(details,ox+crossing*64+10,z+k,3,.55,[.78,.77,.68],.05);
   }
  }
  for(let z=0;z<2;z++)for(let x=0;x<2;x++){
   const px=ox+x*64+9,pz=oz+z*64+9;
   metal.append({kind:'cylinder',radius:1,height:1,segments:8},[px-ox,2.7,pz-oz],[.19,.21,.2],[.1,5.4,.1]);
   box(metal,px,5.45,pz-1,.16,.14,2.2,[.19,.21,.2]);box(details,px,5.34,pz-1.75,.48,.10,.7,[1,.86,.59]);
  }
 }else{
  for(const axis of ['e','n'] as const){const base=Math.round(axis==='e'?(oz+64)/1536:(ox+320)/1536),start=axis==='e'?ox:oz;
   for(let k=base-1;k<=base+1;k++)for(let t=start;t<start+128;t+=8){const a=roadCenter(world.seed,axis,k,t),b=roadCenter(world.seed,axis,k,t+8),dx=b.x-a.x,dz=b.z-a.z,l=Math.hypot(dx,dz),nx=dz/l,nz=-dx/l;
    const band=(mesh:Mesh,half:number,color:RGB,h:number)=>strip(mesh,[[a.x-nx*half,a.z-nz*half],[b.x-nx*half,b.z-nz*half],[b.x+nx*half,b.z+nz*half],[a.x+nx*half,a.z+nz*half]],color,h);
    band(trim,a.width/2+1.5,[.51,.47,.38],.018);band(asphalt,a.width/2,[.16,.18,.18],.035);if(Math.floor(t/8)%2===0)band(details,.07,[.87,.77,.49],.055);
   }
  }
 }
 for(const p of chunk.props){
  if(p.kind==='building'){
   box(masonry,p.x,p.y+p.height/2,p.z,p.width,p.height,p.depth,p.color);
   box(trim,p.x,p.y+.40,p.z,p.width+.10,.8,p.depth+.10,[.36,.36,.32]);
   // Recessed roof, cornice and four parapets give the silhouette actual depth.
   box(asphalt,p.x,p.y+p.height+.04,p.z,p.width,.08,p.depth,[.20,.22,.21]);
   for(const side of [-1,1]){
    box(trim,p.x,p.y+p.height+.3,p.z+side*p.depth/2,p.width+.35,.6,.34,[.55,.52,.45]);
    box(trim,p.x+side*p.width/2,p.y+p.height+.3,p.z,.34,.6,p.depth+.35,[.55,.52,.45]);
   }
   box(metal,p.x,p.y+1.3,p.z+p.depth/2+.04,2,2.6,.08,[.12,.16,.16]);
   box(trim,p.x,p.y+2.8,p.z+p.depth/2+.35,3,.18,.7,[.55,.53,.46]);
   const floors=Math.min(8,Math.floor(p.height/3.5));
   // Windows are planes (2 triangles), not six-sided boxes. Frames are batch
   // geometry as well; dozens of windows do not add a draw call each.
   for(let row=0;row<floors;row++)for(let col=-2;col<=2;col++)for(const side of [-1,1]){
    const y=p.y+2+row*3.5,w=1.1,h=.94;
    const lit=hash01(cx*4+row,cz*13+col,side,world.seed)>.65;
    const glass:RGB=lit?[.46,.37,.24]:[.15,.23,.26];
    for(const axis of [0,2] as const){
     const center:Point=axis===2?[p.x-ox+col*p.width/6,y,p.z-oz+side*(p.depth/2+.03)]:[p.x-ox+side*(p.width/2+.03),y,p.z-oz+col*p.depth/6];
     const point=(u:number,v:number,out=0):Point=>axis===2?[center[0]+u,center[1]+v,center[2]+side*out]:[center[0]+side*out,center[1]+v,center[2]+u];
     const quad=(mesh:Mesh,a:Point,b:Point,c:Point,d:Point,color:RGB)=>{if((axis===2?1:-1)===side)mesh.quad(a,b,c,d,color);else mesh.quad(d,c,b,a,color);};
     quad(windows,point(-w,-h),point(w,-h),point(w,h),point(-w,h),glass);
     const panel=(u:number,v:number,a:number,b:number)=>quad(trim,point(u-a/2,v-b/2,.04),point(u+a/2,v-b/2,.04),point(u+a/2,v+b/2,.04),point(u-a/2,v+b/2,.04),[.64,.61,.54]);
     panel(-w,0,.09,h*2+.12);panel(w,0,.09,h*2+.12);panel(0,-h,w*2+.15,.13);panel(0,h,w*2+.15,.09);panel(0,0,.055,h*2);panel(0,.25,w*2,.055);
    }
   }
  }else{
   details.append({kind:'cylinder',radius:1,topRadius:.7,height:1,segments:7},[p.x-ox,p.y+p.height*.30,p.z-oz],[.23,.17,.12],[p.width*.5,p.height*.6,p.depth*.5]);
   for(let crown=0;crown<5;crown++){
    const a=crown*2.399,offset=crown===0?0:1.1,scale=2.6+hash01(cx,cz,crown,world.seed)*.8;
    const color:RGB=[p.color[0]*(.85+crown*.04),p.color[1]*(.80+crown*.06),p.color[2]*(.90+crown*.03)];
    details.append({kind:'sphere',radius:.5,segments:8},[p.x-ox+Math.sin(a)*offset,p.y+p.height*(.65+crown*.04),p.z-oz+Math.cos(a)*offset],color,[scale,p.height*.55,scale]);
   }
  }
 }
 for(const point of LANDMARKS)if(Math.floor(point.x/128)===cx&&Math.floor(point.z/128)===cz){const y=Math.max(SEA_LEVEL,world.ground(point.x,point.z).y);box(details,point.x,y+.14,point.z,2.4,.28,2.4,[.96,.65,.22]);box(metal,point.x,y+3,point.z,.18,6,.18,[.65,.51,.23]);details.append({kind:'torus',radius:1,tube:.13,segments:20},[point.x-ox,y+4,point.z-oz],[1,.73,.29]);}
 const batches=[['terrain',terrain],['masonry',masonry],['trim',trim],['asphalt',asphalt],['details',details],['windows',windows],['metal',metal]] as const;
 const result:EntitySpec[]=batches.filter(([,mesh])=>mesh.indices.length>0).map(([name,mesh])=>mesh.entity(`chunk:${chunk.key}/${name}`));
 if(chunk.heights.some(y=>y<SEA_LEVEL))result.push({id:`chunk:${chunk.key}/water`,collision:'none',position:[64,SEA_LEVEL,64],mesh:{kind:'plane',size:[128,128]},material:{kind:'plastic',color:[.12,.28,.32,1],roughness:.18,metalness:.15,clearcoat:.5}});
 return result;
}
export interface PreparedScenery {readonly spec:Omit<EntitySpec,'mesh'|'renderMesh'|'body'>;readonly mesh:PreparedMeshPacket}
/** The structured-clone boundary carries typed buffers, never expanded vertex arrays. */
export function prepareChunkGeometry(world:OpenWorld,cx:number,cz:number):PreparedScenery[]{
 return chunkGeometry(world,cx,cz).map(({mesh,renderMesh:_render,body:_body,...spec})=>{
  const source=primitiveMesh(mesh!),indices=new Uint32Array(source.indices);
  // primitiveMesh's plane/box size lives in the object transform; baked meshes do not.
  if(mesh?.kind==='plane'){for(let i=0;i<source.vertices.length;i+=6){source.vertices[i]=source.vertices[i]!*(mesh.size?.[0]??1);source.vertices[i+2]=source.vertices[i+2]!*(mesh.size?.[1]??1);}}
  return {spec,mesh:{vertices:source.vertices,colors:source.colors,indices,bounds:meshBounds(source.vertices)}};
 });
}
