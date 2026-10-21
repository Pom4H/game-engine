import type {Primitive} from '../scene/types.js';
import type {CompactTriangleMeshInput,MeshData} from './mesh.js';
import type {MeshBounds} from '../render/visibility.js';

type Triangle=Extract<Primitive,{kind:'triangle-mesh'}>;
type Channel='positions'|'normals'|'indices'|'colors'|'uvs'|'variationSeeds';
type Bounds=readonly[number,number,number,number,number,number];
interface Numbers {length:number;blocks:Float64Array[]}
interface Storage {positions:Numbers;normals:Numbers;indices:Numbers;colors:Numbers|undefined;uvs:Numbers|undefined;variationSeeds:Numbers|undefined;bounds:Bounds}
const BLOCK_SCALARS=8192;
const owned=new WeakMap<object,Storage>();
const getOwned=Function.call.bind(WeakMap.prototype.get,owned) as(key:object)=>Storage|undefined;
const putOwned=Function.call.bind(WeakMap.prototype.set,owned) as(key:object,value:Storage)=>void;
const F64=Float64Array,F32=Float32Array,U8=Uint8Array,U16=Uint16Array,U32=Uint32Array,ArrayType=Array;
const define=Object.defineProperty,freeze=Object.freeze,dict=Object.create;
const finite=Number.isFinite,integer=Number.isInteger,safeInteger=Number.isSafeInteger,fround=Math.fround;
const names:readonly Channel[]=['positions','normals','indices','colors','uvs','variationSeeds'];
const limits=[900000,900000,1800000,1200000,600000,300000] as const;
const valueAt=(channel:Numbers,index:number):number=>channel.blocks[index>>>13]![index&8191]!;

export interface CopiedTriangleMeshPreparation {
 readonly done:boolean;
 readonly mesh:Triangle|undefined;
 /** At most maxScalars indexed reads/checks; each private allocation is <=64 KiB.
  * The caller owns stable input channels until completion/cancellation. */
 step(maxScalars:number):boolean;
 cancel():void;
}

/** Internal factory implementation. Only a completed, fully checked snapshot
 * reaches publish; no partially copied data receives an identity certificate. */
