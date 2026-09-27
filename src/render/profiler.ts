import type {RenderAtomReport} from './atoms.js';
export const RENDER_CPU_QUANTA = [
  'lifecycle','resize','materials','lights','frame','environment','visibility','prepare','cull',
  'encode.shadow','encode.probe','encode.reflection','encode.main','encode.bloom','encode.effects','encode.taa','encode.present','submit',
] as const;
export type RenderCpuQuantum=typeof RENDER_CPU_QUANTA[number];

export const RENDER_GPU_QUANTA = [
  'shadow','probe','reflection','main','main.transparent','bloom.downsample','bloom.horizontal','bloom.vertical','effects','taa','present',
] as const;
export type RenderGpuQuantum=typeof RENDER_GPU_QUANTA[number];

export interface RenderWork {
  entities:number;visible:number;opaque:number;transparent:number;
  cameraOpaque:number;cameraTransparent:number;shadowCasters:number;reflected:number;
  drawCalls:number;triangles:number;snowInstances:number;shadowBatchedInstances:number;uploadBytes:number;
  uniformUploadBytes:number;surfaceUploadBytes:number;lightUploadBytes:number;frameUploadBytes:number;snowUploadBytes:number;environmentUploadBytes:number;instanceUploadBytes:number;
}
export interface QuantumStats {meanMs:number;p50Ms:number;p95Ms:number;maxMs:number}
export interface RenderFrameTiming {
  readonly frame:number;
  readonly totalMs:number;
  readonly quanta:Readonly<Record<string,number>>;
  readonly work:Readonly<RenderWork>;
}
export interface RasterSampleFrame {
  readonly frame:number;
  /** False when the backend returns only 0/1-style occlusion visibility. */
  readonly quantitative:boolean;
  readonly shadow:number;
  readonly reflection:number;
  readonly mainOpaque:number;
  readonly mainTransparent:number;
  readonly snow:number;
}
export interface RenderProfileSnapshot {
  readonly enabled:boolean;readonly cpuFrames:number;readonly gpuFrames:number;readonly timestampQueries:boolean;
  readonly gpuLagFrames:number|null;
  readonly latestCpu?:RenderFrameTiming;readonly latestGpu?:RenderFrameTiming;
  readonly cpuTotal?:QuantumStats;readonly gpuTotal?:QuantumStats;
  readonly cpu:Readonly<Record<string,QuantumStats>>;
  readonly gpu:Readonly<Record<string,QuantumStats>>;
  readonly atoms?:RenderAtomReport;
  readonly rasterSamples?:RasterSampleFrame;
}

/** Optional recording tap; GPU durations have no calibrated CPU-clock start. */
export interface RenderFrameEvent {
  readonly kind:'cpu'|'gpu';readonly generation:number;readonly timing:RenderFrameTiming;
  readonly startMs?:number;readonly spans?:readonly RenderCpuSpan[];
}
export interface RenderCpuSpan {readonly name:string;readonly offsetMs:number;readonly durationMs:number}
export type RenderFrameListener=(event:RenderFrameEvent)=>void;
type GPUAny=any;
interface GpuSlot{resolve:GPUAny;read:GPUAny;pending:boolean;frame:number;generation:number;work:RenderWork|null;usedMask:number}
interface OcclusionSlot{resolve:GPUAny;read:GPUAny;pending:boolean;frame:number;generation:number;usedMask:number}
const emptyWork=():RenderWork=>({entities:0,visible:0,opaque:0,transparent:0,cameraOpaque:0,cameraTransparent:0,shadowCasters:0,reflected:0,drawCalls:0,triangles:0,snowInstances:0,shadowBatchedInstances:0,uploadBytes:0,uniformUploadBytes:0,surfaceUploadBytes:0,lightUploadBytes:0,frameUploadBytes:0,snowUploadBytes:0,environmentUploadBytes:0,instanceUploadBytes:0});
const percentile=(values:readonly number[],q:number)=>{if(!values.length)return 0;const a=[...values].sort((x,y)=>x-y);return a[Math.min(a.length-1,Math.floor((a.length-1)*q))]!;};
const stats=(values:readonly number[]):QuantumStats=>({meanMs:values.length?values.reduce((a,b)=>a+b,0)/values.length:0,p50Ms:percentile(values,.5),p95Ms:percentile(values,.95),maxMs:values.length?Math.max(...values):0});
const freezeFrame=(frame:number,totalMs:number,quanta:Record<string,number>,work:RenderWork):RenderFrameTiming=>Object.freeze({frame,totalMs,quanta:Object.freeze({...quanta}),work:Object.freeze({...work})});

