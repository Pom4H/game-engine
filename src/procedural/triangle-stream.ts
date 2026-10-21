import type {Primitive} from '../scene/types.js';
import type {MeshData} from './mesh.js';
import type {MeshBounds} from '../render/visibility.js';

/** Explicit live render resource, not an immutable authored triangle mesh. */
export interface TriangleStreamPrimitive {readonly kind:'triangle-stream';readonly capacityTriangles:number;readonly triangleCount:number;readonly revision:number}
export interface AggregateTriangleStream {
 readonly primitive:TriangleStreamPrimitive;
 readonly capacityTriangles:number;
 readonly triangleCount:number;
 readonly revision:number;
 /** Copy/validate at most capacityTriangles*18 packed F32 scalars. A page is
  * capped at 20000 triangles. No source view is retained. Empty prefixes work. */
 update(vertices:Float32Array,vertexCount:number):void;
 /** Prepare a replacement bank without publishing. Stage every page first,
  * then commit its fixed-work tickets in one synchronous cohort publication. */
 stage(vertices:Float32Array,vertexCount:number):TriangleStreamUpdate;
 /** Borrow a stable source prefix until ready/dispose. Each step validates and
  * copies OR uploads at most 64 KiB; no partial replacement becomes visible. */
 prepareUpdate(vertices:Float32Array,vertexCount:number):TriangleStreamUpdatePreparation;
 dispose():void;
}
export interface TriangleStreamUpdate {commit():void;dispose():void}
export interface TriangleStreamUpdatePreparation extends TriangleStreamUpdate {
 readonly ready:boolean;
 /** One bounded copy or upload block, or a nonblocking GPU error-ACK poll. */
 step(maxBytes?:number):boolean;
}
export interface TriangleStreamState {
 key:string;primitive:TriangleStreamPrimitive;capacity:number;color:readonly[number,number,number,number];
 active:Float32Array|undefined;staging:Float32Array|undefined;count:number;revision:number;
 bounds:MeshBounds&{center:[number,number,number];half:[number,number,number]};ready:boolean;disposed:boolean;
}
const states=new WeakMap<object,TriangleStreamState>();let serial=0;
const get=Function.call.bind(WeakMap.prototype.get,states) as(value:object)=>TriangleStreamState|undefined;
const put=Function.call.bind(WeakMap.prototype.set,states) as(value:object,state:TriangleStreamState)=>void;
export function triangleStreamState(value:unknown):TriangleStreamState|undefined{return value!==null&&typeof value==='object'?get(value):undefined;}
export function isTriangleStream(value:unknown):value is TriangleStreamPrimitive{return triangleStreamState(value)!==undefined;}
export function triangleStreamRevision(value:unknown):number{return triangleStreamState(value)?.revision??0;}
export function createTriangleStreamState(capacity:number,color:readonly[number,number,number,number]):TriangleStreamState{
 if(!Number.isSafeInteger(capacity)||capacity<1||capacity>20000)throw new RangeError('Triangle stream page requires 1..20000 triangles');
 if(color.length!==4)throw new TypeError('Triangle stream requires four byte color channels');
 const rgba:[number,number,number,number]=[color[0],color[1],color[2],color[3]];
 for(const channel of rgba)if(!Number.isInteger(channel)||channel<0||channel>255)throw new TypeError('Triangle stream color must contain bytes');
 const state:TriangleStreamState={key:'triangle-stream:'+ ++serial,primitive:null!,capacity,color:Object.freeze(rgba),active:undefined,staging:undefined,count:0,revision:0,bounds:{center:[0,0,0],half:[0,0,0]},ready:false,disposed:false};
 const primitive:TriangleStreamPrimitive=Object.freeze({kind:'triangle-stream',capacityTriangles:capacity,get triangleCount(){return state.count;},get revision(){return state.revision;}});
 state.primitive=primitive;put(primitive,state);return state;
}
export function triangleStreamMesh(value:TriangleStreamPrimitive):MeshData{
 const state=get(value);if(!state||state.disposed||!state.ready)throw new Error('Triangle stream is not resident');
 const count=state.count*3,vertices=new Float32Array(count*6),colors=new Uint8Array(count*4),uvs=new Float32Array(count*2),variationSeeds=new Float32Array(count),indices=new Uint16Array(count);
 for(let i=0;i<count*6;i++)vertices[i]=state.active![i]!;
 for(let i=0;i<count;i++){for(let c=0;c<4;c++)colors[i*4+c]=state.color[c]!;uvs[i*2]=i%3===1?1:0;uvs[i*2+1]=i%3===2?1:0;indices[i]=i;}
 return{vertices,colors,uvs,variationSeeds,indices,indexFormat:'uint16'};
}
/** Public pure frame snapshots never expose the renderer's changing handle.
 * An empty stream has no render object and therefore no authored mesh snapshot. */
export function triangleStreamSnapshot(value:TriangleStreamPrimitive):Primitive|undefined{
 const mesh=triangleStreamMesh(value);if(!mesh.indices.length)return undefined;
 const positions:number[]=[],normals:number[]=[],colors:number[]=[],uvs:number[]=[],indices:number[]=[],seeds:number[]=[];
 for(let i=0;i<mesh.indices.length;i++){for(let c=0;c<3;c++){positions.push(mesh.vertices[i*6+c]!);normals.push(mesh.vertices[i*6+3+c]!);}for(let c=0;c<4;c++)colors.push(mesh.colors[i*4+c]!/255);uvs.push(mesh.uvs![i*2]!,mesh.uvs![i*2+1]!);indices.push(i);seeds.push(0);}
 return Object.freeze({kind:'triangle-mesh',positions:Object.freeze(positions),normals:Object.freeze(normals),indices:Object.freeze(indices),colors:Object.freeze(colors),uvs:Object.freeze(uvs),variationSeeds:Object.freeze(seeds)});
}
