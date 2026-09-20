import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';

const input=resolve(process.argv[2]??'artifacts/m3-reference-import/m3.json');
const output=resolve(process.argv[3]??'artifacts/m3-fbx-parts.generated.ts');
const asset=JSON.parse(await readFile(input,'utf8'));
if(asset?.provenance?.sha256!=='9c03464b3407ff1ab45cf4b3b913ee108ed454e4d7e5a82da438667af8cc2d67')throw new Error('Unexpected BMW M3 reference provenance');

function bounds(mesh){
  const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
  for(let i=0;i<mesh.positions.length;i+=3)for(let axis=0;axis<3;axis++){const v=mesh.positions[i+axis];min[axis]=Math.min(min[axis],v);max[axis]=Math.max(max[axis],v);}
  return{min,max,center:max.map((value,axis)=>(value+min[axis])/2)};
}
function localize(mesh,center){
  const positions=mesh.positions.slice();
  for(let i=0;i<positions.length;i+=3){positions[i]-=center[0];positions[i+1]-=center[1];positions[i+2]-=center[2];}
  return{...mesh,positions};
}
function connectedComponents(part){
  const {positions,normals,indices}=part.mesh,positionIds=new Map(),geometricOf=new Int32Array(positions.length/3);let count=0;
  for(let i=0;i<positions.length/3;i++){
    const key=`${positions[i*3]},${positions[i*3+1]},${positions[i*3+2]}`;
    let id=positionIds.get(key);if(id===undefined){id=count++;positionIds.set(key,id);}geometricOf[i]=id;
  }
  const parent=Int32Array.from({length:count},(_,i)=>i);
  const find=input=>{let x=input;while(parent[x]!==x){parent[x]=parent[parent[x]];x=parent[x];}return x;};
  const union=(a,b)=>{a=find(a);b=find(b);if(a!==b)parent[b]=a;};
  for(let i=0;i<indices.length;i+=3){const a=geometricOf[indices[i]],b=geometricOf[indices[i+1]],c=geometricOf[indices[i+2]];union(a,b);union(b,c);}
  const groups=new Map();
  for(let i=0;i<indices.length;i+=3){const root=find(geometricOf[indices[i]]);let triangles=groups.get(root);if(!triangles){triangles=[];groups.set(root,triangles);}triangles.push(i);}
  return[...groups.values()].map(triangles=>{
    const p=[],n=[],idx=[];let out=0;
    for(const triangle of triangles)for(let corner=0;corner<3;corner++){
      const source=indices[triangle+corner];p.push(positions[source*3],positions[source*3+1],positions[source*3+2]);n.push(normals[source*3],normals[source*3+1],normals[source*3+2]);idx.push(out++);
    }
    return{kind:'triangle-mesh',positions:p,normals:n,indices:idx};
  });
}
function windowId(center){
  const z=center[2];if(Math.abs(z)<.1)return center[0]>.2?'windshield-front':'windshield-rear';
  const side=z<0?'left':'right';if(center[0]>0)return`window-front-${side}`;if(center[0]<-1)return`window-quarter-${side}`;return`window-rear-${side}`;
}
const ids={
  'Body-RearLight':'rear-lights','Body-Transparent':'transparent-lenses','Body-Exhaust':'exhaust','Body-Plastic':'plastic-trim',
  'Body-DayLights':'day-lights','Body-RedPart':'red-reflectors','Cylinder-Rims':'front-wheel-hardware','Cylinder.001-Rims':'rear-wheel-hardware',
  'Wheel_FL-Rims':'rim-front-left','Wheel_FL-Tires':'tire-front-left','Wheel_FR-Rims':'rim-front-right','Wheel_FR-Tires':'tire-front-right',
  'Wheel_RL-Rims':'rim-rear-left','Wheel_RL-Tires':'tire-rear-left','Wheel_RR-Rims':'rim-rear-right','Wheel_RR-Tires':'tire-rear-right',
};
const logical=[];
for(const part of asset.parts){
  if(part.name==='Body-CarPaint')continue;
  if(part.name==='Body-Window'||part.name==='Body-Mirror'){
    for(const component of connectedComponents(part)){
      const center=bounds(component).center,id=part.name==='Body-Window'?windowId(center):(center[2]<0?'mirror-left':'mirror-right');
      logical.push({id,sourceName:part.name,sourceMaterial:part.material,wheel:false,center,mesh:localize(component,center)});
    }
  }else logical.push({id:ids[part.name]??part.name,sourceName:part.name,sourceMaterial:part.material,wheel:!!part.wheel,center:part.center,mesh:part.mesh});
}