/** Low-overhead renderer profiler.
 * CPU quanta use performance.now(). GPU quanta use pass timestamp queries when
 * the adapter exposes timestamp-query. Readback is asynchronous through a small
 * ring, so profiling never waits for the GPU in render().
 */
export class RenderProfiler {
  private readonly listeners=new Set<RenderFrameListener>();
  private spans:RenderCpuSpan[]=[];
  private frame=0;private generation=0;private frameStart=0;private cpuQuanta:Record<string,number>={};private work=emptyWork();private atoms:RenderAtomReport|undefined;
  private readonly cpuHistory:RenderFrameTiming[]=[];private readonly gpuHistory:RenderFrameTiming[]=[];
  private readonly querySet:GPUAny|null;private readonly slots:GpuSlot[]=[];private active:GpuSlot|null=null;
  private readonly queryBytes=RENDER_GPU_QUANTA.length*2*8;
  private readonly occlusionQuerySet:GPUAny|null;private readonly occlusionSlots:OcclusionSlot[]=[];private activeOcclusion:OcclusionSlot|null=null;
  private readonly occlusionBytes=5*8;private latestRaster:RasterSampleFrame|undefined;

  readonly enabled:boolean;readonly timestampQueries:boolean;private readonly capacity:number;
  constructor(private readonly device:GPUAny,options:{enabled?:boolean;timestampQueries?:boolean;capacity?:number}={}){
    this.enabled=options.enabled??true;this.timestampQueries=this.enabled&&(options.timestampQueries??false);this.capacity=options.capacity??1024;
    if(!Number.isSafeInteger(this.capacity)||this.capacity<8||this.capacity>4096)throw new RangeError('Invalid render profiler capacity');
    this.querySet=this.timestampQueries?device.createQuerySet({label:'render quantum timestamps',type:'timestamp',count:RENDER_GPU_QUANTA.length*2}):null;
    this.occlusionQuerySet=this.enabled?device.createQuerySet({label:'render atom raster samples',type:'occlusion',count:5}):null;
    if(this.enabled)for(let i=0;i<4;i++)this.occlusionSlots.push({
      resolve:device.createBuffer({label:`render occlusion resolve ${i}`,size:this.occlusionBytes,usage:0x0200|0x0004}),
      read:device.createBuffer({label:`render occlusion readback ${i}`,size:this.occlusionBytes,usage:0x0001|0x0008}),
      pending:false,frame:0,generation:0,usedMask:0,
    });
    if(this.timestampQueries)for(let i=0;i<4;i++)this.slots.push({
      resolve:device.createBuffer({label:`render profile resolve ${i}`,size:this.queryBytes,usage:0x0200|0x0004}),
      read:device.createBuffer({label:`render profile readback ${i}`,size:this.queryBytes,usage:0x0001|0x0008}),
      pending:false,frame:0,generation:0,work:null,usedMask:0,
    });
  }

