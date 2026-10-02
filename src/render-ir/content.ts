import type {ContentHash,ContentRef,RenderResourceKind,ResourceManifest} from './index.js';

const SHA256_K=new Uint32Array([
 0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
 0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
 0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
 0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
 0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
 0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
 0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
 0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2,
]);
const rotr=(value:number,bits:number)=>((value>>>bits)|(value<<(32-bits)))>>>0;

export function canonicalContent(value:unknown):string{
 const active=new WeakSet<object>();
 const encode=(value:unknown):string=>{
  if(value===null)return'null';
  const type=typeof value;
  if(type==='string')return's:'+JSON.stringify(value);
  if(type==='boolean')return value?'b:1':'b:0';
  if(type==='undefined')return'u';
  if(type==='bigint')return'bi:'+String(value);
  if(type==='number'){
   if(Number.isNaN(value))return'n:nan';
   if(value===Infinity)return'n:+inf';
   if(value===-Infinity)return'n:-inf';
   if(Object.is(value,-0))return'n:-0';
   return'n:'+String(value);
  }
  if(type!=='object')throw new TypeError('Content-addressed values must be data, not '+type);
  const object=value as object;if(active.has(object))throw new TypeError('Content-addressed values cannot contain cycles');active.add(object);
  try{
   if(ArrayBuffer.isView(value)){
    if(value instanceof DataView)return'dataview:['+[...new Uint8Array(value.buffer,value.byteOffset,value.byteLength)].join(',')+']';
    const typed=value as unknown as {constructor:{name:string};length:number;[index:number]:number|bigint};
    return'typed:'+typed.constructor.name+':['+Array.from({length:typed.length},(_,i)=>encode(typed[i])).join(',')+']';
   }
   if(value instanceof ArrayBuffer)return'buffer:['+[...new Uint8Array(value)].join(',')+']';
   if(Array.isArray(value))return'a:['+value.map(encode).join(',')+']';
   if(value instanceof Map){
    const entries=[...value.entries()].map(([key,item])=>[encode(key),encode(item)] as const).sort((a,b)=>a[0].localeCompare(b[0]));
    return'm:{'+entries.map(([key,item])=>key+'='+item).join(',')+'}';
   }
   if(value instanceof Set)return'set:['+[...value].map(encode).sort().join(',')+']';
   const proto=Object.getPrototypeOf(value);if(proto!==Object.prototype&&proto!==null)throw new TypeError('Content-addressed values require plain data objects');
   const record=value as Record<string,unknown>;
   return'o:{'+Object.keys(record).sort().map(key=>JSON.stringify(key)+'='+encode(record[key])).join(',')+'}';
  }finally{active.delete(object);}
 };
 return encode(value);
}

function sha256(text:string):string{
 const source=new TextEncoder().encode(text),bitLength=BigInt(source.length)*8n,total=Math.ceil((source.length+9)/64)*64,bytes=new Uint8Array(total);
 bytes.set(source);bytes[source.length]=0x80;
 for(let i=0;i<8;i++)bytes[total-1-i]=Number((bitLength>>BigInt(i*8))&255n);
 let h0=0x6a09e667,h1=0xbb67ae85,h2=0x3c6ef372,h3=0xa54ff53a,h4=0x510e527f,h5=0x9b05688c,h6=0x1f83d9ab,h7=0x5be0cd19;
 const w=new Uint32Array(64);
 for(let offset=0;offset<bytes.length;offset+=64){
  for(let i=0;i<16;i++){const j=offset+i*4;w[i]=((bytes[j]!<<24)|(bytes[j+1]!<<16)|(bytes[j+2]!<<8)|bytes[j+3]!)>>>0;}
  for(let i=16;i<64;i++){
   const a=w[i-15]!,b=w[i-2]!,s0=(rotr(a,7)^rotr(a,18)^(a>>>3))>>>0,s1=(rotr(b,17)^rotr(b,19)^(b>>>10))>>>0;
   w[i]=(w[i-16]!+s0+w[i-7]!+s1)>>>0;
  }
  let a=h0,b=h1,c=h2,d=h3,e=h4,f=h5,g=h6,h=h7;
  for(let i=0;i<64;i++){
   const s1=(rotr(e,6)^rotr(e,11)^rotr(e,25))>>>0,ch=((e&f)^(~e&g))>>>0,t1=(h+s1+ch+SHA256_K[i]!+w[i]!)>>>0;
   const s0=(rotr(a,2)^rotr(a,13)^rotr(a,22))>>>0,maj=((a&b)^(a&c)^(b&c))>>>0,t2=(s0+maj)>>>0;
   h=g;g=f;f=e;e=(d+t1)>>>0;d=c;c=b;b=a;a=(t1+t2)>>>0;
  }
  h0=(h0+a)>>>0;h1=(h1+b)>>>0;h2=(h2+c)>>>0;h3=(h3+d)>>>0;h4=(h4+e)>>>0;h5=(h5+f)>>>0;h6=(h6+g)>>>0;h7=(h7+h)>>>0;
 }
 return[h0,h1,h2,h3,h4,h5,h6,h7].map(value=>value.toString(16).padStart(8,'0')).join('');
}
export function contentHash(value:unknown,prefix='sha256'):ContentHash{return prefix+':'+sha256(canonicalContent(value));}

export interface ContentAddressedRepository{
 put<T>(kind:RenderResourceKind,value:T):ContentRef;
 has(hash:ContentHash):boolean;
 get<T=unknown>(hash:ContentHash):T|undefined;
 require<T=unknown>(hash:ContentHash):T;
 ref(hash:ContentHash):ContentRef|undefined;
 manifest(refs:Iterable<ContentRef>):ResourceManifest;
 readonly size:number;
}
export class MemoryContentStore implements ContentAddressedRepository{
 private readonly values=new Map<ContentHash,{readonly ref:ContentRef;readonly value:unknown}>();
 put<T>(kind:RenderResourceKind,value:T):ContentRef{
  const snapshot=structuredClone(value),hash=contentHash({kind,value:snapshot}),ref=Object.freeze({kind,hash}),existing=this.values.get(hash);
  if(existing&&canonicalContent(existing.value)!==canonicalContent(snapshot))throw new Error('Content hash collision: '+hash);
  if(!existing)this.values.set(hash,{ref,value:snapshot});return ref;
 }
 has(hash:ContentHash):boolean{return this.values.has(hash);}
 get<T=unknown>(hash:ContentHash):T|undefined{const found=this.values.get(hash);return found?structuredClone(found.value) as T:undefined;}
 require<T=unknown>(hash:ContentHash):T{const value=this.get<T>(hash);if(value===undefined)throw new Error('Missing content '+hash);return value;}
 ref(hash:ContentHash):ContentRef|undefined{return this.values.get(hash)?.ref;}
 manifest(refs:Iterable<ContentRef>):ResourceManifest{
  const unique=new Map<string,ContentRef>();for(const ref of refs){if(!this.values.has(ref.hash))throw new Error('Manifest references missing content '+ref.hash);unique.set(ref.kind+'\0'+ref.hash,ref);}
  return Object.freeze({resources:Object.freeze([...unique.values()].sort((a,b)=>a.kind.localeCompare(b.kind)||a.hash.localeCompare(b.hash)))});
 }
 get size(){return this.values.size;}
}
