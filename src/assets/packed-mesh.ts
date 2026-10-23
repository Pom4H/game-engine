import type {Primitive} from '../scene/types.js';
import type {Vec3} from '../math.js';

export interface PackedMesh {
  readonly min:Vec3;
  readonly max:Vec3;
  readonly positionsU16Base64:string;
  readonly normalsOct8Base64?:string;
  readonly colorsRGBA8Base64?:string;
  readonly uvsF32Base64?:string;
  readonly variationSeedsF32Base64?:string;
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
function encodeBytes(bytes:Uint8Array):string{
  let binary='';const chunk=0x8000;
  for(let i=0;i<bytes.length;i+=chunk)binary+=String.fromCharCode(...bytes.subarray(i,Math.min(bytes.length,i+chunk)));
  return btoa(binary);
}
function encodeU16(values:readonly number[]):string{
  const bytes=new Uint8Array(values.length*2),view=new DataView(bytes.buffer);
  for(let i=0;i<values.length;i++)view.setUint16(i*2,values[i]!,true);
  return encodeBytes(bytes);
}
function encodeU32(values:readonly number[]):string{
  const bytes=new Uint8Array(values.length*4),view=new DataView(bytes.buffer);
  for(let i=0;i<values.length;i++)view.setUint32(i*4,values[i]!,true);
  return encodeBytes(bytes);
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
    for(const base of [ia,ib,ic]){normals[base]=(normals[base]??0)+nx;normals[base+1]=(normals[base+1]??0)+ny;normals[base+2]=(normals[base+2]??0)+nz;}
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
function encodeOctNormal(x:number,y:number,z:number):readonly[number,number]{
  const length=Math.abs(x)+Math.abs(y)+Math.abs(z)||1;let ox=x/length,oy=y/length,oz=z/length;
  if(oz<0){const px=ox,py=oy;ox=(1-Math.abs(py))*Math.sign(px||1);oy=(1-Math.abs(px))*Math.sign(py||1);}
  return[Math.max(0,Math.min(255,Math.round((ox*.5+.5)*255))),Math.max(0,Math.min(255,Math.round((oy*.5+.5)*255)))];
}

/** Encode an authored triangle mesh into the compact runtime representation. */
export function encodePackedMesh(mesh:Extract<Primitive,{kind:'triangle-mesh'}>):PackedMesh{
  const vertices=mesh.positions.length/3,triangles=mesh.indices.length/3;
  if(!Number.isInteger(vertices)||vertices<3||mesh.normals.length!==mesh.positions.length||!Number.isInteger(triangles)||triangles<1)throw new RangeError('Triangle mesh arrays are inconsistent');
  const min:[number,number,number]=[Infinity,Infinity,Infinity],max:[number,number,number]=[-Infinity,-Infinity,-Infinity];
  for(let i=0;i<mesh.positions.length;i++){const value=mesh.positions[i]!;if(!Number.isFinite(value))throw new RangeError('Triangle mesh position is not finite');const axis=(i%3) as 0|1|2;min[axis]=Math.min(min[axis],value);max[axis]=Math.max(max[axis],value);}
  const quantized=Array<number>(mesh.positions.length);
  for(let i=0;i<mesh.positions.length;i++){const axis=(i%3) as 0|1|2,span=max[axis]-min[axis],value=span>0?(mesh.positions[i]!-min[axis])/span:0;quantized[i]=Math.max(0,Math.min(65535,Math.round(value*65535)));}
  const normalBytes=new Uint8Array(vertices*2);
  for(let vertex=0;vertex<vertices;vertex++){const base=vertex*3,x=mesh.normals[base]!,y=mesh.normals[base+1]!,z=mesh.normals[base+2]!;if(!Number.isFinite(x)||!Number.isFinite(y)||!Number.isFinite(z))throw new RangeError('Triangle mesh normal is not finite');const packed=encodeOctNormal(x,y,z);normalBytes[vertex*2]=packed[0];normalBytes[vertex*2+1]=packed[1];}
  let colorBytes:Uint8Array|undefined;
  if(mesh.colors){if(mesh.colors.length!==vertices*4)throw new RangeError('Triangle mesh color count mismatch');colorBytes=new Uint8Array(vertices*4);for(let i=0;i<mesh.colors.length;i++){const value=mesh.colors[i]!;if(!Number.isFinite(value)||value<0||value>1)throw new RangeError('Triangle mesh color is outside [0,1]');colorBytes[i]=Math.round(value*255);}}
  let uvBytes:Uint8Array|undefined;
  if(mesh.uvs){if(mesh.uvs.length!==vertices*2||!mesh.uvs.every(Number.isFinite))throw new RangeError('Triangle mesh UV count/values invalid');uvBytes=new Uint8Array(vertices*8);const view=new DataView(uvBytes.buffer);for(let i=0;i<mesh.uvs.length;i++){view.setFloat32(i*4,mesh.uvs[i]!,true);if(!Number.isFinite(view.getFloat32(i*4,true)))throw new RangeError('Triangle mesh UV outside float32');}}
  let seedBytes:Uint8Array|undefined;
  if(mesh.variationSeeds){if(mesh.variationSeeds.length!==vertices||!mesh.variationSeeds.every(n=>Number.isFinite(Math.fround(n))))throw new RangeError('Triangle mesh variation seed count/values invalid');seedBytes=new Uint8Array(vertices*4);const view=new DataView(seedBytes.buffer);for(let i=0;i<vertices;i++)view.setFloat32(i*4,mesh.variationSeeds[i]!,true);}
  let needsU32=vertices>65535;
  for(const index of mesh.indices){if(!Number.isInteger(index)||index<0||index>=vertices)throw new RangeError('Triangle mesh index out of range');if(index>65535)needsU32=true;}
  return Object.freeze({
    min:Object.freeze([...min]) as Vec3,max:Object.freeze([...max]) as Vec3,
    positionsU16Base64:encodeU16(quantized),normalsOct8Base64:encodeBytes(normalBytes),...(colorBytes?{colorsRGBA8Base64:encodeBytes(colorBytes)}:{}),...(uvBytes?{uvsF32Base64:encodeBytes(uvBytes)}:{}),...(seedBytes?{variationSeedsF32Base64:encodeBytes(seedBytes)}:{}),
    ...(needsU32?{indicesU32Base64:encodeU32(mesh.indices)}:{indicesU16Base64:encodeU16(mesh.indices)}),
    vertices,triangles,
  });
}

export function decodePackedMesh(mesh:PackedMesh):Extract<Primitive,{kind:'triangle-mesh'}>{
  if(!Number.isSafeInteger(mesh.vertices)||mesh.vertices<3||!Number.isSafeInteger(mesh.triangles)||mesh.triangles<1)throw new RangeError('Packed mesh counts are invalid');
  if((mesh.indicesU16Base64?1:0)+(mesh.indicesU32Base64?1:0)!==1)throw new RangeError('Packed mesh requires exactly one index payload');
  if(mesh.vertices>65535&&mesh.indicesU16Base64)throw new RangeError('Packed mesh with more than 65535 vertices requires uint32 indices');
  const q=decodeU16(mesh.positionsU16Base64);
  const indexArray=mesh.indicesU16Base64?decodeU16(mesh.indicesU16Base64):decodeU32(mesh.indicesU32Base64!);
  const indices=[...indexArray];
  if(q.length!==mesh.vertices*3||indices.length!==mesh.triangles*3)throw new RangeError('Packed mesh count mismatch');
  for(let axis=0;axis<3;axis++){const min=mesh.min[axis]!,max=mesh.max[axis]!;if(!Number.isFinite(min)||!Number.isFinite(max)||max<min)throw new RangeError('Packed mesh bounds are invalid');}
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
  let colors:number[]|undefined;
  if(mesh.colorsRGBA8Base64){const packed=decodeBytes(mesh.colorsRGBA8Base64);if(packed.length!==mesh.vertices*4)throw new RangeError('Packed mesh color count mismatch');colors=Array.from(packed,value=>value/255);}
  let uvs:number[]|undefined;
  if(mesh.uvsF32Base64!==undefined){const bytes=decodeBytes(mesh.uvsF32Base64);if(bytes.length!==mesh.vertices*8)throw new RangeError('Packed mesh UV count mismatch');const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);uvs=Array.from({length:mesh.vertices*2},(_,i)=>view.getFloat32(i*4,true));if(!uvs.every(Number.isFinite))throw new RangeError('Packed mesh UV is nonfinite');}
  let variationSeeds:number[]|undefined;
  if(mesh.variationSeedsF32Base64!==undefined){const bytes=decodeBytes(mesh.variationSeedsF32Base64);if(bytes.length!==mesh.vertices*4)throw new RangeError('Packed mesh variation seed count mismatch');const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);variationSeeds=Array.from({length:mesh.vertices},(_,i)=>view.getFloat32(i*4,true));if(!variationSeeds.every(Number.isFinite))throw new RangeError('Packed mesh variation seed is nonfinite');}
  return{kind:'triangle-mesh',positions,normals,indices,...(variationSeeds?{variationSeeds}:{}),...(colors?{colors}: {}),...(uvs?{uvs}:{})};
}
