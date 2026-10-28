import {BrowserRuntime} from '/dist/browser.js';
import {makeTrafficScene,TrafficDirector,trafficWalkingWorld,TRAFFIC_VIEWS} from './traffic-scene.mjs';
const $=id=>document.getElementById(id),canvas=$('world');
let runtime,data,director,controls,running=false,started=false,view=0,walking=false,muted=false,rebuilding=false;
const resolution=()=>{const scale=Math.min(1,1440/innerWidth,810/innerHeight);return[Math.max(1,Math.round(innerWidth*scale)),Math.max(1,Math.round(innerHeight*scale))];};
function bind(){director=new TrafficDirector(runtime.scene,data.cars);runtime.scene.animation.step(0,runtime.scene.entities,p=>runtime.scene.contacts.sample(p));}
function pause(){if(!runtime||!running)return;running=false;runtime.pause();runtime.audio?.setMuted(true);controls?.setActive(false);$('overlay').hidden=false;$('toolbar').hidden=true;$('toast').hidden=true;$('title').innerHTML='Город<br>на <span>паузе.</span>';$('start').textContent='Продолжить ↗';$('restart').hidden=false;}
async function start(){
 if(!runtime||rebuilding)return;
 try{const ok=await runtime.activateAudio();$('status').textContent=ok?'':'Звук недоступен — можно смотреть без него.';}catch{$('status').textContent='Звук недоступен — можно смотреть без него.';}
 runtime.audio?.setMuted(muted);started=true;running=true;$('overlay').hidden=true;$('toolbar').hidden=false;
 if(walking){controls?.enter(true);$('toast').hidden=false;}runtime.resume();
}
function fixedView(){
 runtime.releaseWalker();controls=null;walking=false;$('walk').hidden=false;$('exit-walk').hidden=true;$('toast').hidden=true;
 runtime.setCamera(TRAFFIC_VIEWS[view%TRAFFIC_VIEWS.length]);runtime.renderer.resetTemporalHistory();$('view').textContent=TRAFFIC_VIEWS[view%TRAFFIC_VIEWS.length].name+' · V';
}
function walk(){
 walking=true;controls=runtime.controlWalker('walker',{world:trafficWalkingWorld(runtime.scene,data),view:{yaw:.52,pitch:-.13},onExit:pause});controls.enter(true);
 $('walk').hidden=true;$('exit-walk').hidden=false;$('toast').hidden=false;
}
async function rebuild(count){
 if(rebuilding)return;rebuilding=true;const resume=running;pause();runtime.pause();runtime.releaseWalker();controls=null;walking=false;
 $('density').disabled=true;$('start').disabled=true;
 $('status').textContent=`Собираем поток из ${count} машин…`;
 try{await new Promise(requestAnimationFrame);data=makeTrafficScene({count});await runtime.replaceScene(data.spec,false);bind();view=0;fixedView();$('car-count').textContent=count;$('live-label').textContent=`${count} машин · снегопад · без светофоров`;$('status').textContent='Улица готова. Лучше со звуком.';if(resume&&!document.hidden){running=true;runtime.audio?.setMuted(muted);$('overlay').hidden=true;$('toolbar').hidden=false;runtime.resume();}}
 catch(error){$('status').textContent=error.message;window.failure=error.stack;pause();}
 finally{rebuilding=false;$('density').disabled=false;$('start').disabled=false;}
}
$('start').addEventListener('click',start);$('pause').addEventListener('click',pause);
$('restart').addEventListener('click',async()=>{await rebuild(Number($('density').value));await start();});
$('view').addEventListener('click',()=>{view++;fixedView();});$('walk').addEventListener('click',walk);$('exit-walk').addEventListener('click',fixedView);
$('horn').addEventListener('click',()=>director?.honkNearest());
$('sound').addEventListener('click',async()=>{muted=!muted;if(!muted)await runtime.activateAudio();runtime.audio?.setMuted(muted);$('sound').textContent=muted?'Звук выключен':'Звук включён';$('sound').setAttribute('aria-pressed',String(!muted));});
$('density').addEventListener('change',()=>rebuild(Number($('density').value)));
addEventListener('keydown',event=>{if(!running||event.repeat||event.target instanceof HTMLSelectElement)return;if(event.code==='Escape')pause();if(event.code==='KeyH')director?.honkNearest();if(event.code==='KeyV'){view++;fixedView();}});
let lastTelemetry=0;
function hud(now){
 if(director&&now-lastTelemetry>600){lastTelemetry=now;const state=director.inspect(),render=runtime.renderer.inspect();$('telemetry').textContent=`${state.visibleCars} машин рядом · ${state.honks} гудков · снег и мокрый асфальт`;document.documentElement.dataset.traffic=JSON.stringify({...state,running,walking,audio:runtime.audio?.inspect(),renderer:{backend:render.backend,width:render.width,height:render.height,errors:render.errors,drawCalls:render.drawCalls,triangles:render.triangles,cpuMs:render.profile?.latestCpu?.totalMs,gpuMs:render.profile?.latestGpu?.totalMs,cpuFrames:render.profile?.cpuFrames,gpuFrames:render.profile?.gpuFrames}});}
 requestAnimationFrame(hud);
}
try{
 data=makeTrafficScene();$('status').textContent='Зажигаем фары и фонари…';
 runtime=await BrowserRuntime.create(canvas,data.spec,{tickRate:30,autoplay:false,audio:true,profiling:true,resolution:resolution()});bind();
 for(let i=0;i<8;i++){runtime.render();await new Promise(requestAnimationFrame);}await runtime.drain();
 $('start').disabled=false;$('status').textContent='Улица готова. Лучше со звуком.';
 window.winterTraffic={runtime,get director(){return director;},get controls(){return controls;},start,pause,fixedView,rebuild,
  inspect:()=>({...director.inspect(),running,started,walking,audio:runtime.audio?.inspect(),renderer:runtime.renderer.inspect()})};
 window.ready=true;document.documentElement.dataset.engineReady='1';requestAnimationFrame(hud);
}catch(error){window.failure=error.stack??String(error);$('status').textContent='Не удалось открыть улицу: '+error.message;console.error(error);}
addEventListener('resize',()=>{if(runtime){runtime.renderer.setResolution(...resolution());runtime.render();}});
addEventListener('pagehide',()=>runtime?.dispose(),{once:true});
addEventListener('visibilitychange',()=>{if(document.hidden)pause();});
