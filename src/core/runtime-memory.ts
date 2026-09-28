export type RuntimeMemoryKind='instance'|'state'|'cache'|'registry'|'queue'|'pool'|'history'|'index'|'resource';

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

interface RecordBase{readonly id:number;readonly owner:string;readonly name:string;readonly kind:RuntimeMemoryKind;readonly capacity?:number}
interface ValueRecord extends RecordBase{readonly mode:'value';readonly ref:WeakRef<object>}
interface SlotRecord extends RecordBase{readonly mode:'slot';readonly host:WeakRef<object>;readonly key:PropertyKey}
type RecordEntry=ValueRecord|SlotRecord;

let sequence=0;
const records=new Map<number,RecordEntry>();
const finalizer=new FinalizationRegistry<number>(id=>records.delete(id));

const recordBase=(owner:string,name:string,kind:RuntimeMemoryKind,capacity?:number):RecordBase=>{
  if(!owner||!name)throw new TypeError('Runtime memory requires owner and name');
  return{id:++sequence,owner,name,kind,...(capacity!==undefined?{capacity}:{})};
};

/** Register long-lived runtime state without extending its lifetime. */
export function trackRuntimeMemory<T extends object>(owner:string,name:string,kind:RuntimeMemoryKind,value:T,capacity?:number):T{
  const base=recordBase(owner,name,kind,capacity),entry:ValueRecord={...base,mode:'value',ref:new WeakRef(value)};
  records.set(entry.id,entry);finalizer.register(value,entry.id);return value;
}

/** Track a replaceable field (GPU texture, framebuffer, typed buffer, etc).
 * The registry weakly owns the host and reads the current slot on every snapshot. */
export function trackRuntimeSlot(owner:string,name:string,kind:RuntimeMemoryKind,host:object,key:PropertyKey,capacity?:number):void{
  const base=recordBase(owner,name,kind,capacity),entry:SlotRecord={...base,mode:'slot',host:new WeakRef(host),key};
  records.set(entry.id,entry);finalizer.register(host,entry.id);
}

export function trackRuntimeInstance<T extends object>(owner:string,value:T):T{
  return trackRuntimeMemory(owner,'instance','instance',value);
}

function sizeOf(value:any):{items:number|null;bytes:number|null;type:string}{
  if(value===null||value===undefined)return{items:null,bytes:null,type:String(value)};
  const type=value?.constructor?.name??typeof value;
  if(value instanceof Map||value instanceof Set)return{items:value.size,bytes:null,type};
  if(Array.isArray(value))return{items:value.length,bytes:null,type};
  if(ArrayBuffer.isView(value))return{items:'length'in value?Number(value.length):null,bytes:value.byteLength,type};
  if(value instanceof ArrayBuffer)return{items:null,bytes:value.byteLength,type};
  if(type==='GPUBuffer'&&typeof value.size==='number')return{items:null,bytes:value.size,type};
  return{items:null,bytes:null,type};
}

export function runtimeMemorySnapshot():readonly RuntimeMemoryEntry[]{
  const out:RuntimeMemoryEntry[]=[];
  for(const [id,entry] of records){
    let value:unknown;
    if(entry.mode==='value'){value=entry.ref.deref();if(!value){records.delete(id);continue;}}
    else{const host=entry.host.deref();if(!host){records.delete(id);continue;}value=(host as any)[entry.key];}
    const {items,bytes,type}=sizeOf(value);
    out.push(Object.freeze({id,owner:entry.owner,name:entry.name,kind:entry.kind,type,items,bytes,...(entry.capacity!==undefined?{capacity:entry.capacity}:{})}));
  }
  return Object.freeze(out.sort((a,b)=>a.owner.localeCompare(b.owner)||a.name.localeCompare(b.name)||a.id-b.id));
}
