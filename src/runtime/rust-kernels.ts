/** Batched Rust data plane. Existing Scene remains the physical owner until its
 * migration gates pass. No per-vertex calls and no JSON transport in this API.
 * Buffers are borrowed views: reacquire `batch.buffers` after any allocation or
 * disposal in this runtime; do not retain views across those lifecycle changes.
 */
export const RustKernelPass=Object.freeze({Wheels:1,Hinges:2,Skin:4,Dents:8,Normals:16,Pack:32});
export const RustKernelLayout=Object.freeze({abi:1,wheelInput:15,wheelOutput:7,dent:9,packedVertex:6});
export interface RustBatchConfig {
  readonly wheelCount?:number;
  readonly nodeCount?:number;
  readonly hingeCount?:number;
  readonly vertexCount?:number;
  readonly influences?:number;
  readonly triangleCount?:number;
  readonly dentCount?:number;
}
export interface RustBatchBuffers {
  readonly wheelInput:Float64Array;
  readonly wheelOutput:Float64Array;
  readonly positions:Float64Array;
  readonly hinges:Uint32Array;
  readonly angles:Float64Array;
  readonly gradients:Float64Array;
  readonly skinRest:Float64Array;
  readonly nodeRest:Float64Array;
  readonly skinNodes:Uint32Array;
  readonly skinWeights:Float64Array;
  readonly skinPositions:Float64Array;
  readonly triangles:Uint32Array;
  readonly normals:Float64Array;
  readonly dents:Float64Array;
  readonly packed:Float32Array;
}
interface NativeExports {
  readonly memory:WebAssembly.Memory;
  rom4_abi_version():number;
  rom4_last_error():number;
  rom4_create(w:number,n:number,h:number,v:number,k:number,t:number,d:number):number;
  rom4_free(handle:number):number;
  rom4_execute(handle:number,flags:number):number;
  rom4_field_ptr(handle:number,field:number):number;
  rom4_field_len(handle:number,field:number):number;
  rom4_field_kind(handle:number,field:number):number;
  rom4_live_handles():number;
  rom4_live_bytes():number;
}
const fields=[
  ['wheelInput',1,1],['wheelOutput',2,1],['positions',3,1],['hinges',4,2],
  ['angles',5,1],['gradients',6,1],['skinRest',7,1],['nodeRest',8,1],
  ['skinNodes',9,2],['skinWeights',10,1],['skinPositions',11,1],['triangles',12,2],
  ['normals',13,1],['dents',14,1],['packed',15,3],
] as const;
const errors:Readonly<Record<number,string>>=Object.freeze({
  1:'stale or invalid handle',2:'invalid configuration or field',3:'invalid input buffer',
  4:'memory or handle capacity exceeded',5:'reentrant kernel access',6:'invalid pass combination',
});
function fail(native:NativeExports,operation:string):never {
  const code=native.rom4_last_error();
  throw new Error(`Rust kernel ${operation}: ${errors[code]??`unknown error ${code}`}`);
}
function checkedExports(value:unknown):NativeExports {
  if(!value||typeof value!=='object')throw new TypeError('Expected WebAssembly exports');
  const e=value as NativeExports;
  if(!(e.memory instanceof WebAssembly.Memory))throw new TypeError('Rust kernel must export WebAssembly memory');
  for(const name of ['rom4_abi_version','rom4_last_error','rom4_create','rom4_free','rom4_execute',
    'rom4_field_ptr','rom4_field_len','rom4_field_kind','rom4_live_handles','rom4_live_bytes'] as const)
    if(typeof e[name]!=='function')throw new TypeError(`Missing Rust kernel export ${name}`);
  if(e.rom4_abi_version()!==RustKernelLayout.abi)throw new Error('Rust kernel ABI version mismatch');
  return e;
}
function count(value:number|undefined,label:string,max:number):number {
  const n=value??0;
  if(!Number.isSafeInteger(n)||n<0||n>max)throw new RangeError(`${label} must be an integer in 0..${max}`);
  return n;
}

