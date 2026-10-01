import type {MeshData} from './mesh.js';
import type {MeshBounds} from '../render/visibility.js';
/** Internal worker -> renderer packet. One owner, transferred ArrayBuffers, no JSON geometry.
 * Untrusted assets must be validated by their loader BEFORE this packet is produced. */
export interface PreparedMeshPacket {
 readonly vertices:Float32Array; readonly colors:Uint8Array; readonly indices:Uint32Array;
 readonly bounds:MeshBounds;
}
export const MAX_PREPARED_MESH_BYTES=8*1024*1024;
let serial=0;
/** Runtime-only immutable topology. Authoring/CPU views are lazy; the render path never
 * expands them, serializes vertex keys, clones geometry or calculates bounds again. */
export class PreparedMesh {
 readonly kind='triangle-mesh' as const;
 readonly key=`prepared:${++serial}`;
 readonly data:MeshData;
 readonly bounds:MeshBounds;
 readonly byteLength:number;
 private positionArray:readonly number[]|undefined;
 private normalArray:readonly number[]|undefined;
 private indexArray:readonly number[]|undefined;
 private colorArray:readonly number[]|undefined;
 constructor(packet:PreparedMeshPacket){
  const {vertices,colors,indices,bounds}=packet,bytes=vertices.byteLength+colors.byteLength+indices.byteLength;
  // Constant-sized validation of the trusted producer's transfer envelope; not a
  // substitute for content validation. Detached, shared and oversized buffers fail closed.
  if(!(vertices instanceof Float32Array)||!(colors instanceof Uint8Array)||!(indices instanceof Uint32Array)||!vertices.length||vertices.length%6||colors.length!==vertices.length/6*4||!indices.length||indices.length%3||bytes>MAX_PREPARED_MESH_BYTES||[vertices,colors,indices].some(a=>!(a.buffer instanceof ArrayBuffer))||bounds.center.length!==3||bounds.half.length!==3||![...bounds.center,...bounds.half].every(Number.isFinite)||bounds.half.some(v=>v<0))throw new RangeError('Invalid prepared mesh envelope');
  this.data={vertices,colors,indices,indexFormat:'uint32'};
  this.bounds=Object.freeze({center:Object.freeze([...bounds.center]) as MeshBounds['center'],half:Object.freeze([...bounds.half]) as MeshBounds['half']});
  this.byteLength=bytes;
 }
 get positions():readonly number[]{return this.positionArray??=Object.freeze(Array.from({length:this.data.vertices.length/2},(_,i)=>this.data.vertices[Math.floor(i/3)*6+i%3]!));}
 get normals():readonly number[]{return this.normalArray??=Object.freeze(Array.from({length:this.data.vertices.length/2},(_,i)=>this.data.vertices[Math.floor(i/3)*6+3+i%3]!));}
 get indices():readonly number[]{return this.indexArray??=Object.freeze(Array.from(this.data.indices));}
 get colors():readonly number[]{return this.colorArray??=Object.freeze(Array.from(this.data.colors,v=>v/255));}
 get expanded():boolean{return !!(this.positionArray||this.normalArray||this.indexArray||this.colorArray);}
}