export function copiedTrianglePreparation(source:CompactTriangleMeshInput,publish:(mesh:Triangle)=>void):CopiedTriangleMeshPreparation{
 if(!source||typeof source!=='object')throw new TypeError('prepareCopiedTriangleMesh requires triangle channels');
 let input:CompactTriangleMeshInput|undefined=source,channel=0,offset=0,phase:'copy'|'indices'|'bounds'|'finished'|'cancelled'='copy',reading:ArrayLike<number>|undefined;
 let current:Numbers|undefined,stepping=false,result:Triangle|undefined;
 const channels:Record<Channel,Numbers|undefined>={positions:undefined,normals:undefined,indices:undefined,colors:undefined,uvs:undefined,variationSeeds:undefined};
 let minX=Infinity,minY=Infinity,minZ=Infinity,maxX=-Infinity,maxY=-Infinity,maxZ=-Infinity;
 const cancelled=()=>phase==='cancelled';
 const release=()=>{input=undefined;reading=undefined;current=undefined;for(let i=0;i<names.length;i++)channels[names[i]!]=undefined;};
 const fail=(error:unknown):never=>{phase='cancelled';release();throw error;};
 const finish=()=>{
  const storage:Storage={positions:channels.positions!,normals:channels.normals!,indices:channels.indices!,colors:channels.colors,uvs:channels.uvs,variationSeeds:channels.variationSeeds,bounds:freeze([minX,minY,minZ,maxX,maxY,maxZ])};
  const mesh={kind:'triangle-mesh'} as Triangle,publicArrays=dict(null) as Partial<Record<Channel,readonly number[]>>;
  for(let c=0;c<names.length;c++){
   const key=names[c]!,data=storage[key];if(data===undefined)continue;
   define(mesh,key,{enumerable:true,get(){let array=publicArrays[key];if(!array){const copy=new ArrayType<number>(data.length);for(let i=0;i<data.length;i++)define(copy,i,{value:valueAt(data,i),writable:true,enumerable:true,configurable:true});array=freeze(copy);publicArrays[key]=array;}return array;}});
  }
  freeze(mesh);putOwned(mesh,storage);publish(mesh);result=mesh;phase='finished';release();
 };
 const ticket:CopiedTriangleMeshPreparation={
  get done(){return phase==='finished';},get mesh(){return result;},
  cancel(){phase='cancelled';result=undefined;if(!stepping)release();},
  step(maxScalars){
   if(!safeInteger(maxScalars)||maxScalars<1)throw new RangeError('Triangle preparation requires a positive scalar budget');
   if(phase==='finished')return true;if(phase==='cancelled')throw new Error('Triangle preparation was cancelled');
   if(stepping)throw new Error('Triangle preparation cannot reenter');stepping=true;
   try{
    let budget=maxScalars;
    while(budget>0){
     if(cancelled())return false;
     if(phase==='indices'){
      const indices=channels.indices!,count=channels.positions!.length/3;
      if(offset<indices.length){const v=valueAt(indices,offset);if(!integer(v)||v<0||v>=count)throw new TypeError(`indices[${offset}] is out of bounds`);offset++;budget--;continue;}
      phase='copy';channel=3;offset=0;continue;
     }
     if(phase==='bounds'){
      const p=channels.positions!;
      if(offset<p.length){const v=valueAt(p,offset);switch(offset%3){case 0:minX=Math.min(minX,v);maxX=Math.max(maxX,v);break;case 1:minY=Math.min(minY,v);maxY=Math.max(maxY,v);break;default:minZ=Math.min(minZ,v);maxZ=Math.max(maxZ,v);}offset++;budget--;continue;}
      finish();return true;
     }
     if(channel===names.length){phase='bounds';offset=0;continue;}
     const key=names[channel]!;
     if(!current){
      const next=input![key];if(cancelled())return false;
      if(channel>=3&&next===undefined){channel++;continue;}
      if(!next||typeof next!=='object')throw new TypeError(`${key} requires an indexed numeric source`);
      const length=next.length;if(cancelled())return false;
      if(!safeInteger(length)||length<0||length>limits[channel]!)throw new TypeError(`${key} has an invalid length`);
      reading=next;current={length,blocks:[]};channels[key]=current;offset=0;
     }
     if(offset<current.length){
      const value=reading![offset];if(cancelled())return false;
      if(typeof value!=='number'||!finite(value)||channel===3&&(value<0||value>1)||channel===5&&!finite(fround(value)))throw new TypeError(`${key}[${offset}] must be a valid finite scalar`);
      if((offset&8191)===0){const length=Math.min(BLOCK_SCALARS,current.length-offset),block=new F64(length);define(block,'length',{value:length});define(block,'byteLength',{value:length*8});define(current.blocks,offset>>>13,{value:block,writable:true,enumerable:true,configurable:true});}
      current.blocks[offset>>>13]![offset&8191]=value;offset++;budget--;continue;
     }
     current=undefined;reading=undefined;offset=0;
     if(channel===2){
      const p=channels.positions!,n=channels.normals!,i=channels.indices!;
      if(p.length<9||p.length%3||n.length!==p.length)throw new TypeError('compactTriangleMesh requires matching vertex and normal triplets');
      if(!i.length||i.length%3)throw new TypeError('compactTriangleMesh requires triangle indices');phase='indices';continue;
     }
     if(channel>=3){const expected=channels.positions!.length/3*(channel===3?4:channel===4?2:1);if(channels[key]!.length!==expected)throw new TypeError(channel===3?'colors require one RGBA value per vertex':channel===4?'uvs require one authored pair per vertex':'variationSeeds require one value per vertex');}
     channel++;
    }
    return false;
   }catch(error){return fail(error);}finally{stepping=false;if(cancelled())release();}
  }
 };
 return ticket;
}

export function isCopiedTriangle(value:object):boolean{return getOwned(value)!==undefined;}
export function copiedTriangleBounds(value:object):Bounds|undefined{return getOwned(value)?.bounds;}

/** Public primitiveMesh remains a fresh-output slow path. */
export function copiedTriangleMeshData(mesh:object):MeshData|undefined{
 const s=getOwned(mesh);if(!s)return undefined;
 const count=s.positions.length/3,vertices=new F32(count*6),colors=new U8(count*4),Index=count>65535?U32:U16,indices=new Index(s.indices.length);
 for(let i=0;i<count;i++){
  for(let a=0;a<3;a++){vertices[i*6+a]=valueAt(s.positions,i*3+a);vertices[i*6+3+a]=valueAt(s.normals,i*3+a);}
  for(let a=0;a<4;a++)colors[i*4+a]=Math.round(Math.max(0,Math.min(1,s.colors?valueAt(s.colors,i*4+a):1))*255);
 }
 for(let i=0;i<s.indices.length;i++)indices[i]=valueAt(s.indices,i);
 const result:MeshData={vertices,colors,indices,indexFormat:count>65535?'uint32':'uint16'};
 if(s.uvs){result.uvs=new F32(s.uvs.length);for(let i=0;i<s.uvs.length;i++)result.uvs[i]=valueAt(s.uvs,i);}
 if(s.variationSeeds){result.variationSeeds=new F32(s.variationSeeds.length);for(let i=0;i<s.variationSeeds.length;i++)result.variationSeeds[i]=valueAt(s.variationSeeds,i);}
 return result;
}

