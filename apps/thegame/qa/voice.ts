import {SpatialAudio} from '../../../src/audio/spatial.js';
import {idleCharacterInput} from '../../../src/runtime/character-motor.js';
import {GameConnection} from '../client/connection.js';
import {localPoint,type Vec3} from '../shared.js';

// Developer-only, real browser RTC proof. The source is a synthetic WebAudio
// stream, so this page never calls getUserMedia or requests microphone access.
const start=document.querySelector<HTMLButtonElement>('#start-voice-test')!;
const stop=document.querySelector<HTMLButtonElement>('#stop-voice-test')!;
const output=document.querySelector<HTMLElement>('#report')!;
const indicator=document.querySelector<HTMLElement>('#speaking-indicator')!;
const names=['audio','connections','identity','stream','speaking','disable','cleanup'] as const;
type Stage=typeof names[number];
type StageValue={state:'pending'|'passed'|'failed';message:string};
type Report={state:'idle'|'running'|'passed'|'failed'|'stopped';stages:Record<Stage,StageValue>;actorId:string|null;remoteActorId:string|null;floor:number|null;maxRms:number;hrtf:boolean;sourceCalls:number;sourceEnded:boolean;streamCleared:boolean;indicatorCleared:boolean;elapsedMs:number;error?:string};
const fresh=():Report=>({state:'idle',stages:Object.fromEntries(names.map(name=>[name,{state:'pending',message:'Waiting'}])) as Record<Stage,StageValue>,actorId:null,remoteActorId:null,floor:null,maxRms:0,hrtf:false,sourceCalls:0,sourceEnded:false,streamCleared:false,indicatorCleared:false,elapsedMs:0});
let report=fresh(),version=0,cleanup:(()=>Promise<void>)|null=null;
function render(){
 document.documentElement.dataset.voiceQa=report.state;
 output.dataset.report=JSON.stringify(report);output.textContent=JSON.stringify(report,null,2);
 for(const name of names){const row=document.querySelector<HTMLElement>(`#stage-${name}`)!;row.dataset.state=report.stages[name].state;row.textContent=`${name}: ${report.stages[name].state.toUpperCase()} — ${report.stages[name].message}`;}
 start.disabled=report.state==='running';stop.disabled=report.state!=='running';
}
function stage(name:Stage,state:StageValue['state'],message:string){report.stages[name]={state,message};render();}
function markSpeaking(value:boolean){indicator.dataset.speaking=String(value);indicator.textContent=value?'🔊 Receiving speech':'Speaker silent';}
const sleep=(ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms));

start.addEventListener('click',()=>void run());
stop.addEventListener('click',()=>{version++;report.state='stopped';report.error='Stopped by user';void cleanup?.().then(render);render();});
window.addEventListener('pagehide',()=>{version++;void cleanup?.();});
markSpeaking(false);render();