export class RustKernelRuntime {
  private readonly native:NativeExports;
  private readonly batches=new Set<RustKernelBatch>();
  private closed=false;
  /** Accepts an already-instantiated module for applications with their own
   * asset/worker boot process. The entire ABI is validated before use. */
  constructor(exports:unknown){this.native=checkedExports(exports);}
  createBatch(config:RustBatchConfig={}):RustKernelBatch {
    if(this.closed)throw new Error('Rust kernel runtime disposed');
    const w=count(config.wheelCount,'wheelCount',16384),n=count(config.nodeCount,'nodeCount',65535),
      h=count(config.hingeCount,'hingeCount',262144),v=count(config.vertexCount,'vertexCount',1_000_000),
      k=count(config.influences??(v?4:0),'influences',8),t=count(config.triangleCount,'triangleCount',2_000_000),
      d=count(config.dentCount,'dentCount',1024);
    if(h&&!n||v&&(!n||!k)||t&&!v)throw new RangeError('Batch topology requires nodes, vertices and influences');
    const handle=this.native.rom4_create(w,n,h,v,k,t,d);
    if(!handle)fail(this.native,'create');
    try {
      const lengths=[w*15,w*7,n*3,h*4,h,h*12,v*3,n*3,v*k,v*k,v*3,t*3,v*3,d*9,v*6];
      const batch=new RustKernelBatch(this.native,handle,lengths,()=>this.batches.delete(batch));
      this.batches.add(batch);return batch;
    }catch(error){this.native.rom4_free(handle);throw error;}
  }
  get stats():Readonly<{liveHandles:number;liveBytes:number;memoryBytes:number}> {
    return {liveHandles:this.native.rom4_live_handles(),liveBytes:this.native.rom4_live_bytes(),memoryBytes:this.native.memory.buffer.byteLength};
  }
  dispose():void {
    if(this.closed)return;
    for(const batch of this.batches)batch.dispose();
    this.closed=true;
  }
}
type FieldLayout={readonly name:keyof RustBatchBuffers;readonly pointer:number;readonly length:number;readonly kind:number};
export class RustKernelBatch {
  private readonly layout:readonly FieldLayout[];
  private buffer:ArrayBuffer|SharedArrayBuffer|undefined;
  private views:RustBatchBuffers|undefined;
  private disposed=false;
  /** Instances are created by RustKernelRuntime, not by application code. */
  constructor(private readonly native:NativeExports,private readonly handle:number,lengths:readonly number[],private readonly release:()=>void){
    this.layout=fields.map(([name,id,kind],i)=>{
      const pointer=native.rom4_field_ptr(handle,id);
      if(native.rom4_last_error())fail(native,'field pointer');
      const length=native.rom4_field_len(handle,id);
      if(native.rom4_last_error())fail(native,'field length');
      const actual=native.rom4_field_kind(handle,id);
      if(native.rom4_last_error())fail(native,'field kind');
      if(actual!==kind||length!==lengths[i])throw new Error(`Rust field layout mismatch: ${name}`);
      const bytes=kind===1?8:4;
      if(!Number.isSafeInteger(pointer)||pointer<0||pointer%bytes||pointer+length*bytes>native.memory.buffer.byteLength)
        throw new RangeError(`Invalid Rust field range: ${name}`);
      return {name,pointer,length,kind};
    });
    this.refresh();
  }
  private live():void {if(this.disposed)throw new Error('Rust kernel batch disposed');}
  private refresh():void {
    const memory=this.native.memory.buffer;
    if(this.buffer===memory)return;
    const views={} as Record<keyof RustBatchBuffers,Float64Array|Float32Array|Uint32Array>;
    for(const {name,pointer,length,kind} of this.layout)
      views[name]=kind===1?new Float64Array(memory,pointer,length):kind===2?new Uint32Array(memory,pointer,length):new Float32Array(memory,pointer,length);
    this.buffer=memory;this.views=views as unknown as RustBatchBuffers;
  }
  /** Same object and TypedArray views on the steady-state path. */
  get buffers():RustBatchBuffers {this.live();this.refresh();return this.views!;}
  execute(flags:number):void {
    this.live();
    if(!Number.isSafeInteger(flags)||flags<0||flags>63)throw new RangeError('Invalid Rust kernel pass mask');
    if(!this.native.rom4_execute(this.handle,flags))fail(this.native,'execute');
    this.refresh();
  }
  dispose():void {
    if(this.disposed)return;
    if(!this.native.rom4_free(this.handle))fail(this.native,'free');
    this.disposed=true;this.views=undefined;this.buffer=undefined;this.release();
  }
}
export async function createRustKernelRuntime(source:BufferSource|WebAssembly.Module):Promise<RustKernelRuntime> {
  const module=source instanceof WebAssembly.Module?source:await WebAssembly.compile(source);
  // Kernels must not call back into JS once per hinge/vertex/iteration.
  if(WebAssembly.Module.imports(module).length)throw new Error('Rust kernel runtime must not import host callbacks');
  return new RustKernelRuntime(new WebAssembly.Instance(module,{}).exports);
}
