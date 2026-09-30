import {RuntimeTimeline} from '../engine/core/runtime-timeline.js';
import {CpuProfiler} from '../engine/core/profiling.js';
import {project,arena} from '../engine/games/car-ball-project.js';
import {FixedClock} from '../engine/core/fixed-clock.js';
/** Explicit local authority. Rendering still consumes the same absolute projection;
 * never a client-side second solver for a remote room. */
let runtime,world,epoch=0,sequence=0,serial=0,connected=false,awaiting=false,pending=null,paused=false;
let trace=new RuntimeTimeline(),profiler=new CpuProfiler();
const clock=new FixedClock(1000/120,100,6);
function capture(){return world.capture({epoch,sequence:++sequence,tick:world.tick,time:world.time,paused});}
function publish(frame){if(!connected)return;if(awaiting){pending=frame;return;}awaiting=true;self.postMessage({kind:'frame',serial,frame});}
function install(definition={id:'car-ball',config:{},presets:{}},preset,initialEpoch=epoch+1){
 if(!Number.isSafeInteger(initialEpoch)||initialEpoch<=epoch)throw Error('Local installation requires a newer epoch');
 const next=project({id:definition.id,modules:{rules:arena(definition.config)},presets:definition.presets}).start(preset);
 runtime?.dispose();runtime=next;world=next.values.rules;epoch=initialEpoch;sequence=0;awaiting=false;pending=null;clock.reset(performance.now());
 return {token:'local',seat:0,epoch,sequence:0,jumpSerial:0,frame:capture(),transport:{mode:'local'}};
}
function request(action,data){
 if(action==='join')return install(data.definition,data.preset,data.epoch);
 if(!world)throw Error('Local room not installed');
 if(action==='restart')return install(data.definition??{id:'car-ball',config:world.config,presets:{}},data.preset);
 if(action==='leave'){connected=false;world.release(0);return{ok:true};}
 if(action==='ping')return{ok:true};
 if(data.epoch!==epoch)throw Error('Stale local authority epoch');
 if(action==='input'){world.input(0,data.sequence,data.controls);return{ok:true};}
 if(action==='pause'){paused=!!data.paused;world.release(0);clock.reset(performance.now());publish(capture());return{ok:true};}
 if(action==='trace'){if(data.enabled!==undefined){trace=new RuntimeTimeline({enabled:!!data.enabled,capacity:1024});profiler=new CpuProfiler({enabled:!!data.enabled,timeline:trace});}return{trace:trace.snapshot(),budget:trace.diagnostics,profile:profiler.inspect()};}
 if(action==='inspect')return{...world.dump(),config:world.config,epoch,paused,droppedMs:clock.droppedMs,pending:Number(awaiting)+Number(!!pending)};
 throw Error('Unknown local authority action');
}
self.onmessage=({data})=>{
 try{
  if(data.kind==='request'){
   if(!Number.isSafeInteger(data.id)||data.id<1)throw Error('Invalid request id');
   const result=request(data.action,data.data??{});self.postMessage({kind:'response',id:data.id,result});
  }else if(data.kind==='connect'){serial=data.serial;connected=true;awaiting=false;pending=null;publish(capture());}
  else if(data.serial===serial){
   if(data.kind==='ack'){awaiting=false;if(pending){const next=pending;pending=null;publish(next);}}
   else if(data.kind==='input'&&data.epoch===epoch)world?.input(0,data.sequence,data.controls);
  }
 }catch(error){self.postMessage(data.kind==='request'?{kind:'response',id:data.id,error:String(error.message??error)}:{kind:'error',serial,error:String(error.message??error)});}
};
setInterval(()=>{
 if(!world||!connected||paused)return;
 try{const advanced=clock.advance(performance.now(),()=>{if(profiler.enabled)profiler.measure('physics:tick',()=>world.step());else world.step();});if(advanced)publish(capture());}
 catch(error){paused=true;self.postMessage({kind:'error',serial,error:String(error.message??error)});}
},1000/60);
