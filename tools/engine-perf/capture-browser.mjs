import {createHash} from 'node:crypto';
import {EngineTrace} from '../../dist/observability/trace.js';

/** Attach only to an explicitly selected running page; never navigate or pause the game. */
export async function captureBrowser({cdp,url,seconds,device,cpuProfile,profile,save}){
  const list=await fetch(new URL('/json/list',cdp),{signal:AbortSignal.timeout(5000)}).then(r=>r.json());
  const targets=list.filter(t=>t.type==='page'&&t.url.startsWith(url));
  if(targets.length!==1)throw Error(`Expected exactly one page matching ${url}; found ${targets.length}`);
  const socket=new WebSocket(targets[0].webSocketDebuggerUrl),pending=new Map();let serial=0;
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{socket.close();reject(Error('Browser connection timed out'));},5000);socket.addEventListener('open',()=>{clearTimeout(timer);resolve();},{once:true});socket.addEventListener('error',()=>{clearTimeout(timer);socket.close();reject(Error('Browser connection failed'));},{once:true});});
  socket.addEventListener('message',event=>{const message=JSON.parse(event.data);const request=pending.get(message.id);if(!request)return;clearTimeout(request.timer);pending.delete(message.id);message.error?request.reject(Error(message.error.message)):request.resolve(message.result);});
  socket.addEventListener('close',()=>{for(const request of pending.values()){clearTimeout(request.timer);request.reject(Error('Browser connection closed'));}pending.clear();});
  const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++serial,timer=setTimeout(()=>{pending.delete(id);reject(Error(`${method} timed out`));},(seconds+20)*1000);pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params}));});
  const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.text+': '+(r.exceptionDetails.exception?.description??''));return r.result.value;};
  let profiling=false;
  try{
    if(cpuProfile){await send('Profiler.enable');await send('Profiler.start');profiling=true;}
    const result=await evaluate(`(async()=>{
      const agent=globalThis.__THEGAME_AGENT__;if(!agent?.rendering?.telemetry)throw Error('TheGame rendering telemetry is unavailable');
      const before=agent.rendering.inspect(),samples=[],longTasks=[];let observer,droppedLongTasks=0,hidden=document.hidden;
      const visibility=()=>{hidden||=document.hidden;};document.addEventListener('visibilitychange',visibility);
      if(globalThis.PerformanceObserver&&PerformanceObserver.supportedEntryTypes.includes('longtask')){observer=new PerformanceObserver(list=>{for(const e of list.getEntries())if(longTasks.length<2048)longTasks.push({at:e.startTime,duration:e.duration});else droppedLongTasks++;});observer.observe({type:'longtask'});}
      const originMs=performance.timeOrigin,start=performance.now();let previous,frame=0;
      try{await new Promise((resolve,reject)=>{function next(now){try{const at=performance.now(),telemetry=agent.rendering.telemetry(),probeMs=performance.now()-at;
        if(samples.length<12000)samples.push({at:now,interval:previous===undefined?null:now-previous,stats:telemetry.stats,probeMs});previous=now;frame++;
        if(now-start>=${seconds*1000})resolve();else requestAnimationFrame(next);}catch(error){reject(error);}}requestAnimationFrame(next);});}
      finally{observer?.disconnect();document.removeEventListener('visibilitychange',visibility);}
      return {originMs,before,after:agent.rendering.inspect(),samples,longTasks,frames:frame,hidden,droppedLongTasks};
    })()`);
    if(profiling){const result=await send('Profiler.stop');profiling=false;save('cpu.cpuprofile',result.profile);}
    const quality=state=>({settings:state.settings,features:state.features,resolution:state.stats?.renderResolution});
    const qualityHash=createHash('sha256').update(JSON.stringify(quality(result.before))).digest('hex');
    const trace=new EngineTrace({source:'game.client',originMs:result.originMs,capacity:262144,budgets:profile,metadata:{device,workloadId:'live-game-uncontrolled',controlledReplay:false,qualityHash,cpuProfile,
      ...(result.before.stats?.renderResolution?{width:result.before.stats.renderResolution[0],height:result.before.stats.renderResolution[1]}:{}),
      captureDroppedSamples:result.frames-result.samples.length+result.droppedLongTasks,
      qualityStable:JSON.stringify(quality(result.before))===JSON.stringify(quality(result.after)),scope:'Live uncontrolled trajectory; quality checked before/after; telemetry adds overhead; no server timeline',hidden:result.hidden}});
    let previousFrame=-1,previousGpu=-1;
    for(const sample of result.samples){
      if(sample.interval!==null)trace.frame(sample.at-sample.interval,sample.at);
      trace.sample('capture.probe.ms',sample.probeMs,{},sample.at);
      const s=sample.stats??{};
      if(typeof s.rendererFrame==='number'&&s.rendererFrame!==previousFrame){
        previousFrame=s.rendererFrame;
        if(Number.isFinite(s.rendererCpuStartedAtMs)&&Number.isFinite(s.rendererCpuSubmittedAtMs))trace.complete('render.submit','render',s.rendererCpuStartedAtMs,s.rendererCpuSubmittedAtMs,{frame:s.rendererFrame});
        if(Number.isFinite(s.rendererCpuMs))trace.sample('render.cpu.ms',s.rendererCpuMs,{frame:s.rendererFrame},sample.at);
      }
      if(typeof s.gpuFrame==='number'&&s.gpuFrame!==previousGpu&&Number.isFinite(s.gpuFrameMs)){
        previousGpu=s.gpuFrame;trace.sample('render.gpu.ms',s.gpuFrameMs,{frame:s.gpuFrame,gpuExecutionPosition:'unavailable'},sample.at);
      }
    }
    for(const task of result.longTasks)trace.complete('browser.longtask','browser',task.at,task.at+task.duration);
    trace.stop();save('browser-evidence.json',result);return trace.snapshot();
  }finally{
    if(profiling)try{await send('Profiler.stop');}catch{}
    for(const request of pending.values()){clearTimeout(request.timer);request.reject(Error('Capture closed'));}pending.clear();socket.close();
  }
}
