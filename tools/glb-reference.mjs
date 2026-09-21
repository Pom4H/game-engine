import {createHash} from 'node:crypto';

const componentBytes={5120:1,5121:1,5122:2,5123:2,5125:4,5126:4};
const components={SCALAR:1,VEC2:2,VEC3:3,VEC4:4,MAT2:4,MAT3:9,MAT4:16};
const raw=(dv,o,t)=>t===5120?dv.getInt8(o):t===5121?dv.getUint8(o):t===5122?dv.getInt16(o,true):t===5123?dv.getUint16(o,true):t===5125?dv.getUint32(o,true):dv.getFloat32(o,true);
const normalized=(v,t)=>t===5120?Math.max(-1,v/127):t===5121?v/255:t===5122?Math.max(-1,v/32767):t===5123?v/65535:t===5125?v/4294967295:v;
const identity=()=>[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
const mul=(a,b)=>{const o=Array(16).fill(0);for(let c=0;c<4;c++)for(let r=0;r<4;r++)for(let k=0;k<4;k++)o[c*4+r]+=a[k*4+r]*b[c*4+k];return o;};
const trs=(n)=>{if(n.matrix)return n.matrix;const t=n.translation||[0,0,0],s=n.scale||[1,1,1],q=n.rotation||[0,0,0,1],[x,y,z,w]=q,xx=x*x,yy=y*y,zz=z*z,xy=x*y,xz=x*z,yz=y*z,wx=w*x,wy=w*y,wz=w*z;return[(1-2*(yy+zz))*s[0],2*(xy+wz)*s[0],2*(xz-wy)*s[0],0,2*(xy-wz)*s[1],(1-2*(xx+zz))*s[1],2*(yz+wx)*s[1],0,2*(xz+wy)*s[2],2*(yz-wx)*s[2],(1-2*(xx+yy))*s[2],0,t[0],t[1],t[2],1];};
const point=(m,p)=>[m[0]*p[0]+m[4]*p[1]+m[8]*p[2]+m[12],m[1]*p[0]+m[5]*p[1]+m[9]*p[2]+m[13],m[2]*p[0]+m[6]*p[1]+m[10]*p[2]+m[14]];
const enginePoint=([x,y,z])=>[z,y,x];

export async function loadGLBReference(url){
 const response=await fetch(url);if(!response.ok)throw new Error(`fetch ${response.status} ${response.statusText}`);
 const bytes=new Uint8Array(await response.arrayBuffer()),view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
 if(view.getUint32(0,true)!==0x46546c67||view.getUint32(4,true)!==2)throw new Error('Expected glTF 2.0 GLB');
 let offset=12,json,bin;
 while(offset<bytes.length){const length=view.getUint32(offset,true),type=view.getUint32(offset+4,true),data=bytes.subarray(offset+8,offset+8+length);offset+=8+length;if(type===0x4e4f534a)json=JSON.parse(new TextDecoder().decode(data).replace(/\0+$/,''));else if(type===0x004e4942)bin=data;}
 if(!json||!bin)throw new Error('GLB must contain JSON and BIN chunks');
 const dv=new DataView(bin.buffer,bin.byteOffset,bin.byteLength);
 const accessor=(index)=>{
   const a=json.accessors[index],bv=json.bufferViews[a.bufferView],n=components[a.type],b=componentBytes[a.componentType],stride=bv.byteStride||n*b,start=(bv.byteOffset||0)+(a.byteOffset||0),out=[];
   for(let i=0;i<a.count;i++){const row=[];for(let c=0;c<n;c++){const v=raw(dv,start+i*stride+c*b,a.componentType);row.push(a.normalized?normalized(v,a.componentType):v);}out.push(row);}return out;
 };
 const primitives=[];
 const visit=(index,parent)=>{
   const node=json.nodes[index],world=mul(parent,trs(node));
   if(node.mesh!==undefined){const mesh=json.meshes[node.mesh];for(let pi=0;pi<mesh.primitives.length;pi++){const primitive=mesh.primitives[pi];if((primitive.mode??4)!==4||primitive.attributes.POSITION===undefined)continue;const positions=accessor(primitive.attributes.POSITION).map(v=>enginePoint(point(world,v))),rawIndices=primitive.indices===undefined?positions.map((_,i)=>[i]):accessor(primitive.indices),indices=rawIndices.map(v=>v[0]);primitives.push({node:node.name??`node-${index}`,mesh:mesh.name??`mesh-${node.mesh}`,primitive:pi,material:primitive.material===undefined?null:(json.materials?.[primitive.material]?.name??`material-${primitive.material}`),positions,indices});}}
   for(const child of node.children||[])visit(child,world);
 };
 const roots=json.scenes?.[json.scene??0]?.nodes??json.nodes.map((_,i)=>i).filter(i=>!json.nodes.some(n=>n.children?.includes(i)));
 for(const root of roots)visit(root,identity());
 return{url,bytes,sha256:createHash('sha256').update(bytes).digest('hex'),json,primitives};
}
export function mergeReferenceSurface(reference,predicate=()=>true){
 const positions=[],indices=[];let triangles=0;
 for(const p of reference.primitives.filter(predicate)){const base=positions.length/3;for(const v of p.positions)positions.push(...v);for(const index of p.indices)indices.push(base+index);triangles+=p.indices.length/3;}
 return{positions,indices,triangles};
}
export function referenceReport(reference){
 const lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity],records=[];let totalTriangles=0;
 for(const p of reference.primitives){const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];for(const v of p.positions)for(let a=0;a<3;a++){min[a]=Math.min(min[a],v[a]);max[a]=Math.max(max[a],v[a]);lo[a]=Math.min(lo[a],v[a]);hi[a]=Math.max(hi[a],v[a]);}const triangles=p.indices.length/3;totalTriangles+=triangles;records.push({node:p.node,mesh:p.mesh,primitive:p.primitive,material:p.material,vertices:p.positions.length,triangles,bounds:{min,max}});}
 return{url:reference.url,bytes:reference.bytes.length,sha256:reference.sha256,asset:reference.json.asset,extensionsUsed:reference.json.extensionsUsed??[],nodes:reference.json.nodes.length,meshes:reference.json.meshes?.length??0,materials:(reference.json.materials??[]).map(m=>m.name??null),animations:(reference.json.animations??[]).map(a=>a.name??null),totalTriangles,bounds:{min:lo,max:hi,size:hi.map((v,i)=>v-lo[i])},records};
}
