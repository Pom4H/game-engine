import type {EnvironmentMapInput,EnvironmentMapData} from './environment-map.js';
import {EnvironmentBakeCursor} from './environment-map-bake.js';
export interface BakeTaskPort{onmessage:((event:unknown)=>void)|null;postMessage(value:number):void;close():void}
export interface BakeTaskChannel{port1:BakeTaskPort;port2:BakeTaskPort}
export interface BakeWorkerDriverOptions{
 publish(data:EnvironmentMapData):void;
 fail(error:unknown):void;
 channel?:()=>BakeTaskChannel;
 now?:()=>number;
}
/** One active job and at most one MessageChannel notification. Host ownership
 * still provides its existing one-active/one-latest request/cancel contract. */
export function createEnvironmentBakeWorkerDriver(options:BakeWorkerDriverOptions){
 const channel=options.channel?.()??new MessageChannel(),now=options.now??(()=>performance.now());
 let job:EnvironmentBakeCursor|undefined,disposed=false,pending=false,pumping=false,sendFromPort2=true;
 const dispose=()=>{
  if(disposed)return;disposed=true;const old=job;job=undefined;pending=false;old?.cancel();channel.port1.onmessage=null;channel.port2.onmessage=null;
  try{channel.port1.close();}finally{channel.port2.close();}
 };
 const fail=(error:unknown)=>{try{dispose();}finally{options.fail(error);}};
 const schedule=()=>{
  if(disposed||pending||!job)return;pending=true;
  // Never refill the currently receiving port's queue from inside its dispatch.
  // Both directions share this ONE pending notification and the same work cap.
  const sender=sendFromPort2?channel.port2:channel.port1;sendFromPort2=!sendFromPort2;
  try{sender.postMessage(0);}catch(error){pending=false;fail(error);}
 };
 const pump=()=>{
  pending=false;if(disposed||pumping||!job)return;pumping=true;
  try{
   const current=job,deadline=now()+1;let units=0;
   // A deadline is only a secondary stop between finite 32-unit chunks.
   // Even a constant/low-resolution clock cannot cause an unbounded pump.
   do{current.step(32);units+=32;}while(!current.done&&units<4096&&now()<deadline);
   if(disposed||job!==current)return;
   if(current.done){const data=current.data;job=undefined;current.cancel();options.publish(data);}
  }catch(error){fail(error);}
  finally{pumping=false;schedule();}
 };
 channel.port1.onmessage=pump;channel.port2.onmessage=pump;
 return{
  receive(input:EnvironmentMapInput){if(disposed)throw Error('Environment bake driver is disposed');if(job)throw Error('Environment bake worker received overlapping jobs');job=new EnvironmentBakeCursor(input);schedule();},
  dispose,
  inspect(){return{active:job!==undefined,pending,disposed};},
 };
}
