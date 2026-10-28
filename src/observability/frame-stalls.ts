export type FramePhase={name:string;ms:number};
export type FrameStall={atMs:number;intervalMs:number|null;cpuMs:number;previousCpuMs:number|null;betweenFramesMs:number|null;phases:FramePhase[];previousPhases:FramePhase[];jobs:{name:string;atMs:number;ms:number}[]};
export interface FrameStallOptions{thresholdMs?:number;capacity?:number;now?:()=>number;onStall?:(stall:FrameStall)=>void}

/** Low-allocation timing of the host frame. RAF intervals include the preceding
 * frame's work. Keep both frames; never infer GPU, GC or network causality. */
export class FrameStallRecorder{
 private readonly clock:()=>number;private readonly threshold:number;private readonly capacity:number;
 private readonly phases:FramePhase[]=[];private phaseCount=0;private started=0;private checkpoint=0;private raf:number|null=null;
 private previousRaf:number|null=null;private previousEnd:number|null=null;private previousCpu:number|null=null;private previousPhases:FramePhase[]=[];
 private stalls:FrameStall[]=[];private jobs:{name:string;atMs:number;ms:number}[]=[];private frames=0;private totalStalls=0;private droppedPhases=0;private droppedJobs=0;private open=false;
 constructor(private readonly options:FrameStallOptions={}){
  this.clock=options.now??(()=>performance.now());this.threshold=options.thresholdMs??50;this.capacity=options.capacity??64;
  if(!Number.isFinite(this.threshold)||this.threshold<=0)throw RangeError('Invalid stall threshold');
  if(!Number.isSafeInteger(this.capacity)||this.capacity<1||this.capacity>4096)throw RangeError('Invalid stall capacity');
 }
 begin(rafMs:number){if(!Number.isFinite(rafMs))throw RangeError('Invalid RAF timestamp');this.raf=rafMs;this.started=this.checkpoint=this.clock();this.phaseCount=0;this.open=true;}
 mark(name:string){
  if(!this.open)return;if(typeof name!=='string'||!name.length||name.length>128)throw TypeError('Invalid phase label');const at=this.clock(),ms=Math.max(0,at-this.checkpoint);this.checkpoint=at;
  if(this.phaseCount>=64){this.droppedPhases++;return;}const phase=this.phases[this.phaseCount];
  if(phase){phase.name=name;phase.ms=ms;}else this.phases.push({name,ms});this.phaseCount++;
 }
 /** A synchronous callback outside the owned RAF, e.g. receipt or install. */
 job(name:string,startedMs:number){if(typeof name!=='string'||!name.length||name.length>128)throw TypeError('Invalid job label');const atMs=this.clock(),ms=atMs-startedMs;if(!Number.isFinite(ms)||ms<2)return;this.jobs.push({name,atMs,ms});if(this.jobs.length>64){this.jobs.shift();this.droppedJobs++;}}
 end(){
  if(!this.open)return;this.open=false;const end=this.clock(),cpuMs=Math.max(0,end-this.started),intervalMs=this.previousRaf===null?null:this.raf!-this.previousRaf;
  const betweenFramesMs=this.previousEnd===null?null:Math.max(0,this.started-this.previousEnd);this.frames++;
  if(cpuMs>=this.threshold||intervalMs!==null&&intervalMs>=this.threshold){
   const stall:FrameStall={atMs:this.started,intervalMs,cpuMs,previousCpuMs:this.previousCpu,betweenFramesMs,phases:this.phases.slice(0,this.phaseCount).map(p=>({...p})),previousPhases:this.previousPhases.map(p=>({...p})),jobs:this.jobs.filter(j=>j.atMs>=(this.previousEnd??this.started)&&j.atMs<=end).map(j=>({...j}))};
   this.stalls.push(stall);if(this.stalls.length>this.capacity)this.stalls.shift();this.totalStalls++;this.options.onStall?.(stall);
  }
  // Reuse storage on normal frames rather than allocating phase rows each RAF.
  for(let i=0;i<this.phaseCount;i++){const p=this.phases[i]!,old=this.previousPhases[i];if(old){old.name=p.name;old.ms=p.ms;}else this.previousPhases.push({...p});}
  this.previousPhases.length=this.phaseCount;this.previousRaf=this.raf;this.previousEnd=end;this.previousCpu=cpuMs;
 }
 reset(){this.previousRaf=null;this.previousEnd=null;this.previousCpu=null;this.previousPhases.length=0;this.open=false;this.jobs.length=0;}
 snapshot(){return structuredClone({schema:'engine.frame-stalls.v1',thresholdMs:this.threshold,capacity:this.capacity,frames:this.frames,totalStalls:this.totalStalls,overwrittenStalls:Math.max(0,this.totalStalls-this.stalls.length),droppedPhases:this.droppedPhases,droppedJobs:this.droppedJobs,stalls:this.stalls});}
}
