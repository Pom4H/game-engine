import type {Primitive} from '../scene/types.js';
import type {Vec3} from '../math.js';

export interface PackedMesh {
  readonly min:Vec3;
  readonly max:Vec3;
  readonly positionsU16Base64:string;
  readonly normalsOct8Base64?:string;
  readonly indicesU16Base64?:string;
  readonly indicesU32Base64?:string;
  readonly vertices:number;
  readonly triangles:number;
}

function decodeBytes(base64:string):Uint8Array{
  const raw=atob(base64),bytes=new Uint8Array(raw.length);
  for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);
  return bytes;
}
function decodeU16(base64:string):Uint16Array{
  const bytes=decodeBytes(base64);
  if(bytes.byteLength%2)throw new RangeError('Packed mesh uint16 payload is misaligned');
  const out=new Uint16Array(bytes.byteLength/2),view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  for(let i=0;i<out.length;i++)out[i]=view.getUint16(i*2,true);
  return out;
}
function decodeU32(base64:string):Uint32Array{
  const bytes=decodeBytes(base64);
  if(bytes.byteLength%4)throw new RangeError('Packed mesh uint32 payload is misaligned');
  const out=new Uint32Array(bytes.byteLength/4),view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  for(let i=0;i<out.length;i++)out[i]=view.getUint32(i*4,true);
  return out;
}
function octNormal(xByte:number,yByte:number):[number,number,number]{
  let x=xByte/255*2-1,y=yByte/255*2-1,z=1-Math.abs(x)-Math.abs(y);
  if(z<0){const ox=x,oy=y;x=(1-Math.abs(oy))*Math.sign(ox||1);y=(1-Math.abs(ox))*Math.sign(oy||1);}
  const length=Math.hypot(x,y,z)||1;return[x/length,y/length,z/length];
}
function recomputeNormals(positions:readonly number[],indices:readonly number[]):number[]{
  const normals=Array<number>(positions.length).fill(0);
  for(let i=0;i<indices.length;i+=3){
    const ia=indices[i]!*3,ib=indices[i+1]!*3,ic=indices[i+2]!*3;
    const ax=positions[ia]!,ay=positions[ia+1]!,az=positions[ia+2]!,bx=positions[ib]!,by=positions[ib+1]!,bz=positions[ib+2]!,cx=positions[ic]!,cy=positions[ic+1]!,cz=positions[ic+2]!;
    const ux=bx-ax,uy=by-ay,uz=bz-az,vx=cx-ax,vy=cy-ay,vz=cz-az,nx=uy*vz-uz*vy,ny=uz*vx-ux*vz,nz=ux*vy-uy*vx;
    for(const base of [ia,ib,ic]){normals[base]!+=nx;normals[base+1]!+=ny;normals[base+2]!+=nz;}
  }
  for(let i=0;i<normals.length;i+=3){const length=Math.hypot(normals[i]!,normals[i+1]!,normals[i+2]!)||1;normals[i]!/=length;normals[i+1]!/=length;normals[i+2]!/=length;}
  return normals;
}

/**
 * Compact static triangle mesh codec used by render assets.
 * Positions are quantized independently per axis to uint16; normals use oct8.
 * Large visual assets may switch only the index stream to uint32 without changing
 * the scene/runtime representation.
 */
export function decodePackedMesh(mesh:PackedMesh):Extract<Primitive,{kind:'triangle-mesh'}>{
  if(!Number.isSafeInteger(mesh.vertices)||mesh.vertices<3||!Number.isSafeInteger(mesh.triangles)||mesh.triangles<1)throw new RangeError('Packed mesh counts are invalid');
  if((mesh.indicesU16Base64?1:0)+(mesh.indicesU32Base64?1:0)!==1)throw new RangeError('Packed mesh requires exactly one index payload');
  if(mesh.vertices>65535&&mesh.indicesU16Base64)throw new RangeError('Packed mesh with more than 65535 vertices requires uint32 indices');
  const q=decodeU16(mesh.positionsU16Base64);
  const indexArray=mesh.indicesU16Base64?decodeU16(mesh.indicesU16Base64):decodeU32(mesh.indicesU32Base64!);
  const indices=[...indexArray];
  if(q.length!==mesh.vertices*3||indices.length!==mesh.triangles*3)throw new RangeError('Packed mesh count mismatch');
  for(let axis=0;axis<3;axis++)if(!Number.isFinite(mesh.min[axis])||!Number.isFinite(mesh.max[axis])||mesh.max[axis]<mesh.min[axis])throw new RangeError('Packed mesh bounds are invalid');
  const scale:[number,number,number]=[
    (mesh.max[0]-mesh.min[0])/65535,
    (mesh.max[1]-mesh.min[1])/65535,
    (mesh.max[2]-mesh.min[2])/65535,
  ];
  const positions=Array<number>(q.length);
  for(let i=0;i<q.length;i++){const axis=(i%3) as 0|1|2;positions[i]=mesh.min[axis]+q[i]!*scale[axis];}
  for(const index of indices)if(index<0||index>=mesh.vertices)throw new RangeError('Packed mesh index out of range');
  let normals:number[];
  if(mesh.normalsOct8Base64){
    const packed=decodeBytes(mesh.normalsOct8Base64);
    if(packed.length!==mesh.vertices*2)throw new RangeError('Packed mesh normal count mismatch');
    normals=Array<number>(positions.length);
    for(let vertex=0;vertex<mesh.vertices;vertex++){const n=octNormal(packed[vertex*2]!,packed[vertex*2+1]!),base=vertex*3;normals[base]=n[0];normals[base+1]=n[1];normals[base+2]=n[2];}
  }else normals=recomputeNormals(positions,indices);
  return{kind:'triangle-mesh',positions,normals,indices};
}