  beginFrame():number{
    this.frame++;if(!this.enabled)return this.frame;this.frameStart=performance.now();this.cpuQuanta={};this.spans.length=0;this.work=emptyWork();
    this.active=this.timestampQueries?(this.slots.find(slot=>!slot.pending)??null):null;
    this.activeOcclusion=this.enabled?(this.occlusionSlots.find(slot=>!slot.pending)??null):null;
    if(this.active){this.active.frame=this.frame;this.active.generation=this.generation;this.active.work=null;this.active.usedMask=0;}
    if(this.activeOcclusion){this.activeOcclusion.frame=this.frame;this.activeOcclusion.generation=this.generation;this.activeOcclusion.usedMask=0;}
    return this.frame;
  }
  measure<T>(name:RenderCpuQuantum,run:()=>T):T{if(!this.enabled)return run();const at=performance.now();try{return run();}finally{const ms=performance.now()-at;this.cpuQuanta[name]=(this.cpuQuanta[name]??0)+ms;if(this.listeners.size)this.spans.push(Object.freeze({name,offsetMs:at-this.frameStart,durationMs:ms}));}}
  add(name:RenderCpuQuantum,ms:number):void{if(this.enabled&&Number.isFinite(ms)&&ms>=0)this.cpuQuanta[name]=(this.cpuQuanta[name]??0)+ms;}
  setWork(work:Partial<RenderWork>):void{if(this.enabled)Object.assign(this.work,work);}
  setAtoms(atoms:RenderAtomReport):void{if(this.enabled)this.atoms=atoms;}
  currentWork():RenderWork{return{...this.work};}
  addUpload(bytes:number,kind:'uniform'|'surface'|'light'|'frame'|'snow'|'environment'|'instance'='uniform'):void{if(!this.enabled||!Number.isFinite(bytes)||bytes<=0)return;this.work.uploadBytes+=bytes;if(kind==='uniform')this.work.uniformUploadBytes+=bytes;else if(kind==='surface')this.work.surfaceUploadBytes+=bytes;else if(kind==='light')this.work.lightUploadBytes+=bytes;else if(kind==='frame')this.work.frameUploadBytes+=bytes;else if(kind==='snow')this.work.snowUploadBytes+=bytes;else if(kind==='environment')this.work.environmentUploadBytes+=bytes;else this.work.instanceUploadBytes+=bytes;}

  occlusionSet():GPUAny|undefined{return this.activeOcclusion&&this.occlusionQuerySet?this.occlusionQuerySet:undefined;}
  beginOcclusion(pass:GPUAny,name:'shadow'|'reflection'|'mainOpaque'|'mainTransparent'|'snow'):boolean{
    if(!this.activeOcclusion||!this.occlusionQuerySet)return false;
    const index=name==='shadow'?0:name==='reflection'?1:name==='mainOpaque'?2:name==='mainTransparent'?3:4;
    this.activeOcclusion.usedMask|=1<<index;pass.beginOcclusionQuery(index);return true;
  }
  endOcclusion(pass:GPUAny,active:boolean):void{if(active)pass.endOcclusionQuery();}
  timestampWrites(name:RenderGpuQuantum):Record<string,unknown>|undefined{
    if(!this.active||!this.querySet)return undefined;
    const i=RENDER_GPU_QUANTA.indexOf(name);if(i<0)return undefined;
    this.active.usedMask|=1<<i;
    return{querySet:this.querySet,beginningOfPassWriteIndex:i*2,endOfPassWriteIndex:i*2+1};
  }
  resolve(encoder:GPUAny):void{
    if(!this.enabled)return;
    const slot=this.active;if(slot&&this.querySet){encoder.resolveQuerySet(this.querySet,0,RENDER_GPU_QUANTA.length*2,slot.resolve,0);encoder.copyBufferToBuffer(slot.resolve,0,slot.read,0,this.queryBytes);slot.work={...this.work};}
    const occ=this.activeOcclusion;if(occ&&this.occlusionQuerySet){encoder.resolveQuerySet(this.occlusionQuerySet,0,5,occ.resolve,0);encoder.copyBufferToBuffer(occ.resolve,0,occ.read,0,this.occlusionBytes);}
  }
  submitted():void{
    if(!this.enabled)return;const cpu=freezeFrame(this.frame,performance.now()-this.frameStart,this.cpuQuanta,this.work);
    this.push(this.cpuHistory,cpu);
    const occ=this.activeOcclusion;this.activeOcclusion=null;
    if(occ&&this.occlusionQuerySet){occ.pending=true;void occ.read.mapAsync(0x0001).then(()=>{const raw=new BigUint64Array(occ.read.getMappedRange());const values=Array.from({length:5},(_,i)=>(occ.usedMask&(1<<i))?Number(raw[i]!):0),quantitative=values.some(value=>value>1);const raster:RasterSampleFrame={frame:occ.frame,quantitative,shadow:values[0]!,reflection:values[1]!,mainOpaque:values[2]!,mainTransparent:values[3]!,snow:values[4]!};occ.read.unmap();if(occ.generation===this.generation)this.latestRaster=Object.freeze(raster);occ.pending=false;}).catch(()=>{try{occ.read.unmap();}catch{}occ.pending=false;});}
    const slot=this.active;this.active=null;if(!slot||!this.querySet)return;
    slot.pending=true;
    void slot.read.mapAsync(0x0001).then(()=>{
      const raw=new BigUint64Array(slot.read.getMappedRange()),quanta:Record<string,number>={};let total=0;
      for(let i=0;i<RENDER_GPU_QUANTA.length;i++){
        const used=(slot.usedMask&(1<<i))!==0,begin=raw[i*2]!,end=raw[i*2+1]!,ms=used&&end>=begin?Number(end-begin)/1e6:0;
        quanta[RENDER_GPU_QUANTA[i]!]=ms;total+=ms;
      }
      slot.read.unmap();if(slot.generation===this.generation)this.push(this.gpuHistory,freezeFrame(slot.frame,total,quanta,slot.work??emptyWork()));slot.pending=false;slot.work=null;
    }).catch(()=>{try{slot.read.unmap();}catch{}slot.pending=false;slot.work=null;});
  }