function octEncode(input){
  let[x,y,z]=input;const length=Math.abs(x)+Math.abs(y)+Math.abs(z)||1;x/=length;y/=length;z/=length;
  if(z<0){const ox=x,oy=y;x=(1-Math.abs(oy))*Math.sign(ox||1);y=(1-Math.abs(ox))*Math.sign(oy||1);}
  return[Math.max(0,Math.min(255,Math.round((x*.5+.5)*255))),Math.max(0,Math.min(255,Math.round((y*.5+.5)*255)))];
}
function u16Bytes(values){const bytes=new Uint8Array(values.length*2),view=new DataView(bytes.buffer);for(let i=0;i<values.length;i++)view.setUint16(i*2,values[i],true);return bytes;}
const b64=bytes=>Buffer.from(bytes).toString('base64');
function pack(mesh){
  const vertices=[],map=new Map(),remap=new Uint16Array(mesh.positions.length/3);
  for(let i=0;i<remap.length;i++){
    const position=mesh.positions.slice(i*3,i*3+3),normal=mesh.normals.slice(i*3,i*3+3),key=position.join(',')+'|'+normal.join(',');
    let index=map.get(key);if(index===undefined){index=vertices.length;if(index>65535)throw new RangeError('M3 part exceeds uint16 vertex budget');map.set(key,index);vertices.push({position,normal});}remap[i]=index;
  }
  const indices=Uint16Array.from(mesh.indices.map(index=>remap[index])),min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
  for(const {position} of vertices)for(let axis=0;axis<3;axis++){min[axis]=Math.min(min[axis],position[axis]);max[axis]=Math.max(max[axis],position[axis]);}
  const span=min.map((value,axis)=>max[axis]-value),positions=new Uint16Array(vertices.length*3),normals=new Uint8Array(vertices.length*2);
  for(let i=0;i<vertices.length;i++){
    for(let axis=0;axis<3;axis++)positions[i*3+axis]=span[axis]===0?0:Math.round((vertices[i].position[axis]-min[axis])/span[axis]*65535);
    const oct=octEncode(vertices[i].normal);normals[i*2]=oct[0];normals[i*2+1]=oct[1];
  }
  return{min,max,vertices:vertices.length,triangles:indices.length/3,positionsU16Base64:b64(u16Bytes(positions)),normalsOct8Base64:b64(normals),indicesU16Base64:b64(u16Bytes(indices)),bytes:positions.byteLength+normals.byteLength+indices.byteLength};
}

const geometryBySignature=new Map(),geometries=[];
for(const part of logical){
  const signature=JSON.stringify([part.mesh.positions,part.mesh.normals,part.mesh.indices]);let key=geometryBySignature.get(signature);
  if(!key){key=`g${geometries.length}`;geometryBySignature.set(signature,key);geometries.push({key,mesh:part.mesh});}part.geometry=key;
}
const packed=Object.fromEntries(geometries.map(({key,mesh})=>[key,pack(mesh)])),nonBodyPayloadBytes=Object.values(packed).reduce((sum,item)=>sum+item.bytes,0);
const fidelity={sourceFbxBytes:241628,previousExpandedJsonBytes:1194172,sourceParts:19,sourceTriangles:9798,retainedVisualParts:logical.length+1,uniquePackedPartMeshes:geometries.length+1,nonBodyPayloadBytes,bodyPayloadBytes:13244,totalPackedPayloadBytes:nonBodyPayloadBytes+13244};
for(const item of Object.values(packed))delete item.bytes;
const geometryCode=Object.entries(packed).map(([key,item])=>`  ${key}:Object.freeze({min:${JSON.stringify(item.min)} as const,max:${JSON.stringify(item.max)} as const,vertices:${item.vertices},triangles:${item.triangles},positionsU16Base64:'${item.positionsU16Base64}',normalsOct8Base64:'${item.normalsOct8Base64}',indicesU16Base64:'${item.indicesU16Base64}'})`).join(',\n');
const sources=logical.map(part=>`  Object.freeze({id:${JSON.stringify(part.id)},sourceName:${JSON.stringify(part.sourceName)},sourceMaterial:${JSON.stringify(part.sourceMaterial)},wheel:${part.wheel},center:${JSON.stringify(part.center)} as const,geometry:${JSON.stringify(part.geometry)}})`).join(',\n');
const code=`import {decodePackedShell,type PackedShell} from './packed-shell.js';

export interface M3FbxPartSource {
  readonly id:string;
  readonly sourceName:string;
  readonly sourceMaterial:string;
  readonly wheel:boolean;
  readonly center:readonly [number,number,number];
  readonly geometry:string;
}

export const M3_FBX_PARTS_FIDELITY=Object.freeze(${JSON.stringify(fidelity,null,2)});

const GEOMETRY:Readonly<Record<string,PackedShell>>=Object.freeze({
${geometryCode}
});

export const M3_FBX_PART_SOURCES:readonly M3FbxPartSource[]=Object.freeze([
${sources}
]);

const cache=new Map<string,ReturnType<typeof decodePackedShell>>();
function geometry(key:string){
  let mesh=cache.get(key);
  if(!mesh){const packed=GEOMETRY[key];if(!packed)throw new TypeError(\`Unknown M3 packed geometry \${key}\`);mesh=decodePackedShell(packed);cache.set(key,mesh);}
  return mesh;
}

export function m3FbxParts(){return M3_FBX_PART_SOURCES.map(part=>Object.freeze({...part,mesh:geometry(part.geometry)}));}
`;
await writeFile(output,code);
console.log(JSON.stringify({...fidelity,input,output},null,2));
