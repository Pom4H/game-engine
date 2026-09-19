export const RENDER_CPU_QUANTA = [
  'lifecycle','resize','materials','lights','frame','visibility','prepare','cull',
  'encode.shadow','encode.reflection','encode.main','encode.bloom','encode.post','submit',
] as const;
export type RenderCpuQuantum=typeof RENDER_CPU_QUANTA[number];

export const RENDER_GPU_QUANTA = [
  'shadow','reflection','main','bloom.downsample','bloom.horizontal','bloom.vertical','post',
] as const;
export type RenderGpuQuantum=typeof RENDER_GPU_QUANTA[number];

export interface RenderWork {
  entities:number;visible:number;opaque:number;transparent:number;
  cameraOpaque:number;cameraTransparent:number;shadowCasters:number;reflected:number;
  drawCalls:number;triangles:number;snowInstances:number;uploadBytes:number;
}
export interface QuantumStats {meanMs:number;p50Ms:number;p95Ms:number;maxMs:number}
export interface RenderFrameTiming {
  readonly frame:number;
  readonly totalMs:number;
  readonly quanta:Readonly<Record<string,number>>;
  readonly work:Readonly<RenderWork>;
}
export interface RenderProfileSnapshot {
  readonly cpuFrames:number;readonly gpuFrames:number;readonly timestampQueries:boolean;
  readonly gpuLagFrames:number|null;
  readonly latestCpu?:RenderFrameTiming;readonly latestGpu?:RenderFrameTiming;
  readonly cpuTotal?:QuantumStats;readonly gpuTotal?:QuantumStats;
  readonly cpu:Readonly<Record<string,QuantumStats>>;
  readonly gpu:Readonly<Record<string,QuantumStats>>;
}

type GPUAny=any;
interface GpuSlot{resolve:GPUAny;read:GPUAny;pending:boolean;frame:number;work:RenderWork|null}
const emptyWork=():RenderWork=>({entities:0,visible:0,opaque:0,transparent:0,cameraOpaque:0,cameraTransparent:0,shadowCasters:0,reflected:0,drawCalls:0,triangles:0,snowInstances:0,uploadBytes:0});
const percentile=(values:readonly number[],q:number)=>{if(!values.length)return 0;const a=[...values].sort((x,y)=>x-y);return a[Math.min(a.length-1,Math.floor((a.length-1)*q))]!;};
const stats=(values:readonly number[]):QuantumStats=>({meanMs:values.length?values.reduce((a,b)=>a+b,0)/values.length:0,p50Ms:percentile(values,.5),p95Ms:percentile(values,.95),maxMs:values.length?Math.max(...values):0});
const freezeFrame=(frame:number,totalMs:number,quanta:Record<string,number>,work:RenderWork):RenderFrameTiming=>Object.freeze({frame,totalMs,quanta:Object.freeze({...quanta}),work:Object.freeze({...work})});

/** Low-overhead renderer profiler.
 * CPU quanta use performance.now(). GPU quanta use pass timestamp queries when
 * the adapter exposes timestamp-query. Readback is asynchronous through a small
 * ring, so profiling never waits for the GPU in render().
 */
export class RenderProfiler {
  private frame=0;private frameStart=0;private cpuQuanta:Record<string,number>={};private work=emptyWork();
  private readonly cpuHistory:RenderFrameTiming[]=[];private readonly gpuHistory:RenderFrameTiming[]=[];
  private readonly querySet:GPUAny|null;private readonly slots:GpuSlot[]=[];private active:GpuSlot|null=null;
  private readonly queryBytes=RENDER_GPU_QUANTA.length*2*8;

  constructor(private readonly device:GPUAny,readonly timestampQueries:boolean,private readonly capacity=240){
    if(!Number.isSafeInteger(capacity)||capacity<8||capacity>4096)throw new RangeError('Invalid render profiler capacity');
    this.querySet=timestampQueries?device.createQuerySet({label:'render quantum timestamps',type:'timestamp',count:RENDER_GPU_QUANTA.length*2}):null;
    if(timestampQueries)for(let i=0;i<4;i++)this.slots.push({
      resolve:device.createBuffer({label:`render profile resolve ${i}`,size:this.queryBytes,usage:0x0200|0x0004}),
      read:device.createBuffer({label:`render profile readback ${i}`,size:this.queryBytes,usage:0x0001|0x0008}),
      pending:false,frame:0,work:null,
    });
  }

