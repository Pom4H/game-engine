import {compose,type Vec3} from '../math.js';
import type {EntitySpec} from '../scene/types.js';
import {primitiveMesh} from './mesh.js';

/** Opt-in authoring operation for scenery only. Bodies, weather fields, lights and
 * labels retain their identity. Callers must exclude anything animated or queried
 * by ID. Spatial/material groups retain local precision and nearby point lights. */
export function batchStaticScenery(entities:readonly EntitySpec[],eligible:(e:EntitySpec)=>boolean,cellSize=18):EntitySpec[]{
 if(!Number.isFinite(cellSize)||cellSize<=0)throw new RangeError('Invalid batch cell size');
 const usedIds=new Set(entities.map(e=>e.id));
 const batchId=(source:string)=>{const base='batch:'+source.slice(0,140);let id=base,n=0;while(usedIds.has(id))id=base+':'+(++n);usedIds.add(id);return id;};
 const kept:EntitySpec[]=[],groups=new Map<string,{entity:EntitySpec;positions:number[];normals:number[];indices:number[]}>();
 for(const e of entities){
  const mesh=e.mesh,s=e.scale??[1,1,1];
  // renderMesh is an explicit visual/physics separation contract. Do not collapse
  // it into an authored physics proxy during static batching.
  if(!mesh||e.renderMesh||(mesh.kind==='triangle-mesh'&&!!mesh.colors)||e.body||e.light||e.environmental||e.material?.label||e.material?.pattern==='window'||e.material?.kind==='glass'||(e.material?.color?.[3]??1)<.98||s.some(v=>v===0)||!eligible(e)){kept.push(e);continue;}
  const p=e.position??[0,0,0],cell=p.map(v=>Math.floor(v/cellSize)),key=JSON.stringify([cell,e.material??{}]);
  let g=groups.get(key);const data=primitiveMesh(mesh);
  if(g&&(g.positions.length+data.vertices.length/2>600000||g.indices.length+data.indices.length>1800000)){kept.push({...g.entity,mesh:{kind:'triangle-mesh',positions:g.positions,normals:g.normals,indices:g.indices}});groups.delete(key);g=undefined;}
  if(!g){const center=cell.map(v=>(v+.5)*cellSize) as [number,number,number];g={entity:{id:batchId(e.id),position:center,...(e.material?{material:e.material}:{})},positions:[],normals:[],indices:[]};groups.set(key,g);}
  const base:Vec3=mesh.kind==='box'||mesh.kind==='shard'?mesh.size??[1,1,1]:mesh.kind==='sphere'?[2*(mesh.radius??1),2*(mesh.radius??1),2*(mesh.radius??1)]:mesh.kind==='plane'?[mesh.size?.[0]??1,1,mesh.size?.[1]??1]:[1,1,1];
  const m=compose(p,e.rotation??[0,0,0],[base[0]*s[0],base[1]*s[1],base[2]*s[2]]),c=g.entity.position!,offset=g.positions.length/3,v=data.vertices;
  const lens=[0,4,8].map(k=>m[k]!**2+m[k+1]!**2+m[k+2]!**2);
  for(let i=0;i<v.length;i+=6){
   const x=v[i]!,y=v[i+1]!,z=v[i+2]!,nx=v[i+3]!/lens[0]!,ny=v[i+4]!/lens[1]!,nz=v[i+5]!/lens[2]!;
   g.positions.push(m[0]!*x+m[4]!*y+m[8]!*z+p[0]-c[0],m[1]!*x+m[5]!*y+m[9]!*z+p[1]-c[1],m[2]!*x+m[6]!*y+m[10]!*z+p[2]-c[2]);
   const n=[m[0]!*nx+m[4]!*ny+m[8]!*nz,m[1]!*nx+m[5]!*ny+m[9]!*nz,m[2]!*nx+m[6]!*ny+m[10]!*nz],l=Math.hypot(...n)||1;g.normals.push(...n.map(x=>x/l));
  }
  for(const index of data.indices)g.indices.push(offset+index);
 }
 for(const g of groups.values())kept.push({...g.entity,mesh:{kind:'triangle-mesh',positions:g.positions,normals:g.normals,indices:g.indices}});
 return kept;
}
