import {AgentCampus} from '/dist/observability/campus.js';
import {WebGPURenderer} from '/dist/render/webgpu.js';
const $=id=>document.getElementById(id);
const canvas=$('world'),raw=await (await fetch('/data/replay.json',{cache:'no-store'})).json();
const engine=new AgentCampus(raw.agents),events=raw.events;
const startMs=events[0].atMs,seconds=raw.capture.durationSeconds;
let renderer,playing=!new URL(location.href).searchParams.has('capture'),cursor=0,lastFrame=0,flight=Promise.resolve();
const elapsed=t=>'00:'+String(Math.max(0,Math.floor(t))).padStart(2,'0');
function inspection(){
 const agents=engine.project(events,startMs+Math.round(cursor*1000));
 return {cursor,agents,sceneEntities:engine.scene.entities.size,renderer:renderer?.inspect(),
  errors:renderer?.inspect()?.errors??[],style:engine.style,source:'engine Scene + real WebGPU; synthetic ActivityFacts'};
}
async function seek(t){
 if(!Number.isFinite(t)||t<0||t>seconds+.001)throw new RangeError('Replay cursor must remain in authored timeline');
 cursor=Math.min(t,seconds);
 const at=startMs+Math.round(cursor*1000);
 const positions=engine.project(events,at);
 const walking=positions.filter(p=>p.traveling);
 $('elapsed').textContent=elapsed(cursor);
 $('progress-fill').style.width=String(cursor/seconds*100)+'%';
 $('count').textContent=walking.length+' WALKING / '+positions.length+' AGENTS';
 $('action').textContent=walking.length?'Cross-office collaboration':'Shared workspace';
 $('participants').textContent=walking.length?walking.map(p=>raw.agents.find(a=>a.id===p.id)?.name+' → '+p.destination.toUpperCase()).join(' · '):
  'All movement derives from explicit activity events';
 renderer.render(engine.scene);
 await renderer.flush();
 return {cursor,agents:positions,renderer:renderer.inspect()};
}
async function setup(){
 renderer=await WebGPURenderer.create(canvas,{profiling:false});
 renderer.setResolution(1280,720);
 await renderer.prepareMaterials(engine.scene);
 await seek(0);document.documentElement.dataset.engineReady='1';
 requestAnimationFrame(frame);
}
function frame(now){
 if(!renderer)return;
 const dt=Math.min(.08,Math.max(0,(now-lastFrame)/1000));lastFrame=now;
 if(playing&&!new URL(location.href).searchParams.has('capture')){
  flight=flight.then(()=>seek(cursor+dt>seconds?0:cursor+dt)).catch(error);
 }
 requestAnimationFrame(frame);
}
$('play').addEventListener('click',()=>{playing=!playing;$('play').textContent=playing?'PAUSE':'PLAY';});
globalThis.__CAMPUS__={seek,inspect:inspection,info:()=>({seconds,startMs,events:events.length})};
setup().catch(error=>{
 $('warning').style.display='block';$('warning').textContent='WebGPU campus error: '+(error?.stack??String(error));
 globalThis.__CAMPUS_ERROR__=error?.stack??String(error);
 throw error;
});
