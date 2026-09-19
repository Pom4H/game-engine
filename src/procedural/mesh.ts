import type {Primitive} from '../scene/types.js';

export interface MeshData {vertices:Float32Array;indices:Uint16Array|Uint32Array;indexFormat:'uint16'|'uint32'}
export function primitiveKey(primitive:Primitive):string{return JSON.stringify(primitive);}
export function primitiveMesh(primitive:Primitive):MeshData{
  if(primitive.kind==='box')return boxMesh();
  if(primitive.kind==='plane')return planeMesh();
  if(primitive.kind==='shard')return shardMesh(primitive.axis??2,primitive.skew??0);
  if(primitive.kind==='polygon-prism')return polygonPrismMesh(primitive.axis??2,primitive.points,primitive.thickness);
  return sphereMesh(Math.max(6,Math.min(64,Math.round(primitive.segments??20))));
}
function pack(positions:number[],normals:number[],indices:number[]):MeshData{
  const vertices=new Float32Array((positions.length/3)*6);
  for(let i=0;i<positions.length/3;i++){vertices[i*6]=positions[i*3]!;vertices[i*6+1]=positions[i*3+1]!;vertices[i*6+2]=positions[i*3+2]!;vertices[i*6+3]=normals[i*3]!;vertices[i*6+4]=normals[i*3+1]!;vertices[i*6+5]=normals[i*3+2]!;}
  const Index=positions.length/3>65535?Uint32Array:Uint16Array;
  return{vertices,indices:new Index(indices),indexFormat:Index===Uint32Array?'uint32':'uint16'};
}
function boxMesh():MeshData{
  const p:number[]=[],n:number[]=[],i:number[]=[];
  const faces:Array<[number[],number[]]>=[
    [[1,-1,-1, 1,-1,1, 1,1,1, 1,1,-1],[1,0,0]],
    [[-1,-1,1, -1,-1,-1, -1,1,-1, -1,1,1],[-1,0,0]],
    [[-1,1,-1, 1,1,-1, 1,1,1, -1,1,1],[0,1,0]],
    [[-1,-1,1, 1,-1,1, 1,-1,-1, -1,-1,-1],[0,-1,0]],
    [[1,-1,1, -1,-1,1, -1,1,1, 1,1,1],[0,0,1]],
    [[-1,-1,-1, 1,-1,-1, 1,1,-1, -1,1,-1],[0,0,-1]],
  ];
  for(const [verts,normal] of faces){const base=p.length/3;for(let v=0;v<4;v++){p.push(verts[v*3]!*.5,verts[v*3+1]!*.5,verts[v*3+2]!*.5);n.push(...normal);}i.push(base,base+1,base+2,base,base+2,base+3);}
  return pack(p,n,i);
}
function planeMesh():MeshData{return pack([-0.5,0,-0.5, 0.5,0,-0.5, 0.5,0,0.5, -0.5,0,0.5],[0,1,0, 0,1,0, 0,1,0, 0,1,0],[0,1,2,0,2,3]);}
function shardMesh(axis:0|1|2,skew:number):MeshData{
  const s=Math.max(-.45,Math.min(.45,skew));
  const base=[
    [-.5,-.5,-.5],[.5,-.5,-.5],[s,.5,-.5],
    [-.5,-.5,.5],[.5,-.5,.5],[s,.5,.5],
  ] as [number,number,number][];
  const map=(v:[number,number,number]):[number,number,number]=>axis===2?v:axis===0?[v[2],v[1],v[0]]:[v[0],v[2],v[1]];
  const q=base.map(map),p:number[]=[],n:number[]=[],i:number[]=[];
  const face=(indices:number[])=>{
    const a=q[indices[0]!]!,b=q[indices[1]!]!,c=q[indices[2]!]!,ux=b[0]-a[0],uy=b[1]-a[1],uz=b[2]-a[2],vx=c[0]-a[0],vy=c[1]-a[1],vz=c[2]-a[2];
    const nx=uy*vz-uz*vy,ny=uz*vx-ux*vz,nz=ux*vy-uy*vx,length=Math.hypot(nx,ny,nz)||1,normal=[nx/length,ny/length,nz/length];
    const offset=p.length/3;for(const index of indices)p.push(...q[index]!);for(let k=0;k<indices.length;k++)n.push(...normal);
    if(indices.length===3)i.push(offset,offset+1,offset+2);else i.push(offset,offset+1,offset+2,offset,offset+2,offset+3);
  };
  face([0,2,1]);face([3,4,5]);face([0,1,4,3]);face([1,2,5,4]);face([2,0,3,5]);
  return pack(p,n,i);
}
function polygonPrismMesh(axis:0|1|2,points:readonly (readonly [number,number])[],thickness:number):MeshData{
  if(points.length<3)throw new RangeError('polygon-prism requires at least 3 points');
  const depth=Math.max(.0005,thickness)/2,map=(u:number,v:number,d:number):[number,number,number]=>axis===0?[d,u,v]:axis===1?[u,d,v]:[u,v,d];
  const p:number[]=[],n:number[]=[],i:number[]=[];
  const normalFor=(a:[number,number,number],b:[number,number,number],c:[number,number,number])=>{
    const ux=b[0]-a[0],uy=b[1]-a[1],uz=b[2]-a[2],vx=c[0]-a[0],vy=c[1]-a[1],vz=c[2]-a[2],nx=uy*vz-uz*vy,ny=uz*vx-ux*vz,nz=ux*vy-uy*vx,l=Math.hypot(nx,ny,nz)||1;return[nx/l,ny/l,nz/l];
  };
  const addFace=(verts:[number,number,number][])=>{const base=p.length/3,normal=normalFor(verts[0]!,verts[1]!,verts[2]!);for(const v of verts){p.push(...v);n.push(...normal);}for(let k=1;k<verts.length-1;k++)i.push(base,base+k,base+k+1);};
  const front=points.map(q=>map(q[0],q[1],-depth)),back=points.map(q=>map(q[0],q[1],depth));
  addFace([...front].reverse());addFace(back);
  for(let k=0;k<points.length;k++){const next=(k+1)%points.length;addFace([front[k]!,front[next]!,back[next]!,back[k]!]);}
  return pack(p,n,i);
}
function sphereMesh(segments:number):MeshData{
  const p:number[]=[],n:number[]=[],idx:number[]=[],rings=Math.max(4,Math.floor(segments/2));
  for(let y=0;y<=rings;y++){const v=y/rings,theta=v*Math.PI,s=Math.sin(theta),c=Math.cos(theta);for(let x=0;x<=segments;x++){const u=x/segments,phi=u*Math.PI*2,nx=Math.cos(phi)*s,nz=Math.sin(phi)*s;p.push(nx*.5,c*.5,nz*.5);n.push(nx,c,nz);}}
  const row=segments+1;for(let y=0;y<rings;y++)for(let x=0;x<segments;x++){const a=y*row+x,b=a+row;idx.push(a,b,a+1,b,b+1,a+1);}
  return pack(p,n,idx);
}
