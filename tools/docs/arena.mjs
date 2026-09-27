import {consoleSession,mountConsole} from './console.mjs';
import {mountRecording} from './recording-ui.mjs';
import {CarBallView,arenaOffset as offset} from './engine/examples/car-ball-view.js';
import {arenaProjection} from './engine/examples/car-ball.js';
import {Replica} from './engine/network/playback.js';
import {ArcadeControls} from './engine/runtime/arcade-controls.js';
import {WebGPURenderer} from './engine/render/webgpu.js';
const $=id=>document.getElementById(id),canvas=$('arena'),controls=new ArcadeControls(canvas),view=new CarBallView();
let renderer,worker,replica,token='',seat=-1,epoch=0,sequence=0,serial=0,arrived=0,replay=null,inflight=false,pendingGpu=0,frames=0,dropped=0,disposed=false,lastUI=0;
const camera=[-24,4,7],target=[0,1,0];
function fail(error){$('error').hidden=false;$('error').textContent=String(error.message??error);}
async function request(action,data={}){const r=await fetch('/arena-network/'+action,{method:'POST',headers:{'content-type':'application/json','x-debug-token':token},body:JSON.stringify({...data,epoch})});const result=await r.json();if(!r.ok)throw Error(result.error??'Server error');return result;}
async function join(){
 $('join').disabled=true;
 try{
  if(token)await request('leave').catch(()=>{});
  const ready=await request('join');token=ready.token;seat=ready.seat;epoch=ready.epoch;sequence=ready.sequence;controls.setSerial(ready.jumpSerial);
  replica=new Replica(arenaProjection,epoch,600,16_000_000,.065);replica.receive(ready.frame,performance.now()/1000);arrived=performance.now();replay=null;
  worker?.terminate();worker=new Worker('./network-worker.js',{type:'module'});const current=++serial;
  worker.onmessage=({data})=>{
   if(data.serial!==current)return;
   try{
    if(data.kind==='frame'){
     if(data.frame.epoch!==epoch){epoch=data.frame.epoch;sequence=0;controls.setSerial(0);replica.reset(epoch);replay=null;view.scene.cutPresentation();}
     if(replica.receive(data.frame,performance.now()/1000)){arrived=performance.now();$('error').hidden=true;}
     worker.postMessage({kind:'ack',serial:current});
    }else if(data.kind==='error')fail(data.error);
    else if(data.kind==='status')$('connection').textContent='Потеря соединения · удержание последнего состояния';
   }catch(error){fail(error);worker.postMessage({kind:'ack',serial:current});}
  };
  worker.postMessage({kind:'connect',arena:true,token,serial:current});
  $('driver').textContent=seat<0?'Зритель':seat===0?'Синяя команда':'Оранжевая команда';$('restart').disabled=seat!==0;
  controls.active=seat>=0;$('join').textContent='Переподключиться';$('error').hidden=true;canvas.focus();
 }catch(error){fail('Не удалось войти. Запуск: ARENA=1 bun dev\n'+error.message);}finally{$('join').disabled=false;}
}
$('join').onclick=join;
const timer=setInterval(async()=>{
 if(!token||inflight||disposed)return;inflight=true;
 try{if(seat<0||replay!==null)await request('ping');else await request('input',{sequence:++sequence,controls:controls.sample()});}
 catch(error){$('connection').textContent=error.message;}finally{inflight=false;}
},33);
function live(){replay=null;controls.active=seat>=0;view.scene.cutPresentation();}
$('live').onclick=live;
$('replay').oninput=e=>{if(!replica)return;replay=e.target.valueAsNumber;controls.clear();controls.active=false;view.scene.cutPresentation();};
$('restart').onclick=async()=>{try{const ready=await request('restart');epoch=ready.epoch;sequence=0;controls.setSerial(0);replica.reset(epoch);replica.receive(ready.frame,performance.now()/1000);live();}catch(error){fail(error);}};
const session=consoleSession({sources:{scene:()=>inspect(),ball:()=>position('ball'),car0:()=>position('car0'),car1:()=>position('car1')},actions:{
 live:()=>{live();return 'LIVE';},
 replay:tail=>{const time=Number(tail);if(!tail||!Number.isFinite(time)||time<0)throw Error('replay <seconds>');replay=time;controls.clear();controls.active=false;view.scene.cutPresentation();return 'Replay '+time;},
 record:tail=>recording.command(tail),
}});
const terminal=mountConsole({panel:$('console'),toggle:$('diagnostics'),session,onOpen:()=>{controls.clear();terminal.refresh(session.sample());}});
const recording=mountRecording({host:$('recording-panel'),canvas,runtime:()=>({renderer}),metadata:()=>({serverTick:replica?.latest()?.tick,renderTick:view.scene.tick,epoch,seat}),download:(name,text)=>download(new Blob([text],{type:'application/json'}),name)});
$('record').onclick=()=>{$('recording-panel').hidden=!$('recording-panel').hidden;};
function position(name){const v=replica?.at(view.scene.time).rows[0]?.values,o=offset[name];return v?Array.from(v.subarray(o,o+3)):null;}
function inspect(){return{epoch,seat,tick:replica?.latest()?.tick,renderTick:view.scene.tick,renderTime:view.scene.time,frames,dropped,pendingGpu,network:replica?.inspect(),clientPhysicsSteps:view.scene.physics.steps,clientBodies:view.scene.physics.bodies.size,renderer:renderer?.inspect()};}
function download(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function draw(now){
 if(disposed)return;recording.refresh(now);requestAnimationFrame(draw);if(!renderer||!replica||pendingGpu>=2){if(renderer&&replica)dropped++;return;}
 const sample=replay===null?replica.present(now/1000):replica.at(replay),v=sample.rows[0]?.values;if(!v)return;
 view.apply(sample);
 const k=offset[seat===1?'car1':'car0'],r=offset[seat===1?'rotation1':'rotation0'],bp=offset.ball;
 let dx=Math.cos(v[r+1]),dz=-Math.sin(v[r+1]);
 if(controls.ballCamera){const x=v[bp]-v[k],z=v[bp+2]-v[k+2],l=Math.hypot(x,z);if(l>1){dx=x/l;dz=z/l;}}
 const desired=[v[k]-dx*9,v[k+1]+4,v[k+2]-dz*9],look=controls.ballCamera?[v[bp],v[bp+1],v[bp+2]]:[v[k]+dx*9,v[k+1]+.6,v[k+2]+dz*9];
 for(let a=0;a<3;a++){camera[a]+=(desired[a]-camera[a])*.16;target[a]+=(look[a]-target[a])*.3;}
 // Keep the spectator camera inside the field instead of hiding it behind the arena walls.
 camera[0]=Math.max(-27,Math.min(27,camera[0]));camera[2]=Math.max(-17,Math.min(17,camera[2]));camera[1]=Math.max(1.2,Math.min(11,camera[1]));
 view.scene.setCamera({position:camera,target,fov:75});
 try{renderer.render(view.scene);pendingGpu++;frames++;void renderer.flush().catch(fail).finally(()=>pendingGpu--);}catch(error){fail(error);}
 if(now-lastUI>150){
  lastUI=now;const state=replica.inspect();$('blue').textContent=Math.round(v[offset.score]);$('orange').textContent=Math.round(v[offset.score+1]);const seconds=Math.ceil(v[offset.remaining]);$('clock').textContent=`${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`;
  $('phase').textContent=replay!==null?'ПОВТОР':['СТАРТ','МАТЧ','ГОЛ','КОНЕЦ'][v[offset.phase]];
  const boost=v[offset.boost+Math.max(0,seat)];$('boost').querySelector('b').textContent=Math.round(boost);$('boost').querySelector('meter').value=boost;
  $('connection').textContent=now-arrived>1000?'НЕТ СВЕЖИХ ПАКЕТОВ':`LIVE · tick ${state.latestTick} · ${controls.ballCamera?'BALL CAM':'CAR CAM'}`;
  const slider=$('replay');slider.min=state.oldest;slider.max=state.newest;if(document.activeElement!==slider)slider.value=replay??sample.time;
  if(!$('console').hidden){$('metrics').textContent=`server tick ${state.latestTick} | render ${sample.fromTick} → ${sample.toTick} | alpha ${sample.alpha.toFixed(3)}\n${state.frames} snapshots | ${(state.payloadBytes/1024).toFixed(0)} KiB | renderer ${renderer.inspect().backend} | GPU in-flight ${pendingGpu}\nclient physics steps ${view.scene.physics.steps} | bodies ${view.scene.physics.bodies.size} | ball vertices ${view.ballMesh.positions.length/3}`;
   terminal.refresh(session.sample());}
 }
}
globalThis.__ARENA__={inspect,get recording(){return recording;},get terminal(){return terminal;},get view(){return view;},get replica(){return replica;},get controls(){return controls;},get renderer(){return renderer;},request,join,seek:time=>{replay=time;controls.clear();controls.active=false;view.scene.cutPresentation();},live};
window.addEventListener('pagehide',()=>{disposed=true;clearInterval(timer);worker?.terminate();controls.dispose();terminal.dispose();recording.dispose();view.dispose();renderer?.dispose();if(token)void fetch('/arena-network/leave',{method:'POST',headers:{'x-debug-token':token,'content-type':'application/json'},body:'{}',keepalive:true});});
function resize(){const scale=Math.min(1,1280/innerWidth,720/innerHeight);renderer?.setResolution(Math.max(1,Math.round(innerWidth*scale)),Math.max(1,Math.round(innerHeight*scale)));}
window.addEventListener('resize',resize);
try{if(!isSecureContext)throw Error('WebGPU требует HTTPS или localhost. Открой арену через защищённый адрес.');renderer=await WebGPURenderer.create(canvas,{profiling:true});resize();requestAnimationFrame(draw);await join();}catch(error){fail(error);}
