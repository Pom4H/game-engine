import type {Primitive} from '../scene/types.js';

export interface MeshData {vertices:Float32Array;indices:Uint16Array|Uint32Array;indexFormat:'uint16'|'uint32'}
export function primitiveKey(primitive:Primitive):string{return JSON.stringify(primitive);}
export function primitiveMesh(primitive:Primitive):MeshData{
  if(primitive.kind==='box')return boxMesh();
  if(primitive.kind==='plane')return planeMesh();
  if(primitive.kind==='shard')return shardMesh(primitive.skew??0);
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
function shardMesh(skew:number):MeshData{
  const s=Math.max(-.45,Math.min(.45,skew));
  const front=[-.5,-.5,-.5, .5,-.5,-.5, s,.5,-.5],back=[-.5,-.5,.5, .5,-.5,.5, s,.5,.5];
  const p:number[]=[],n:number[]=[],i:number[]=[];
  const face=(verts:number[],normal:number[])=>{const base=p.length/3;p.push(...verts);for(let k=0;k<verts.length/3;k++)n.push(...normal);if(verts.length===9)i.push(base,base+1,base+2);else i.push(base,base+1,base+2,base,base+2,base+3);};
  face(front,[0,0,-1]);face(back,[0,0,1]);
  face([-.5,-.5,-.5,.5,-.5,-.5,.5,-.5,.5,-.5,-.5,.5],[0,-1,0]);
  face([.5,-.5,-.5,s,.5,-.5,s,.5,.5,.5,-.5,.5],[1,.4,0]);
  face([s,.5,-.5,-.5,-.5,-.5,-.5,-.5,.5,s,.5,.5],[-1,.4,0]);
  return pack(p,n,i);
}
function sphereMesh(segments:number):MeshData{
  const p:number[]=[],n:number[]=[],idx:number[]=[],rings=Math.max(4,Math.floor(segments/2));
  for(let y=0;y<=rings;y++){const v=y/rings,theta=v*Math.PI,s=Math.sin(theta),c=Math.cos(theta);for(let x=0;x<=segments;x++){const u=x/segments,phi=u*Math.PI*2,nx=Math.cos(phi)*s,nz=Math.sin(phi)*s;p.push(nx*.5,c*.5,nz*.5);n.push(nx,c,nz);}}
  const row=segments+1;for(let y=0;y<rings;y++)for(let x=0;x<segments;x++){const a=y*row+x,b=a+row;idx.push(a,b,a+1,b,b+1,a+1);}
  return pack(p,n,idx);
}
