/** Diagnostic-only CPU phase timings. Keep the renderer's GPU profiler disabled:
 * enabling it would add occlusion queries and extra GPU/readback work. */
export class RenderCpuPhaseObserver {
  constructor(profiler,clock=()=>performance.now()) {
    if(profiler.enabled!==false||profiler.timestampQueries!==false||typeof profiler.measure!=='function')throw new Error('CPU phase observation requires a disabled renderer profiler');
    this.profiler=profiler;this.clock=clock;this.active=null;this.stack=[];
    this.original=profiler.measure;const observer=this;
    this.wrapper=function(name,run){
      if(!observer.active)return observer.original.call(this,name,run);
      const frame=observer.active,entry={children:0};observer.stack.push(entry);const start=observer.clock();
      try{return observer.original.call(this,name,run);}finally{
        const inclusiveMs=observer.clock()-start;observer.stack.pop();const parent=observer.stack.at(-1);if(parent)parent.children+=inclusiveMs;
        const exclusiveMs=Math.max(0,inclusiveMs-entry.children),phase=frame.phases[name]??={calls:0,inclusiveMs:0,exclusiveMs:0};
        phase.calls++;phase.inclusiveMs+=inclusiveMs;phase.exclusiveMs+=exclusiveMs;frame.coveredMs+=exclusiveMs;
      }
    };
    profiler.measure=this.wrapper;
  }
  beginFrame(frame) {
    if(this.active||this.stack.length)throw new Error('CPU phase frame already active');
    if(!Number.isSafeInteger(frame)||frame<0)throw new Error('Invalid CPU phase frame');
    this.active={frame,coveredMs:0,phases:{}};
  }
  endFrame(cpuMs) {
    if(!this.active||this.stack.length)throw new Error('CPU phase frame is not complete');
    const result=this.active;this.active=null;
    if(!Number.isFinite(cpuMs)||cpuMs<0||result.coveredMs>cpuMs+1e-6)throw new Error('CPU phases exceed measured render interval');
    return {...result,remainingMs:Math.max(0,cpuMs-result.coveredMs)};
  }
  dispose() {
    if(this.profiler.measure!==this.wrapper)throw new Error('CPU phase hook replaced before disposal');
    this.profiler.measure=this.original;this.active=null;this.stack.length=0;
  }
}
