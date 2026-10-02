import type {ContentHash,ContentRef,RenderResourceKind,ResourceManifest} from './index.js';

const MASK64=(1n<<64n)-1n,OFFSET=14695981039346656037n,PRIME=1099511628211n;

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
    const object=value as object;
    if(active.has(object))throw new TypeError('Content-addressed values cannot contain cycles');
    active.add(object);
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
      const proto=Object.getPrototypeOf(value);
      if(proto!==Object.prototype&&proto!==null)throw new TypeError('Content-addressed values require plain data objects');
      const record=value as Record<string,unknown>;
      return'o:{'+Object.keys(record).sort().map(key=>JSON.stringify(key)+'='+encode(record[key])).join(',')+'}';
    }finally{active.delete(object);}
  };
  return encode(value);
}
export function contentHash(value:unknown,prefix='ca64'):ContentHash{
  const text=canonicalContent(value);let hash=OFFSET;
  for(let i=0;i<text.length;i++){const code=text.charCodeAt(i);hash^=BigInt(code&255);hash=(hash*PRIME)&MASK64;hash^=BigInt(code>>>8);hash=(hash*PRIME)&MASK64;}
  return prefix+':'+hash.toString(16).padStart(16,'0');
}

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
    const snapshot=structuredClone(value),hash=contentHash({kind,value:snapshot}),ref=Object.freeze({kind,hash});
    const existing=this.values.get(hash);
    if(existing&&canonicalContent(existing.value)!==canonicalContent(snapshot))throw new Error('Content hash collision: '+hash);
    if(!existing)this.values.set(hash,{ref,value:snapshot});
    return ref;
  }
  has(hash:ContentHash):boolean{return this.values.has(hash);}
  get<T=unknown>(hash:ContentHash):T|undefined{const found=this.values.get(hash);return found?structuredClone(found.value) as T:undefined;}
  require<T=unknown>(hash:ContentHash):T{const value=this.get<T>(hash);if(value===undefined)throw new Error('Missing content '+hash);return value;}
  ref(hash:ContentHash):ContentRef|undefined{return this.values.get(hash)?.ref;}
  manifest(refs:Iterable<ContentRef>):ResourceManifest{
    const unique=new Map<string,ContentRef>();
    for(const ref of refs){if(!this.values.has(ref.hash))throw new Error('Manifest references missing content '+ref.hash);unique.set(ref.kind+'\0'+ref.hash,ref);}
    return Object.freeze({resources:Object.freeze([...unique.values()].sort((a,b)=>a.kind.localeCompare(b.kind)||a.hash.localeCompare(b.hash)))});
  }
  get size(){return this.values.size;}
}
