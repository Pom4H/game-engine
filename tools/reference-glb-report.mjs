import fs from 'node:fs/promises';

const url=process.env.REFERENCE_GLB_URL||process.argv[2];
if(!url)throw new Error('REFERENCE_GLB_URL or URL argument required');
const response=await fetch(url);if(!response.ok)throw new Error(`fetch ${response.status} ${response.statusText}`);
const bytes=new Uint8Array(await response.arrayBuffer());
const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
if(view.getUint32(0,true)!==0x46546c67||view.getUint32(4,true)!==2)throw new Error('Expected glTF 2.0 GLB');
let offset=12,json,bin;
while(offset<bytes.length){const length=view.getUint32(offset,true),type=view.getUint32(offset+4,true),data=bytes.subarray(offset+8,offset+8+length);offset+=8+length;if(type===0x4e4f534a)json=JSON.parse(new TextDecoder().decode(data).replace(/\0+$/,''));else if(type===0x004e4942)bin=data;}
if(!json||!bin)throw new Error('GLB must contain JSON and BIN chunks');
const size={5120:1,5121:1,5122:2,5123:2,5125:4,5126:4};
const comps={SCALAR:1,VEC2:2,VEC3:3,VEC4:4,MAT2:4,MAT3:9,MAT4:16};
const read=(dv,o,t)=>t===5120?dv.getInt8(o):t===5121?dv.getUint8(o):t===5122?dv.getInt16(o,true):t===5123?dv.getUint16(o,true):t===5125?dv.getUint32(o,true):dv.getFloat32(o,true);
const accessor=(index)=>{
 const a=json.accessors[index],bv=json.bufferViews[a.bufferView],n=comps[a.type],b=size[a.componentType],stride=bv.byteStride||n*b,start=(bv.byteOffset||0)+(a.byteOffset||0),dv=new DataView(bin.buffer,bin.byteOffset,bin.byteLength),out=[];
 for(let i=0;i<a.count;i++){const row=[];for(let c=0;c<n;c++)row.push(read(dv,start+i*stride+c*b,a.componentType));out.push(row);}return out;
};
const identity=()=>[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
const mul=(a,b)=>{const o=Array(16).fill(0);for(let c=0;c<4;c++)for(let r=0;r<4;r++)for(let k=0;k<4;k++)o[c*4+r]+=a[k*4+r]*b[c*4+k];return o;};
const trs=(n)=>{if(n.matrix)return n.matrix;const t=n.translation||[0,0,0],s=n.scale||[1,1,1],q=n.rotation||[0,0,0,1],[x,y,z,w]=q,xx=x*x,yy=y*y,zz=z*z,xy=x*y,xz=x*z,yz=y*z,wx=w*x,wy=w*y,wz=w*z;return[(1-2*(yy+zz))*s[0],2*(xy+wz)*s[0],2*(xz-wy)*s[0],0,2*(xy-wz)*s[1],(1-2*(xx+zz))*s[1],2*(yz+wx)*s[1],0,2*(xz+wy)*s[2],2*(yz-wx)*s[2],(1-2*(xx+yy))*s[2],0,t[0],t[1],t[2],1];};
const point=(m,p)=>[m[0]*p[0]+m[4]*p[1]+m[8]*p[2]+m[12],m[1]*p[0]+m[5]*p[1]+m[9]*p[2]+m[13],m[2]*p[0]+m[6]*p[1]+m[10]*p[2]+m[14]];
const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity],records=[];let totalTriangles=0;
const visit=(index,parent)=>{
 const node=json.nodes[index],world=mul(parent,trs(node));
 if(node.mesh!==undefined){const mesh=json.meshes[node.mesh];for(let pi=0;pi<mesh.primitives.length;pi++){const p=mesh.primitives[pi];if((p.mode??4)!==4||p.attributes.POSITION===undefined)continue;const positions=accessor(p.attributes.POSITION).map(v=>point(world,v));const indices=p.indices===undefined?positions.map((_,i)=>[i]):accessor(p.indices);const triangles=Math.floor(indices.length/3);totalTriangles+=triangles;const lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];for(const v of positions)for(let a=0;a<3;a++){lo[a]=Math.min(lo[a],v[a]);hi[a]=Math.max(hi[a],v[a]);min[a]=Math.min(min[a],v[a]);max[a]=Math.max(max[a],v[a]);}
 records.push({node:node.name??`node-${index}`,mesh:mesh.name??`mesh-${node.mesh}`,primitive:pi,material:p.material===undefined?null:(json.materials?.[p.material]?.name??`material-${p.material}`),vertices:positions.length,triangles,bounds:{min:lo,max:hi}});
 }}
 for(const child of node.children||[])visit(child,world);
};
const roots=json.scenes?.[json.scene??0]?.nodes??json.nodes.map((_,i)=>i).filter(i=>!json.nodes.some(n=>n.children?.includes(i)));
for(const root of roots)visit(root,identity());
const report={url,bytes:bytes.length,asset:json.asset,extensionsUsed:json.extensionsUsed??[],nodes:json.nodes.length,meshes:json.meshes?.length??0,materials:(json.materials??[]).map(m=>m.name??null),animations:(json.animations??[]).map(a=>a.name??null),totalTriangles,bounds:{min,max,size:max.map((v,i)=>v-min[i])},records};
console.log('GLB_REFERENCE_REPORT '+JSON.stringify(report));
if(process.env.REFERENCE_GLB_REPORT)await fs.writeFile(process.env.REFERENCE_GLB_REPORT,JSON.stringify(report,null,2));
