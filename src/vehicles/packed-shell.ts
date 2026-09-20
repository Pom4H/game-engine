import type {Primitive} from '../scene/types.js';
import type {Vec3} from '../math.js';

export interface PackedShell {
  readonly min:Vec3;
  readonly max:Vec3;
  readonly positionsU16Base64:string;
  readonly indicesU16Base64:string;
  readonly vertices:number;
  readonly triangles:number;
}

function decodeU16(base64:string):Uint16Array{
  const raw=atob(base64),bytes=new Uint8Array(raw.length);
  for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);
  if(bytes.byteLength%2)throw new RangeError('Packed shell uint16 payload is misaligned');
  const out=new Uint16Array(bytes.byteLength/2),view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  for(let i=0;i<out.length;i++)out[i]=view.getUint16(i*2,true);
  return out;
}

export function decodePackedShell(shell:PackedShell):Extract<Primitive,{kind:'triangle-mesh'}>{
  const q=decodeU16(shell.positionsU16Base64),indices=[...decodeU16(shell.indicesU16Base64)];
  if(q.length!==shell.vertices*3||indices.length!==shell.triangles*3)throw new RangeError('Packed shell count mismatch');
  const scale:[number,number,number]=[
    (shell.max[0]-shell.min[0])/65535,
    (shell.max[1]-shell.min[1])/65535,
    (shell.max[2]-shell.min[2])/65535,
  ];
  const positions=Array<number>(q.length);
  for(let i=0;i<q.length;i++){const axis=(i%3) as 0|1|2;positions[i]=shell.min[axis]+q[i]!*scale[axis];}
  const normals=Array<number>(positions.length).fill(0);
  for(let i=0;i<indices.length;i+=3){
    const ia=indices[i]!*3,ib=indices[i+1]!*3,ic=indices[i+2]!*3;
    if(ic+2>=positions.length)throw new RangeError('Packed shell index out of range');
    const ax=positions[ia]!,ay=positions[ia+1]!,az=positions[ia+2]!,bx=positions[ib]!,by=positions[ib+1]!,bz=positions[ib+2]!,cx=positions[ic]!,cy=positions[ic+1]!,cz=positions[ic+2]!;
    const ux=bx-ax,uy=by-ay,uz=bz-az,vx=cx-ax,vy=cy-ay,vz=cz-az,nx=uy*vz-uz*vy,ny=uz*vx-ux*vz,nz=ux*vy-uy*vx;
    for(const base of [ia,ib,ic]){normals[base]=normals[base]!+nx;normals[base+1]=normals[base+1]!+ny;normals[base+2]=normals[base+2]!+nz;}
  }
  for(let i=0;i<normals.length;i+=3){
    const length=Math.hypot(normals[i]!,normals[i+1]!,normals[i+2]!)||1;
    normals[i]=normals[i]!/length;normals[i+1]=normals[i+1]!/length;normals[i+2]=normals[i+2]!/length;
  }
  return{kind:'triangle-mesh',positions,normals,indices};
}
