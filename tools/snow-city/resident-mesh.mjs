import {makePedestrian,pedestrianAnimation} from './pedestrian.mjs';
import {bindHumanoid,sampleWalker} from '../../dist/animation/locomotion.js';
import {primitiveMesh,freezePrimitive} from '../../dist/procedural/mesh.js';
import {compose} from '../../dist/math.js';

const cache=new Map();
const palette=[[.86,.22,.08,1],[.04,.39,.49,1],[.35,.15,.54,1],[.88,.63,.12,1],[.15,.22,.31,1],[.52,.12,.16,1]];
// Clothing is authored once, then attached in rigid joint groups. Fine trims
// keep their vertex colours; they do not need their own draw/uniform update.
export function residentMesh(colorIndex,detail){
 const key=colorIndex+':'+detail;if(cache.has(key))return cache.get(key);
 const model=makePedestrian({detail}),bindings=pedestrianAnimation().bindings;
 const pose=sampleWalker({id:'rest',root:[0,0,0],heading:0,speed:0},0),groups=new Map();
 for(let i=0;i<model.length;i++){
  const part=model[i],binding=bindings[i],kind=part.material.kind==='snow'?'snow':'default';
  const name=[binding.joint,binding.boneTo??'',binding.foot??'',kind].join(':');
  let group=groups.get(name);
  if(!group){const rig={entity:name,joint:binding.joint,...(binding.boneTo?{boneTo:binding.boneTo}:{}),...(binding.foot?{foot:binding.foot}:{})};group={id:name,binding:rig,positions:[],normals:[],indices:[],colors:[],material:{kind,color:[1,1,1,1],roughness:.9,...(kind==='default'?{pattern:'fabric'}:{})}};groups.set(name,group);}
  const at=bindHumanoid(pose,[binding])[0],base=bindHumanoid(pose,[group.binding])[0];
  const sphere=part.mesh.kind==='sphere'?2*(part.mesh.radius??1):1;
  const m=compose(at.position,at.rotation,at.scale.map(v=>v*sphere)),g=compose(base.position,base.rotation,base.scale),lens=[0,4,8].map(k=>g[k]**2+g[k+1]**2+g[k+2]**2),ml=[0,4,8].map(k=>m[k]**2+m[k+1]**2+m[k+2]**2);
  const mesh=primitiveMesh(part.mesh),v=mesh.vertices,offset=group.positions.length/3;
  const color=/coat|Arm|forearm|hood|hat/.test(part.id.slice(7))?palette[colorIndex]:part.material.color;
  for(let j=0;j<v.length;j+=6){
   const p=[0,1,2].map(k=>m[k]*v[j]+m[k+4]*v[j+1]+m[k+8]*v[j+2]+m[k+12]-g[k+12]);
   group.positions.push(...[0,4,8].map((col,k)=>(g[col]*p[0]+g[col+1]*p[1]+g[col+2]*p[2])/lens[k]));
   const normal=[0,1,2].map(k=>m[k]*v[j+3]/ml[0]+m[k+4]*v[j+4]/ml[1]+m[k+8]*v[j+5]/ml[2]);
   const n=[0,4,8].map(col=>g[col]*normal[0]+g[col+1]*normal[1]+g[col+2]*normal[2]),length=Math.hypot(...n)||1;group.normals.push(...n.map(v=>v/length));group.colors.push(...color);
  }
  for(const index of mesh.indices)group.indices.push(offset+index);
 }
 const result=[...groups.values()].map(g=>({id:g.id,binding:g.binding,material:g.material,mesh:freezePrimitive({kind:'triangle-mesh',positions:g.positions,normals:g.normals,indices:g.indices,colors:g.colors})}));cache.set(key,result);return result;
}
