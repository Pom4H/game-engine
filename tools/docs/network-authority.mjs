/** Local debug authority isolate. No sockets, browser rendering, remote eval or source-code execution. */
import {parentPort,workerData} from 'node:worker_threads';
import {writeHeapSnapshot} from 'node:v8';
import {Scene} from '../../dist/scene/scene.js';
import {validateProgram} from '../../dist/dsl/index.js';
import {installProgram,programVehicles} from '../../dist/dsl/runtime.js';
import {applyLiveProgram,planProgramEdit} from '../../dist/dsl/edits.js';
import {AuthoritySession,sceneMotion,captureSceneMotion,presentationScene} from '../../dist/network/index.js';
let scene=null,session=null,program=null,epoch=workerData.epoch,last=performance.now(),debt=0,publishedTick=-1;
const status=()=>({epoch,tick:scene?.tick??0,time:scene?.time??0,paused:session?.paused??true});
function dump(){return {kind:'domain-inspection/v1',...status(),restorable:false,
 note:'Selected domain inspection, not a complete physics checkpoint. Heap snapshots are separate local files.',
 memory:process.memoryUsage(),physics:scene.physics.stats,history:session.history.inspect(),
 bodies:[...scene.physics.bodies.values()].map(b=>({id:b.id,mass:b.mass,position:[...b.position],velocity:[...b.velocity],rotation:[...b.rotation],angularVelocity:[...b.angularVelocity]})),
 vehicles:[...programVehicles(scene)].map(([id,h])=>({id,parts:h.vehicle.blueprint.parts.map(p=>({...h.vehicle.part(p.source.id)}))}))};}
function initialize(next){
 validateProgram(next);const fresh=new Scene(next.scene);try{installProgram(fresh,next);}catch(error){fresh.dispose();throw error;}
 scene?.dispose();scene=fresh;program=next;epoch++;publishedTick=-1;
 session=new AuthoritySession({get tick(){return scene.tick;},get time(){return scene.time;},step(dt){scene.step(dt);scene.drainEvents();scene.contacts.drainFootsteps();},capture:at=>captureSceneMotion(scene,at),dump},sceneMotion,epoch,peer=>peer==='owner');
 debt=0;last=performance.now();
 return {kind:'ready',...status(),scene:presentationScene(scene),motionIds:[...scene.renderMoverIds()],frame:publish()};
}
function publish(){const pub=session.publish();publishedTick=scene.tick;parentPort.postMessage({kind:'frame',text:pub.text(),...status()});return pub.frame;}
parentPort.on('message',message=>{
 const {id,action}=message;
 try{
  let result;
  if(action==='init')result=initialize(message.program);
  else if(!session)throw new Error('No authority');
  else if(action==='edit'){
   if(!session.paused||message.epoch!==epoch||message.expectedTick!==scene.tick)throw new Error('Pause the current authoritative tick before editing');
   validateProgram(message.program);const edit=planProgramEdit(program,message.program);
   if(edit.mode==='live'){applyLiveProgram(scene,program,message.program,edit);program=message.program;result={mode:'live',...status(),frame:publish()};}
   else result={mode:'rebuild',...initialize(message.program)};
  }else if(action==='replay'){
   if(message.epoch!==epoch)throw new Error('Stale replay epoch');result={...status(),frames:session.history.exportRange(message.from,message.to)};
  }else if(action==='heap'){
   session.command('owner',{action:'dump',epoch:message.epoch,expectedTick:message.expectedTick});
   if(!workerData.heapPath)throw new Error('Heap capture disabled; set NETWORK_HEAP=1 locally');
   const path=writeHeapSnapshot(workerData.heapPath);result={...status(),path,kind:'v8-worker-heap',note:'Private local file. This blocks this paused authority isolate, not the HTTP host or renderer.'};
  }else{
   result=session.command(message.peer??'viewer',{action,epoch:message.epoch,expectedTick:message.expectedTick});
   debt=0;last=performance.now();result.frame=publish();
  }
  parentPort.postMessage({id,text:JSON.stringify(result),ready:action==='init'||action==='edit'&&result.mode==='rebuild'});
 }catch(error){parentPort.postMessage({id,error:String(error.message??error)});}
});
setInterval(()=>{
 const now=performance.now(),elapsed=Math.min(.1,(now-last)/1000);last=now;if(!session||session.paused){debt=0;return;}
 debt+=elapsed;const count=Math.min(4,Math.floor(debt*60));if(!count)return;
 try{session.advance(count);debt=Math.min(.1,Math.max(0,debt-count/60));if(scene.time>=program.durationSeconds)session.paused=true;
  if(scene.tick-publishedTick>=3||session.paused)publish();
 }catch(error){session.paused=true;parentPort.postMessage({kind:'error',error:String(error)});}
},8);