export type TrianglePackedStream='vertex'|'color'|'index';
export interface TrianglePackedBlock {readonly stream:TrianglePackedStream;readonly offset:number;readonly bytes:Uint8Array}
export interface TriangleMeshPacking {
 readonly lengths:Readonly<Record<TrianglePackedStream,number>>;readonly count:number;readonly format:'uint16'|'uint32';
 readonly done:boolean;readonly bounds:MeshBounds;
 next(maxBytes:number):TrianglePackedBlock|undefined;
}
type ScalarReader=(channel:Channel,index:number)=>number|undefined;
/** Only fresh packed block copies leave this module; private F64 views never do. */
export function triangleMeshPacking(read:ScalarReader,count:number,indexCount:number,hasUV:boolean,hasSeeds:boolean):TriangleMeshPacking{
 const format=count>65535?'uint32':'uint16',indexBytes=format==='uint32'?4:2;
 const lengths=freeze({vertex:count*24,color:count*16,index:Math.ceil(indexCount*indexBytes/4)*4}),streams:readonly TrianglePackedStream[]=['vertex','color','index'];
 let stream=0,offset=0,minX=Infinity,minY=Infinity,minZ=Infinity,maxX=-Infinity,maxY=-Infinity,maxZ=-Infinity;
 return{lengths,count:indexCount,format,get done(){return stream===3;},get bounds():MeshBounds{return{center:[(minX+maxX)*.5,(minY+maxY)*.5,(minZ+maxZ)*.5],half:[(maxX-minX)*.5,(maxY-minY)*.5,(maxZ-minZ)*.5]};},next(maxBytes){
  if(!safeInteger(maxBytes)||maxBytes<4)throw new RangeError('Mesh packing requires at least four bytes');
  if(stream===3)return undefined;
  const kind=streams[stream]!,start=offset,length=Math.min(Math.floor(maxBytes/4)*4,lengths[kind]-offset),bytes=new U8(length),floats=new F32(bytes.buffer);
  if(kind==='vertex')for(let p=0;p<length;p+=4){const scalar=(offset+p)/4,i=Math.floor(scalar/6),axis=scalar%6,v=fround(read(axis<3?'positions':'normals',i*3+axis%3)!);floats[p/4]=v;if(axis===0){minX=Math.min(minX,v);maxX=Math.max(maxX,v);}else if(axis===1){minY=Math.min(minY,v);maxY=Math.max(maxY,v);}else if(axis===2){minZ=Math.min(minZ,v);maxZ=Math.max(maxZ,v);}}
  else if(kind==='color')for(let p=0;p<length;p+=4){const absolute=offset+p,i=Math.floor(absolute/16),component=(absolute%16)/4;if(component===0)for(let a=0;a<4;a++)bytes[p+a]=Math.round(Math.max(0,Math.min(1,read('colors',i*4+a)??1))*255);else if(component===1){const u=hasUV?fround(read('uvs',i*2)!):(fround(read('normals',i*3+2)!)<-.5?.5-fround(read('positions',i*3)!):fround(read('positions',i*3)!)+.5);if(hasUV&&!finite(u))throw new TypeError('Mesh requires finite UV pairs');floats[p/4]=u;}else if(component===2){const v=hasUV?fround(read('uvs',i*2+1)!):.5-fround(read('positions',i*3+1)!);if(hasUV&&!finite(v))throw new TypeError('Mesh requires finite UV pairs');floats[p/4]=v;}else floats[p/4]=hasSeeds?fround(read('variationSeeds',i)!):0;}
  else{const values=format==='uint32'?new U32(bytes.buffer):new U16(bytes.buffer);for(let i=0;i<values.length;i++){const index=offset/indexBytes+i;if(index<indexCount)values[i]=read('indices',index)!;}}
  offset+=length;if(offset===lengths[kind]){stream++;offset=0;}return{stream:kind,offset:start,bytes};
 }};
}
export function copiedTrianglePacking(mesh:object):TriangleMeshPacking|undefined{
 const s=getOwned(mesh);if(!s)return undefined;
 return triangleMeshPacking((key,index)=>{const channel=s[key];return channel?valueAt(channel,index):undefined;},s.positions.length/3,s.indices.length,s.uvs!==undefined,s.variationSeeds!==undefined);
}
