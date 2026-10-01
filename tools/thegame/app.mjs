import {WebGPURenderer} from '../../engine/render/webgpu.js';
import {ThegameView} from '../../engine/games/thegame/view.js';
import {OpenWorld,climateAt,BIOME_NAMES,WORLD_REVISION} from '../../engine/games/thegame/world.js';
import {readSelf,readCharacterInput,thegameConfig,worldSignature,peopleProjection,LANDMARKS} from '../../engine/games/thegame/session.js';
import {stepCharacter,idleCharacterInput} from '../../engine/runtime/character-motor.js';
import {InputReplay} from '../../engine/network/input-replay.js';
import {Replica} from '../../engine/network/playback.js';
import {FixedClock} from '../../engine/core/fixed-clock.js';
import {timingStats} from '../../engine/core/profiling.js';
import {FrameHealth} from '../../engine/core/frame-health.js';
import {workbench} from '../../shared/workbench.mjs';
const $=s=>document.querySelector(s),canvas=$('#world'),loading=$('#loading'),text=$('#loading-text'),clock=new FixedClock(1000/60,80,4),network=new Worker(new URL('./network-worker.mjs',import.meta.url),{type:'module'});
const store={get(key){try{return sessionStorage.getItem(key);}catch{return null;}},set(key,value){try{sessionStorage.setItem(key,value);}catch{}}};
$('#name').value=store.get('thegame:name')??'Игрок';let token=store.get('thegame:resume'),renderer,view,world,replay,replica,config,id,wb,previous,authoritative,status='idle',sent=0,pump=false,net={},yaw=Math.PI/2,pitch=.28,override=null,lastFrame=0,lastHud=0,lastPacketTick=-1,discovered=0,players=0,connectedAt=0,nextRetry=Infinity,failures=0,paused=false,stopped=false,ready=false,startup=performance.now();
let corrections=[0,0,0],lastDraw=null;const keys=new Set(),touch=new Set(),metrics={frames:[],prediction:[],correction:[],inputToMotion:[],travel:0,maxFrameMs:0,networkResets:0,startupMs:0};let pendingInputAt=0;
const bounded=(array,value)=>{if(array.length>=1200)array.shift();array.push(value);};
const frameHealth=new FrameHealth(),submittedHealth=new FrameHealth();let lastSubmittedAt=0,healthStartedAt=0;const longFrames=[];
let longFrameObserver;
if(globalThis.PerformanceObserver?.supportedEntryTypes?.includes('long-animation-frame')){
 longFrameObserver=new PerformanceObserver(list=>{for(const entry of list.getEntries())if(entry.startTime>=healthStartedAt){
  if(longFrames.length>=32)longFrames.shift();longFrames.push({start:entry.startTime,duration:entry.duration,blocking:entry.blockingDuration,scripts:entry.scripts?.slice(0,8).map(script=>({duration:script.duration,function:script.sourceFunctionName,source:script.sourceURL?.split('?')[0].split('/').slice(-2).join('/')}))});
 }});longFrameObserver.observe({type:'long-animation-frame',buffered:false});
}
function connect(){if(stopped||document.hidden)return;token=store.get('thegame:resume');status='connecting';sent=0;connectedAt=performance.now();nextRetry=Infinity;ready=false;loading.hidden=false;text.textContent='Подключаемся к общему серверу…';store.set('thegame:name',$('#name').value);network.postMessage({type:'connect',url:new URL('/thegame/socket',location.href).href.replace(/^http/,'ws'),name:$('#name').value.slice(0,24),resume:token});}
function close(reason){status='closed';keys.clear();touch.clear();override=null;ready=false;text.textContent=reason;loading.hidden=false;network.postMessage({type:'close'});nextRetry=performance.now()+Math.min(6000,1000*++failures);}
function welcome(packet){
 if(packet.version!==WORLD_REVISION||!Number.isSafeInteger(packet.epoch)||typeof packet.id!=='string'||typeof packet.token!=='string')throw Error('Несовместимый сервер');
 const candidate=thegameConfig(packet.config),self=readSelf(packet.self);if(packet.world!==worldSignature(candidate))throw Error('Версия мира не совпала');
 config=candidate;id=packet.id;token=packet.token;store.set('thegame:resume',token);authoritative=self.state;discovered=self.discovered;players=1;
 if(!world||world.seed!==config.seed){view?.dispose();view=null;renderer=null;world?.dispose();world=new OpenWorld(config.seed,64);}
 replay=new InputReplay(self.state,s=>({...s}),(p,input)=>stepCharacter(p,input,world,1/60,config),120);previous={...self.state};replica=new Replica(peopleProjection,packet.epoch,64,512_000,.12);sent=0;lastPacketTick=-1;corrections=[0,0,0];yaw=self.state.lookYaw;clock.reset(performance.now());status='connected';failures=0;metrics.networkResets++;text.textContent='Готовим ближайшие кварталы…';
 if(!view)void initializeView();else view.configure(config);
}
async function initializeView(){try{renderer=await WebGPURenderer.create(canvas,{profiling:true});if(stopped){renderer.dispose();return;}resize();view=new ThegameView(renderer,world,config);await source();}catch(error){close('Не удалось запустить WebGPU: '+error.message);nextRetry=Infinity;}}
async function source(){if(wb)return;const code=await(await fetch('./project.ts')).text();if(stopped)return;wb=workbench({host:$('#workbench'),game:'thegame',source:code,onApply:async(compiled,preset,{signal})=>{const next=thegameConfig({...compiled.config,...(preset?compiled.presets[preset]?.rules:{})});if(worldSignature(next)!==worldSignature(config))throw Error('Мир общий: seed и физика применяются после перезапуска сервера. Сейчас можно менять viewRadius и exposure.');if(signal.aborted)return;view.configure(next);}});}
network.onmessage=({data})=>{
 pump=false;if(stopped)return;net=data;sent=Math.max(sent,data.sent??0);
 try{if(data.welcome)welcome(data.welcome);if(data.packet&&replay&&status==='connected'){
  const packet=data.packet;if(packet.world!==worldSignature(config))throw Error('Сервер изменил мир — переподключись');const self=readSelf(packet.self);
  if(packet.frame.tick>lastPacketTick&&replica.receive(packet.frame,performance.now()/1000)){
   const old={...replay.state};if(replay.correct(self.ack,self.state)){const next=replay.state,dx=old.x-next.x,dy=old.y-next.y,dz=old.z-next.z,distance=Math.hypot(dx,dy,dz);bounded(metrics.correction,distance);if(distance<.6){corrections[0]+=dx;corrections[1]+=dy;corrections[2]+=dz;}else {corrections=[0,0,0];view?.scene.cutPresentation();}if(Math.hypot(...corrections)>.6)corrections=[0,0,0];previous={...next};authoritative=self.state;discovered=self.discovered;players=packet.players;lastPacketTick=packet.frame.tick;}
  }
 }if(data.status==='closed'&&status!=='closed')close(data.reason||'Связь потеряна. Переподключаемся…');
 }catch(error){close(error.message);}
};network.onerror=e=>{close('Ошибка сетевого worker: '+e.message);nextRetry=Infinity;};
function resize(){if(renderer)renderer.setResolution(Math.max(320,Math.round(innerWidth*Math.min(1,devicePixelRatio))),Math.max(240,Math.round(innerHeight*Math.min(1,devicePixelRatio))));}addEventListener('resize',resize);
const editing=()=>!$('#workbench').hidden||['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName);
function input(){return override??{forward:(keys.has('KeyW')||keys.has('ArrowUp')||touch.has('forward')?1:0)-(keys.has('KeyS')||keys.has('ArrowDown')||touch.has('back')?1:0),right:(keys.has('KeyD')||keys.has('ArrowRight')||touch.has('right')?1:0)-(keys.has('KeyA')||keys.has('ArrowLeft')||touch.has('left')?1:0),yaw,sprint:keys.has('ShiftLeft')||keys.has('ShiftRight')||touch.has('sprint'),jump:keys.has('Space')||touch.has('jump')};}
addEventListener('keydown',e=>{if(e.code==='Backquote'){e.preventDefault();$('#stats').hidden=!$('#stats').hidden;return;}if(editing())return;if(e.code==='KeyM'){$('#mini').hidden=!$('#mini').hidden;return;}if(['KeyW','KeyS','KeyA','KeyD','Space','ShiftLeft','ShiftRight','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code)){e.preventDefault();if(!keys.size)pendingInputAt=performance.now();keys.add(e.code);}});addEventListener('keyup',e=>keys.delete(e.code));addEventListener('blur',()=>{keys.clear();touch.clear();override=null;});
canvas.oncontextmenu=e=>e.preventDefault();let pointer=null;
canvas.onpointerdown=e=>{if(editing())return;pointer={id:e.pointerId,x:e.clientX,y:e.clientY};canvas.setPointerCapture(e.pointerId);};canvas.onpointermove=e=>{if(pointer?.id!==e.pointerId)return;yaw-=Math.max(-100,Math.min(100,e.clientX-pointer.x))*.005;yaw=Math.atan2(Math.sin(yaw),Math.cos(yaw));pitch=Math.max(-.1,Math.min(1.1,pitch+(e.clientY-pointer.y)*.004));pointer={id:e.pointerId,x:e.clientX,y:e.clientY};};canvas.onpointerup=canvas.onpointercancel=()=>pointer=null;
for(const button of document.querySelectorAll('[data-control]')){button.onpointerdown=e=>{e.preventDefault();button.setPointerCapture(e.pointerId);touch.add(button.dataset.control);pendingInputAt=performance.now();};button.onpointerup=button.onpointercancel=()=>touch.delete(button.dataset.control);}
$('#source-toggle').onclick=()=>{$('#workbench').hidden=!$('#workbench').hidden;keys.clear();touch.clear();override=null;};$('#stats-toggle').onclick=()=>$('#stats').hidden=!$('#stats').hidden;$('#map-toggle').onclick=()=>$('#mini').hidden=!$('#mini').hidden;$('#retry').onclick=connect;
$('#invite').onclick=async()=>{try{await navigator.clipboard.writeText(new URL('./',location.href).href);$('#invite').textContent='Приглашение скопировано';setTimeout(()=>$('#invite').textContent='Скопировать приглашение',2500);}catch{$('#invite').textContent='Отправь другу адрес этой страницы';}};
document.addEventListener('visibilitychange',()=>{keys.clear();touch.clear();override=null;if(document.hidden){paused=true;network.postMessage({type:'close'});status='closed';}else{paused=false;connect();}});
function hud(now,pose,sample){
 $('#connection').textContent=status==='connected'?'Связь с сервером':status==='connecting'?'Подключение':'Нет связи';$('#dot').className=status;$('#peers').textContent=players+' игроков';$('#rtt').textContent=Math.round(net.rtt??0)+' мс RTT';$('#chunks').textContent=(view?.chunks.inspect().resident??0)+' чанков';
 const biome=climateAt(world.seed,pose.x,pose.z).biome;$('#region').textContent='ОТКРЫТЫЙ МИР / '+BIOME_NAMES[biome].toUpperCase();$('#location').textContent=biome==='city'?'На перекрёстке':BIOME_NAMES[biome];$('#coordinates').textContent=`${pose.x.toFixed(0)} : ${pose.z.toFixed(0)} м · ${pose.speed.toFixed(1)} м/с`;
 let nearest,dist=Infinity;for(const point of LANDMARKS){const d=Math.hypot(point.x-pose.x,point.z-pose.z);if(d<dist){dist=d;nearest=point;}}$('#landmark').textContent=dist<20?`${nearest.name} · ${dist<8?'место открыто':Math.round(dist)+' м'}`:'';$('#discovered').textContent=discovered.toString(2).split('1').length-1+' / 5 мест';
 if(!$('#mini').hidden){const ctx=$('#map').getContext('2d'),scale=.45;ctx.fillStyle='#1b373d';ctx.fillRect(0,0,224,224);ctx.save();ctx.translate(112,112);ctx.scale(scale,scale);ctx.translate(-pose.x,-pose.z);ctx.lineWidth=12;ctx.strokeStyle='#647974';ctx.beginPath();for(let i=-384;i<=384;i+=64){ctx.moveTo(i,-384);ctx.lineTo(i,384);ctx.moveTo(-384,i);ctx.lineTo(384,i);}ctx.stroke();for(const point of LANDMARKS){ctx.fillStyle='#ebbb66';ctx.fillRect(point.x-5,point.z-5,10,10);}for(const row of sample?.rows??[]){ctx.fillStyle=row.values[6]?'#96a79b':'#b8e4ef';ctx.beginPath();ctx.arc(row.values[0],row.values[2],5,0,7);ctx.fill();}ctx.restore();ctx.save();ctx.translate(112,112);ctx.rotate(Math.PI-yaw);ctx.fillStyle='#f4d283';ctx.beginPath();ctx.moveTo(0,-8);ctx.lineTo(-5,6);ctx.lineTo(5,6);ctx.closePath();ctx.fill();ctx.restore();}
 if(!$('#stats').hidden)$('#stats').textContent=JSON.stringify(inspect(),null,2);
}
function inspect(){const v=view?.inspect();return {ready,status,id,players,position:replay?{...replay.state}:null,authoritative,ack:replay?.ack,sequence:replay?.latestSequence,pending:replay?.pending,others:replica?.sample.rows.map(r=>({id:r.id,x:r.values[0],z:r.values[2],kind:r.values[6]})),network:{rtt:net.rtt,age:net.age,bytes:net.bytes,buffered:net.buffered,replaced:net.replaced,...replica?.inspect()},frameMs:timingStats(metrics.frames),wholeRun:frameHealth.inspect(),submittedFrames:submittedHealth.inspect(),longFrames:[...longFrames],maxFrameMs:metrics.maxFrameMs,predictionMs:timingStats(metrics.prediction),correctionM:timingStats(metrics.correction),inputToMotionMs:timingStats(metrics.inputToMotion),travel:metrics.travel,startupMs:metrics.startupMs,droppedClockMs:clock.droppedMs,world:world?.inspect(),view:v};}
function frame(now){if(stopped)return;requestAnimationFrame(frame);const dt=lastFrame?Math.max(0,now-lastFrame):0;lastFrame=now;
 if(paused){clock.reset(now);return;}if(status==='connecting'&&now-connectedAt>7000)close('Сервер недоступен. Запусти bun run thegame на компьютере или сервере.');if(status==='closed'&&now>=nextRetry)connect();
 if(!pump){pump=true;network.postMessage({type:'pump',sent,items:status==='connected'&&ready?replay?.after(sent)??[]:[]});}
 if(!replay||!view){return;}
 if(view.error){close(view.error);nextRetry=Infinity;return;}
 if(status==='connected'&&net.age>1500){close('Сервер перестал отвечать. Состояние остановлено до восстановления связи.');return;}
 if(!ready){clock.reset(now);if(view.ready&&status==='connected'){ready=true;loading.hidden=true;metrics.startupMs=now-startup;renderer.resetProfile();lastDraw=null;}else text.textContent=`Готовим кварталы: ${view.chunks.inspect().resident} / 9`;}
 if(ready&&status==='connected'){
  bounded(metrics.frames,dt);frameHealth.record(dt);metrics.maxFrameMs=Math.max(metrics.maxFrameMs,dt);
  const start=performance.now();clock.advance(now,()=>{previous={...replay.state};const controls=editing()?idleCharacterInput(yaw):input();if(!replay.push(controls))close('Очередь ввода заполнена. Синхронизируем соединение.');});bounded(metrics.prediction,performance.now()-start);
 }else clock.reset(now);
 const p=replay.state,alpha=Math.max(0,Math.min(1,1-clock.delay/(1000/60))),pose={...p};for(const [i,key] of ['x','y','z'].entries()){corrections[i]*=Math.exp(-dt/90);pose[key]=previous[key]+(p[key]-previous[key])*alpha+corrections[i];}
 if(world.blocked(pose.x,pose.y,pose.z,1.8,.29)){corrections=[0,0,0];pose.x=p.x;pose.y=p.y;pose.z=p.z;}
 const sample=replica.present(now/1000),beforeSubmission=view.stats.frames;view.frame(pose,sample,yaw,pitch,now);
 if(ready&&view.stats.frames>beforeSubmission){if(lastSubmittedAt)submittedHealth.record(now-lastSubmittedAt);lastSubmittedAt=now;}
 if(ready&&lastDraw){const distance=Math.hypot(pose.x-lastDraw.x,pose.z-lastDraw.z);metrics.travel+=distance;if(pendingInputAt&&distance>.0001){bounded(metrics.inputToMotion,now-pendingInputAt);pendingInputAt=0;}}lastDraw={x:pose.x,z:pose.z};
 if(now-lastHud>200){lastHud=now;hud(now,pose,sample);}
}
globalThis.__THEGAME__={inspect,get source(){return wb?.source;},get workbench(){return wb;},setInput(value){override=readCharacterInput(value);yaw=override.yaw;pendingInputAt=performance.now();},clearInput(){override=null;keys.clear();},resetMetrics(){frameHealth.reset();submittedHealth.reset();longFrames.length=0;healthStartedAt=performance.now();lastSubmittedAt=0;metrics.frames=[];metrics.prediction=[];metrics.correction=[];metrics.inputToMotion=[];metrics.travel=0;metrics.maxFrameMs=0;renderer?.resetProfile();},disconnect(){close('Переподключение');},query(){return {landmarks:LANDMARKS,revision:WORLD_REVISION};}};
addEventListener('pagehide',()=>{stopped=true;longFrameObserver?.disconnect();network.terminate();wb?.dispose();view?.dispose();world?.dispose();},{once:true});
requestAnimationFrame(frame);connect();
