export type RuntimeMemoryKind='instance'|'state'|'cache'|'registry'|'queue'|'pool'|'history'|'index';

export interface RuntimeMemoryEntry{
  readonly id:number;
  readonly owner:string;
  readonly name:string;
  readonly kind:RuntimeMemoryKind;
  readonly type:string;
  readonly items:number|null;
  readonly bytes:number|null;
  readonly capacity?:number;
}

interface RecordEntry{
  readonly id:number;readonly owner:string;readonly name:string;readonly kind:RuntimeMemoryKind;
  readonly ref:WeakRef<object>;readonly capacity?:number;
}

let sequence=0;
const records=new Map<number,RecordEntry>();
const finalizer=new FinalizationRegistry<number>(id=>records.delete(id));

/** Register long-lived runtime state without extending its lifetime.
 * Every persistent collection/cache should enter memory through this function so
 * diagnostics can expose the actual in-memory architecture. */
export function trackRuntimeMemory<T extends object>(owner:string,name:string,kind:RuntimeMemoryKind,value:T,capacity?:number):T{
  if(!owner||!name)throw new TypeError('Runtime memory requires owner and name');
  const id=++sequence,entry:RecordEntry={id,owner,name,kind,ref:new WeakRef(value),...(capacity!==undefined?{capacity}:{})};
  records.set(id,entry);finalizer.register(value,id);return value;
}

export function trackRuntimeInstance<T extends object>(owner:string,value:T):T{
  return trackRuntimeMemory(owner,'instance','instance',value);
}

function sizeOf(value:any):{items:number|null;bytes:number|null;type:string}{
  const type=value?.constructor?.name??typeof value;
  if(value instanceof Map||value instanceof Set)return{items:value.size,bytes:null,type};
  if(Array.isArray(value))return{items:value.length,bytes:null,type};
  if(ArrayBuffer.isView(value))return{items:'length'in value?Number(value.length):null,bytes:value.byteLength,type};
  if(value instanceof ArrayBuffer)return{items:null,bytes:value.byteLength,type};
  return{items:null,bytes:null,type};
}

export function runtimeMemorySnapshot():readonly RuntimeMemoryEntry[]{
  const out:RuntimeMemoryEntry[]=[];
  for(const [id,entry] of records){
    const value=entry.ref.deref();if(!value){records.delete(id);continue;}
    const {items,bytes,type}=sizeOf(value);
    out.push(Object.freeze({id,owner:entry.owner,name:entry.name,kind:entry.kind,type,items,bytes,...(entry.capacity!==undefined?{capacity:entry.capacity}:{})}));
  }
  return Object.freeze(out.sort((a,b)=>a.owner.localeCompare(b.owner)||a.name.localeCompare(b.name)||a.id-b.id));
}