  beginFrame():number{
    this.frame++;this.frameStart=performance.now();this.cpuQuanta={};this.work=emptyWork();
    this.active=this.timestampQueries?(this.slots.find(slot=>!slot.pending)??null):null;
    if(this.active){this.active.frame=this.frame;this.active.work=null;}
    return this.frame;
  }
  measure<T>(name:RenderCpuQuantum,run:()=>T):T{const at=performance.now();try{return run();}finally{this.cpuQuanta[name]=(this.cpuQuanta[name]??0)+(performance.now()-at);}}
  add(name:RenderCpuQuantum,ms:number):void{if(Number.isFinite(ms)&&ms>=0)this.cpuQuanta[name]=(this.cpuQuanta[name]??0)+ms;}
  setWork(work:Partial<RenderWork>):void{Object.assign(this.work,work);}
  addUpload(bytes:number):void{if(Number.isFinite(bytes)&&bytes>0)this.work.uploadBytes+=bytes;}

  timestampWrites(name:RenderGpuQuantum):Record<string,unknown>|undefined{
    if(!this.active||!this.querySet)return undefined;
    const i=RENDER_GPU_QUANTA.indexOf(name);if(i<0)return undefined;
    return{querySet:this.querySet,beginningOfPassWriteIndex:i*2,endOfPassWriteIndex:i*2+1};
  }
  resolve(encoder:GPUAny):void{
    const slot=this.active;if(!slot||!this.querySet)return;
    encoder.resolveQuerySet(this.querySet,0,RENDER_GPU_QUANTA.length*2,slot.resolve,0);
    encoder.copyBufferToBuffer(slot.resolve,0,slot.read,0,this.queryBytes);
    slot.work={...this.work};
  }
  submitted():void{
    const cpu=freezeFrame(this.frame,performance.now()-this.frameStart,this.cpuQuanta,this.work);
    this.push(this.cpuHistory,cpu);
    const slot=this.active;this.active=null;if(!slot||!this.querySet)return;
    slot.pending=true;
    void slot.read.mapAsync(0x0001).then(()=>{
      const raw=new BigUint64Array(slot.read.getMappedRange()),quanta:Record<string,number>={};let total=0;
      for(let i=0;i<RENDER_GPU_QUANTA.length;i++){
        const begin=raw[i*2]!,end=raw[i*2+1]!,ms=end>=begin?Number(end-begin)/1e6:0;
        quanta[RENDER_GPU_QUANTA[i]!]=ms;total+=ms;
      }
      slot.read.unmap();this.push(this.gpuHistory,freezeFrame(slot.frame,total,quanta,slot.work??emptyWork()));slot.pending=false;slot.work=null;
    }).catch(()=>{try{slot.read.unmap();}catch{}slot.pending=false;slot.work=null;});
  }

  inspect():RenderProfileSnapshot{
    const latestCpu=this.cpuHistory.at(-1),latestGpu=this.gpuHistory.at(-1);
    const aggregate=(history:readonly RenderFrameTiming[],names:readonly string[])=>Object.fromEntries(names.map(name=>[name,stats(history.map(frame=>frame.quanta[name]??0))]));
    return Object.freeze({
      cpuFrames:this.cpuHistory.length,gpuFrames:this.gpuHistory.length,timestampQueries:this.timestampQueries,
      gpuLagFrames:latestCpu&&latestGpu?latestCpu.frame-latestGpu.frame:null,
      ...(latestCpu?{latestCpu}:{}),...(latestGpu?{latestGpu}:{}),
      ...(this.cpuHistory.length?{cpuTotal:stats(this.cpuHistory.map(x=>x.totalMs))}:{}),
      ...(this.gpuHistory.length?{gpuTotal:stats(this.gpuHistory.map(x=>x.totalMs))}:{}),
      cpu:Object.freeze(aggregate(this.cpuHistory,RENDER_CPU_QUANTA)),
      gpu:Object.freeze(aggregate(this.gpuHistory,RENDER_GPU_QUANTA)),
    });
  }
  dispose():void{this.querySet?.destroy?.();for(const slot of this.slots){try{slot.read.unmap();}catch{}slot.resolve.destroy();slot.read.destroy();}this.slots.length=0;}
  private push(history:RenderFrameTiming[],value:RenderFrameTiming){history.push(value);if(history.length>this.capacity)history.splice(0,history.length-this.capacity);}
}
