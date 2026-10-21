import {BrowserRuntime} from '/dist/browser.js';
import {makeWinterScene,walkingWorld} from './scene.mjs';
import {WinterEpisode} from './episode.mjs';

const $=id=>document.getElementById(id),canvas=$('world');
const verification=new URL(location.href).searchParams.has('verify');
let runtime,episode,controls,running=false,started=false;
const resolution=()=>{const scale=Math.min(1,1280/innerWidth,720/innerHeight);return verification?[1280,720]:[Math.max(1,Math.round(innerWidth*scale)),Math.max(1,Math.round(innerHeight*scale))];};
function bindEpisode(data){
 episode=new WinterEpisode(runtime.scene,data.vehicleParts);
 controls=runtime.controlWalker('walker',{world:walkingWorld(runtime.scene,data.obstacles),view:{yaw:0,pitch:-.22},onExit:pause});
 runtime.render();
}
function pause(){
 if(!running)return;running=false;runtime.pause();controls.setActive(false);
 document.exitPointerLock?.();$('overlay').hidden=false;$('title').textContent='Пауза';$('start').textContent='Продолжить';$('restart').hidden=false;$('interact').hidden=true;
}
async function start(){
 try{await runtime.activateAudio();$('status').textContent='';}catch{$('status').textContent='Звук недоступен, прогулка продолжится без него.';}
 started=true;running=true;$('overlay').hidden=true;$('hud').hidden=false;$('pause').hidden=false;
 controls.enter(!verification);runtime.resume();
}
function interact(){if(running&&episode.interact())canvas.focus({preventScroll:true});}
$('start').addEventListener('click',start);$('pause').addEventListener('click',pause);$('interact').addEventListener('click',interact);
canvas.addEventListener('keydown',event=>{if(event.code==='KeyE'&&!event.repeat){event.preventDefault();interact();}});
$('restart').addEventListener('click',async()=>{
 $('restart').disabled=true;$('start').disabled=true;
 try{const data=makeWinterScene();await runtime.replaceScene(data.spec);bindEpisode(data);runtime.renderer.resetTemporalHistory();started=false;$('title').textContent='Зимний двор';$('start').textContent='Начать прогулку';$('restart').hidden=true;$('pause').hidden=true;$('complete').hidden=true;$('hud').hidden=true;}
 catch(error){$('status').textContent=String(error);}
 finally{$('restart').disabled=false;$('start').disabled=false;}
});
function hud(){
 if(episode){const state=episode.inspect();state.goals.forEach((done,i)=>$('goal'+i).classList.toggle('done',done));$('complete').hidden=!state.complete;$('interact').hidden=!running||!state.canInteract;}
 requestAnimationFrame(hud);
}
try{
 $('status').textContent='Готовим геометрию двора…';
 const data=makeWinterScene();
 $('status').textContent='Инициализируем WebGPU…';
 runtime=await BrowserRuntime.create(canvas,data.spec,{autoplay:false,audio:true,profiling:true,resolution:resolution()});bindEpisode(data);
 $('start').disabled=false;$('status').textContent='Двор готов';
 // Inspectable hooks are also used by the deterministic visual verification tool.
 window.winter={runtime,get episode(){return episode;},get controls(){return controls;},pause,inspect:()=>({...episode.inspect(),started,running,audio:runtime.audio.inspect(),renderer:runtime.renderer.inspect()})};
 window.ready=true;hud();
 if(verification){
  const button=document.createElement('button');button.textContent='Проверить сцену';button.id='verify';$('credits').after(button);
  button.addEventListener('click',async()=>{
   button.disabled=true;$('start').disabled=true;$('status').textContent='Проверяем движение и контрольные ракурсы…';
   try{const {verifyWinter}=await import('./verify.mjs');const report=await verifyWinter(runtime,episode,controls,canvas);$('status').textContent=`Проверка пройдена: ${report.views.length} ракурса, ${report.state.footprints} следа. Эталон сохранён в artifacts/winter/latest.`;}
   catch(error){$('status').textContent='Проверка не пройдена: '+error.message;console.error(error);}
   finally{button.disabled=false;$('start').disabled=false;}
  });
 }
}catch(error){window.failure=error.stack??String(error);$('status').textContent=`Не удалось загрузить двор: ${error.message}. Для прогулки нужен браузер с WebGPU.`;console.error(error);}
window.addEventListener('pagehide',()=>runtime?.dispose(),{once:true});
window.addEventListener('resize',()=>{if(runtime&&!verification){runtime.renderer.setResolution(...resolution());runtime.render();}});
