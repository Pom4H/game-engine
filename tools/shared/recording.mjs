/** Bounded recording of existing renderer events. No clock, solver, DOM or timer. */
export class FrameRecording {
  constructor({maxFrames=1800,maxImages=300,maxImageBytes=16*1024*1024,maxDurationMs=30000}={}) {
    for(const [value,max] of [[maxFrames,3600],[maxImages,600],[maxImageBytes,64*1024*1024],[maxDurationMs,60000]])
      if(!Number.isSafeInteger(value)||value<1||value>max)throw new RangeError('Invalid recording budget');
    this.limits={maxFrames,maxImages,maxImageBytes,maxDurationMs};this.session=0;this.clear();
  }
  clear(){this.session++;this.active=false;this.frames=[];this.byKey=new Map();this.imageBytes=0;this.images=0;this.reason='';this.startedMs=0;}
  start(at){if(!Number.isFinite(at))throw new RangeError('Invalid recording start');this.clear();this.startedMs=at;this.active=true;}
  stop(reason='Stopped'){this.active=false;this.reason=reason;}
  receive(event,meta={}) {
    const key=`${event.generation}:${event.timing.frame}`;
    if(event.kind==='gpu'){
      const frame=this.byKey.get(key);if(frame)frame.gpu=event.timing;return;
    }
    if(!this.active||this.byKey.has(key))return;
    if(this.frames.length>=this.limits.maxFrames||event.startMs-this.startedMs>this.limits.maxDurationMs){this.stop('Recording budget reached');return;}
    if(!Number.isFinite(event.startMs)||event.startMs<this.startedMs)return;
    const frame={key,index:this.frames.length,startMs:event.startMs,cpu:event.timing,spans:event.spans??[],meta:Object.freeze({...meta}),image:null,captureMs:null};
    this.frames.push(frame);this.byKey.set(key,frame);return frame;
  }
  attachImage(session,key,data,captureMs){
    const frame=this.byKey.get(key);
    if(session!==this.session||!frame||frame.image||!/^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/.test(data))return false;
    // Conservative UTF-16 payload budget, not a claim about total browser heap/VRAM.
    const bytes=data.length*2;
    if(this.images>=this.limits.maxImages||this.imageBytes+bytes>this.limits.maxImageBytes)return false;
    frame.image=data;frame.captureMs=captureMs;this.images++;this.imageBytes+=bytes;return true;
  }
  at(index){return this.frames[Math.max(0,Math.min(this.frames.length-1,Math.round(index)))];}
  imageAt(index){for(let i=Math.min(this.frames.length-1,index);i>=0;i--)if(this.frames[i].image)return this.frames[i];}
  inspect(){return{recording:this.active,frames:this.frames.length,images:this.images,imageBytes:this.imageBytes,reason:this.reason,limits:this.limits};}
  export(){return{kind:'engine-recording/v1',clock:'performance.now milliseconds',...this.inspect(),frames:this.frames};}
}

/** CPU intervals are measured. GPU totals are counters, NOT invented aligned GPU spans. */
export function chromeTrace(recording) {
  const traceEvents=[{ph:'M',pid:1,tid:1,name:'thread_name',args:{name:'Engine render CPU'}}];
  for(const frame of recording.frames){
    const ts=frame.startMs*1000,args={frame:frame.key,...frame.meta};
    traceEvents.push({ph:'X',cat:'engine',name:'Render',pid:1,tid:1,ts,dur:frame.cpu.totalMs*1000,args});
    for(const span of frame.spans)traceEvents.push({ph:'X',cat:'engine',name:span.name,pid:1,tid:1,ts:ts+span.offsetMs*1000,dur:span.durationMs*1000,args});
    if(frame.gpu)traceEvents.push({ph:'C',cat:'engine',name:'GPU pass durations (ms, unaligned)',pid:1,tid:2,ts,args:{...frame.gpu.quanta,total:frame.gpu.totalMs}});
    if(frame.image)traceEvents.push({ph:'O',cat:'disabled-by-default-devtools.screenshot',name:'Screenshot',id:String(frame.index),pid:1,tid:1,ts:ts+frame.cpu.totalMs*1000,args:{snapshot:frame.image.split(',')[1]}});
  }
  return{traceEvents,displayTimeUnit:'ms',metadata:{kind:'engine-render-trace/v1',gpuClockCalibrated:false,screenshotSampling:'up to 10 fps, 640×360; previous image is labelled in viewer'}};
}