  /** No history aggregation, no renderer wait and no world copy per delivered frame. */
  subscribeFrames(listener:RenderFrameListener):()=>void{
    if(!this.enabled)throw new Error('Enable renderer profiling before recording');
    this.listeners.add(listener);return()=>{this.listeners.delete(listener);};
  }
  reset():void{this.generation++;this.cpuHistory.length=0;this.gpuHistory.length=0;this.frame=0;this.cpuQuanta={};this.work=emptyWork();this.atoms=undefined;this.latestRaster=undefined;this.active=null;this.activeOcclusion=null;}

  inspect():RenderProfileSnapshot{
    const latestCpu=this.cpuHistory.at(-1),latestGpu=this.gpuHistory.at(-1);
    const aggregate=(history:readonly RenderFrameTiming[],names:readonly string[])=>Object.fromEntries(names.map(name=>[name,stats(history.map(frame=>frame.quanta[name]??0))]));
    return Object.freeze({
      enabled:this.enabled,cpuFrames:this.cpuHistory.length,gpuFrames:this.gpuHistory.length,timestampQueries:this.timestampQueries,
      gpuLagFrames:latestCpu&&latestGpu?latestCpu.frame-latestGpu.frame:null,
      ...(latestCpu?{latestCpu}:{}),...(latestGpu?{latestGpu}:{}),
      ...(this.cpuHistory.length?{cpuTotal:stats(this.cpuHistory.map(x=>x.totalMs))}:{}),
      ...(this.gpuHistory.length?{gpuTotal:stats(this.gpuHistory.map(x=>x.totalMs))}:{}),
      cpu:Object.freeze(aggregate(this.cpuHistory,RENDER_CPU_QUANTA)),
      gpu:Object.freeze(aggregate(this.gpuHistory,RENDER_GPU_QUANTA)),
      ...(this.atoms?{atoms:this.atoms}:{}),...(this.latestRaster?{rasterSamples:this.latestRaster}:{}),
    });
  }
  dispose():void{this.generation++;this.listeners.clear();this.querySet?.destroy?.();this.occlusionQuerySet?.destroy?.();for(const slot of this.slots){try{slot.read.unmap();}catch{}slot.resolve.destroy();slot.read.destroy();}for(const slot of this.occlusionSlots){try{slot.read.unmap();}catch{}slot.resolve.destroy();slot.read.destroy();}this.slots.length=0;this.occlusionSlots.length=0;}
  private push(history:RenderFrameTiming[],value:RenderFrameTiming){
    history.push(value);if(history.length>this.capacity)history.splice(0,history.length-this.capacity);
    if(!this.listeners.size)return;
    const cpu=history===this.cpuHistory;
    const event:RenderFrameEvent=Object.freeze({kind:cpu?'cpu':'gpu',generation:this.generation,timing:value,...(cpu?{startMs:this.frameStart,spans:Object.freeze([...this.spans])}:{})});
    // A diagnostic consumer must not turn a completed frame into a renderer failure.
    for(const listener of this.listeners)try{listener(event);}catch(error){this.listeners.delete(listener);console.error('Render recorder detached:',error);}
  }
}