async function run(){
 if(report.state==='running')return;
 const current=++version,started=performance.now();report=fresh();report.state='running';markSpeaking(false);render();
 let step:Stage='audio',publisher:GameConnection|null=null,observer:GameConnection|null=null,detach:(()=>void)|null=null,remote:MediaStream|null=null,timer:ReturnType<typeof setInterval>|null=null;
 let cleaned=false,sourceStopped=false,aborted=false;
 const audio=new SpatialAudio(),context=new AudioContext({latencyHint:'interactive'}),oscillator=context.createOscillator(),gain=context.createGain(),destination=context.createMediaStreamDestination();
 const tone=destination.stream;oscillator.frequency.value=440;gain.gain.value=.04;oscillator.connect(gain).connect(destination);oscillator.start();
 // Both context resumes occur inside the actual user gesture, before any fetch.
 const unlocked=Promise.all([audio.unlock(),context.resume()]);
 audio.onSpeaking=activity=>{if(activity.id===report.actorId)markSpeaking(activity.speaking);};
 const dispose=async()=>{
  if(cleaned)return;cleaned=true;if(timer!==null){clearInterval(timer);timer=null;}
  observer?.dispose();publisher?.dispose();detach?.();detach=null;remote=null;audio.dispose();
  if(!sourceStopped){sourceStopped=true;oscillator.stop();}oscillator.disconnect();gain.disconnect();destination.disconnect();
  for(const track of tone.getTracks())track.stop();if(context.state!=='closed')await context.close();if(current===version)markSpeaking(false);
 };
 cleanup=dispose;
 const check=()=>{if(aborted||current!==version)throw new Error('Test stopped');if(performance.now()-started>=15_000)throw new Error('Voice test exceeded 15 seconds');};
 const wait=async(condition:()=>boolean)=>{while(!condition()){check();await sleep(25);}check();};
 let deadline:ReturnType<typeof setTimeout>|null=null;
 try{
  await Promise.race([
   (async()=>{
    await unlocked;check();if(context.state!=='running'||audio.inspect().state!=='running')throw new Error('Audio did not unlock from user gesture');
    stage('audio','passed','440 Hz synthetic MediaStream; microphone access never requested');
    step='connections';
    const socket=new URL('/world',location.href);socket.protocol=location.protocol==='https:'?'wss:':'ws:';
    observer=new GameConnection({url:socket.href,role:'observer',entry:'office',onVoiceStream:({actorId,stream})=>{
     if(current!==version||actorId!==report.actorId)return;
     detach?.();detach=null;remote=stream;
     if(stream){report.remoteActorId=actorId;const position=publisher?.authoritativeSelf?.position??[0,0,0];detach=audio.attachStream(actorId,stream,[position[0],position[1]+1.65,position[2]],{volume:.005});}
     render();
    }});
    // Establish the observer first so both sockets use one existing HttpOnly
    // session even when someone opens this fixture without a prior game tab.
    observer.connect();await wait(()=>observer!.status.state==='connected');
    publisher=new GameConnection({url:socket.href,role:'player',entry:'street',name:sessionStorage.getItem('thegame:name')??'Игрок',audioSource:async()=>{report.sourceCalls++;return tone;}});
    publisher.connect();await wait(()=>publisher!.status.state==='connected'&&publisher!.status.controlling&&publisher!.authoritativeSelf!==null);
    if(observer.status.controlling)throw new Error('Listener unexpectedly acquired control');
    stage('connections','passed','Two real GameConnections; observer has no control');
    step='identity';const self=publisher.authoritativeSelf!,binding=publisher.binding!;
    const local=localPoint(binding,self.position),floor=Math.round(local[1]/binding.floorHeight);report.floor=floor;report.actorId=self.id;
    if(binding.officeFloor!==2||floor!==2||Math.abs(local[1]-2*binding.floorHeight)>.25)throw new Error(`Current actor is on floor ${floor}; enter Office floor 2 physically in The Game before this test`);
    if(publisher.inspect().actorId!==self.id)throw new Error('Controlled actor differs from authenticated server identity');
    publisher.input(idleCharacterInput(self.yaw));await wait(()=>!!observer!.present()?.actors.some(actor=>actor.id===self.id));
    stage('identity','passed',`Authenticated actor ${self.id} on Office floor 2`);
    timer=setInterval(()=>{
     if(current!==version)return;
     const presentation=observer!.present(),actor=presentation?.actors.find(value=>value.id===report.actorId);
     if(actor){const p:Vec3=[actor.position[0],actor.position[1]+1.65,actor.position[2]];audio.position(actor.id,p);audio.setListener([p[0]+2,p[1],p[2]],p);}
     for(const activity of audio.sampleActivity()){if(activity.id===report.actorId)report.maxRms=Math.max(report.maxRms,activity.level);}
     report.elapsedMs=Math.round(performance.now()-started);render();
    },25);
    step='stream';await publisher.publishVoice(true);check();await wait(()=>remote!==null&&remote.getAudioTracks().some(track=>track.readyState==='live'&&!track.muted));
    if(report.sourceCalls!==1||report.remoteActorId!==self.id)throw new Error('Remote voice stream identity/source does not match controlled actor');
    report.hrtf=audio.inspect().emitters.some(emitter=>emitter.id===self.id&&emitter.kind==='stream'&&emitter.panning==='HRTF');
    if(!report.hrtf)throw new Error('Received RTC stream did not attach to Engine HRTF');
    stage('stream','passed',`Actual RTC audio track bound to ${self.id}; Engine HRTF output gain 0.005`);
    step='speaking';await wait(()=>report.maxRms>=.015&&indicator.dataset.speaking==='true');
    stage('speaking','passed',`Incoming RMS ${report.maxRms.toFixed(5)} exceeds default 0.015 threshold; speaker indicator active`);
    step='disable';await publisher.publishVoice(false);check();report.sourceEnded=tone.getTracks().every(track=>track.readyState==='ended');
    await wait(()=>remote===null&&audio.inspect().emitters.length===0&&indicator.dataset.speaking==='false'&&!publisher!.status.voice);
    report.streamCleared=remote===null&&audio.inspect().emitters.length===0;report.indicatorCleared=indicator.dataset.speaking==='false';
    if(!report.sourceEnded)throw new Error('Disabled voice left owned synthetic source tracks live');
    stage('disable','passed','Owned source ended; remote stream, Engine emitter and speaker indicator cleared');
   })(),
   new Promise<never>((_,reject)=>{deadline=setTimeout(()=>reject(new Error('Voice test exceeded 15 seconds')),15_000);}),
  ]);
  step='cleanup';await dispose();check();stage('cleanup','passed','Both sockets, RTC sessions, tracks, WebAudio nodes and contexts released');report.state='passed';
 }catch(error){
  aborted=true;
  if(current===version){report.state='failed';report.error=String((error as Error).message??error);stage(step,'failed',report.error);}
 }finally{
  if(deadline!==null)clearTimeout(deadline);await dispose();if(current===version){report.elapsedMs=Math.round(performance.now()-started);render();}if(cleanup===dispose)cleanup=null;
 }
}
