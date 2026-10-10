import {ActivityJournal} from '/dist/observability/activity.js';
import {AgentOffice} from '/dist/observability/office.js';
import {WebGPURenderer} from '/dist/render/webgpu.js';

const $=selector=>document.querySelector(selector);
const canvas=$('#scene'),slider=$('#seek'),journal=new ActivityJournal();
const PHASE={offline:'OFFLINE',idle:'IDLE',working:'WORKING',tool:'TOOL',blocked:'BLOCKED',done:'DONE'};
let renderer,office,selectedAgent=null,selectedFact=null,playing=false,lastFrame=0;
let mode='demo',cursorMs=0,firstMs=0,lastMs=0,dirty=true,frameCount=0,lastUiAt=0,building=Promise.resolve();
let yaw=.83,pitch=.49,distance=20.5,knownAgents=0;
const time=ms=>{const n=Math.floor(ms/1000);return String(Math.floor(n/60)).padStart(2,'0')+':'+String(n%60).padStart(2,'0');};
const error=e=>{const panel=$('#error');panel.hidden=false;panel.textContent='3D: '+(e?.message??String(e));playing=false;};
const eventTitle=f=>f.kind.replaceAll('agent.','').replaceAll('.',' / ').toUpperCase();
const actorName=id=>office?.agents.find(a=>a.id===id)?.name??id;
const roster=facts=>{
  const members=new Map();
  for(const f of facts)if(f.actor.domain==='agent'&&!members.has(f.actor.id))
    members.set(f.actor.id,{id:f.actor.id,name:f.kind==='agent.started'&&f.label?f.label:f.actor.id});
  for(const f of facts)if(f.actor.domain==='agent'&&f.kind==='agent.started'&&f.label)
    members.set(f.actor.id,{id:f.actor.id,name:f.label});
  knownAgents=members.size;
  return [...members.values()].slice(0,8);
};
const rosterKey=agents=>agents.map(a=>a.id+'='+a.name).join('|');
async function rebuildIfNeeded(){
  if(!renderer)return;
  const agents=roster(journal.snapshot());
  $('#agent-count').textContent=String(agents.length).padStart(2,'0')+(knownAgents>agents.length?' / '+knownAgents:'');
  if(office&&rosterKey(office.agents)===rosterKey(agents))return;
  const next=new AgentOffice(agents);
  await renderer.prepareMaterials(next.scene);
  office=next;office.project(journal.snapshot(),cursorMs);
  $('#agent-count').textContent=String(agents.length).padStart(2,'0');
  renderer.resetTemporalHistory?.();
  dirty=true;
}
function refreshBounds(){
  const facts=journal.snapshot();
  firstMs=facts[0]?.atMs??0;lastMs=facts.at(-1)?.atMs??firstMs;
  slider.max=String(Math.max(0.01,(lastMs-firstMs)/1000));
  if(mode==='live')cursorMs=lastMs;
  else if(cursorMs<firstMs||cursorMs>lastMs)cursorMs=firstMs;
  $('#duration').textContent=time(lastMs-firstMs);
  $('#count').textContent=facts.length+' EVENTS';
}
function viewCamera(){
  if(!office)return;
  const focus=selectedAgent?office.agentPosition(selectedAgent):undefined;
  const target=focus?[focus[0],.94,focus[2]-.30]:[0,.70,0];
  const viewDistance=focus?Math.min(9.5,distance):distance;
  office.scene.setCamera({position:[target[0]+Math.cos(yaw)*Math.cos(pitch)*viewDistance,target[1]+Math.sin(pitch)*viewDistance,target[2]+Math.sin(yaw)*Math.cos(pitch)*viewDistance],target,fov:focus?43:44});
  renderer?.resetTemporalHistory?.();dirty=true;
}
function resize(){
  if(!renderer)return;
  const rect=canvas.getBoundingClientRect(),scale=Math.min(devicePixelRatio||1,1.5);
  renderer.setResolution(Math.max(1,Math.min(1920,Math.round(rect.width*scale))),Math.max(1,Math.min(1200,Math.round(rect.height*scale))));
  dirty=true;
}
function card(className){const element=document.createElement('div');element.className=className;return element;}
function renderAgents(states){
  const parent=$('#agents');parent.replaceChildren();
  for(let i=0;i<states.length;i++){
    const state=states[i],button=document.createElement('button');button.type='button';
    button.className='agent'+(selectedAgent===state.id?' active':'');
    button.addEventListener('click',()=>{selectedAgent=selectedAgent===state.id?null:state.id;viewCamera();renderUi();});
    const avatar=card('avatar');avatar.textContent=String(i+1).padStart(2,'0');
    const info=card('info'),name=card('name'),task=card('task');
    name.textContent=state.name;task.textContent=state.tool??state.task??'—';
    const phase=card('state');phase.dataset.phase=state.phase;phase.textContent=PHASE[state.phase];
    info.append(name,task);button.append(avatar,info,phase);parent.append(button);
  }
}
function eventButton(f){
  const button=document.createElement('button');button.type='button';
  button.className='event'+(selectedFact===f.id?' active':'');
  const top=card('event-top'),stamp=document.createElement('span'),who=document.createElement('span');
  stamp.textContent=time(f.atMs-firstMs);who.textContent=actorName(f.actor.id);
  top.append(stamp,who);
  const title=document.createElement('strong');title.textContent=eventTitle(f);
  const sub=document.createElement('p');sub.textContent=f.label??(f.target?f.target.domain+' / '+f.target.id:'event '+f.id);
  button.append(top,title,sub);
  button.addEventListener('click',()=>{selectedFact=f.id;selectedAgent=f.actor.domain==='agent'?f.actor.id:selectedAgent;playing=false;cursorMs=f.atMs;viewCamera();renderUi();dirty=true;});
  return button;
}
function renderEvents(facts){
  const parent=$('#events');parent.replaceChildren();
  const list=facts.filter(f=>!selectedAgent||f.actor.id===selectedAgent).slice(-45).reverse();
  for(const f of list)parent.append(eventButton(f));
}
function renderLineage(){
  const element=$('#cause-chain');element.replaceChildren();
  if(!selectedFact){element.textContent='Выберите событие';$('#chain-count').textContent='—';return;}
  const result=journal.lineage(selectedFact);
  $('#chain-count').textContent=String(result.chain.length).padStart(2,'0');
  for(const f of result.chain){
    const button=document.createElement('button');button.type='button';button.className='cause-link';
    button.textContent=time(f.atMs-firstMs)+'  '+actorName(f.actor.id)+' · '+f.kind;
    button.addEventListener('click',()=>{selectedFact=f.id;cursorMs=f.atMs;playing=false;renderUi();dirty=true;});
    element.append(button);
  }
  if(result.unresolvedCauseId){const missing=card('missing');missing.textContent='Неизвестная/вытесненная причина: '+result.unresolvedCauseId;element.append(missing);}
}
function renderUi(){
  const facts=journal.snapshot(),states=office?.project(facts,cursorMs)??[];
  slider.value=String(Math.max(0,(cursorMs-firstMs)/1000));
  $('#cursor').textContent=time(Math.max(0,cursorMs-firstMs));
  $('#play').textContent=playing?'Ⅱ':'▶';
  renderAgents(states);renderEvents(facts.filter(f=>f.atMs<=cursorMs));renderLineage();
  const tokens=states.reduce((s,a)=>s+a.tokens,0),cost=states.reduce((s,a)=>s+a.costUsd,0);
  $('#accounting').textContent=tokens.toLocaleString('en-US')+' TOKENS · $'+cost.toFixed(4);
  dirty=true;
}
function seek(seconds){
  if(!Number.isFinite(seconds))throw new RangeError('Invalid seek');
  playing=false;cursorMs=Math.min(lastMs,Math.max(firstMs,firstMs+seconds*1000));
  renderer?.resetTemporalHistory?.();renderUi();return inspect();
}
function inspect(){
  const facts=journal.snapshot();
  return{mode,events:facts.length,atMs:cursorMs,agents:office?.project(facts,cursorMs)??[],
    cause:selectedFact?journal.lineage(selectedFact):undefined,renderer:renderer?.inspect(),webgpu:!!renderer,
    style:office?.style??null,sceneEntities:office?.scene.entities.size??0,
    focusedAgent:selectedAgent,knownAgents,camera:office?.scene.camera,
    projectionOwner:'AgentOffice / activity journal',authority:'external events',demo:mode==='demo'};
}
async function ingest(facts){
  let changed=false;
  for(const f of facts){if(journal.has(f.id))continue;journal.ingest(f);changed=true;}
  if(!changed)return;
  refreshBounds();
  building=building.then(rebuildIfNeeded);
  await building;
  renderUi();
}
async function init(){
  const response=await fetch('/api/snapshot',{cache:'no-store'});
  if(!response.ok)throw new Error('Cannot read activity snapshot: HTTP '+response.status);
  const snapshot=await response.json();mode=snapshot.mode;
  $('#mode').textContent=mode==='demo'?'REPLAY':'LIVE';
  $('#provenance').textContent=mode==='demo'?'DEMONSTRATION · SYNTHETIC EVENTS':'OBSERVED EVENTS';
  journal.ingestMany(snapshot.events);refreshBounds();
  renderer=await WebGPURenderer.create(canvas);
  await rebuildIfNeeded();viewCamera();resize();renderUi();
  $('#connection').classList.add('online');
  document.documentElement.dataset.engineReady='1';
  const stream=new EventSource('/api/stream');
  stream.onmessage=event=>{try{ingest([JSON.parse(event.data)]).catch(error);}catch(e){error(e);}};
  stream.onerror=()=>$('#connection').classList.remove('online');
  stream.onopen=()=>$('#connection').classList.add('online');
  requestAnimationFrame(frame);
}
function frame(now){
  if(!renderer)return;
  if(playing&&mode==='demo'){
    cursorMs=Math.min(lastMs,cursorMs+Math.max(0,Math.min(80,now-lastFrame)));
    if(cursorMs>=lastMs)playing=false;
    dirty=true;
  }
  if(dirty&&office){
    try{
      office.project(journal.snapshot(),cursorMs);
      renderer.render(office.scene);
      const stats=renderer.inspect();
      if(frameCount++%12===0){
        $('#render-stats').textContent=(stats.drawCalls??0)+' DRAWS / '+(stats.triangles??0)+' TRIANGLES';
      }
    }catch(e){error(e);return;}
    dirty=false;
  }
  if(now-lastUiAt>150&&(playing||lastUiAt===0)){renderUi();lastUiAt=now;}
  lastFrame=now;requestAnimationFrame(frame);
}
$('#play').addEventListener('click',()=>{if(mode==='live')return;if(cursorMs>=lastMs)cursorMs=firstMs;playing=!playing;dirty=true;renderUi();});
slider.addEventListener('input',()=>seek(Number(slider.value)));
const dragging={active:false,x:0,y:0};
canvas.addEventListener('pointerdown',event=>{dragging.active=true;dragging.x=event.clientX;dragging.y=event.clientY;canvas.setPointerCapture(event.pointerId);});
canvas.addEventListener('pointermove',event=>{
  if(!dragging.active)return;
  yaw-=(event.clientX-dragging.x)*.006;
  pitch=Math.max(.16,Math.min(1.1,pitch+(event.clientY-dragging.y)*.004));
  dragging.x=event.clientX;dragging.y=event.clientY;viewCamera();
});
canvas.addEventListener('pointerup',()=>dragging.active=false);
canvas.addEventListener('pointercancel',()=>dragging.active=false);
canvas.addEventListener('wheel',event=>{event.preventDefault();distance=Math.max(13,Math.min(40,distance*Math.exp(event.deltaY*.001)));viewCamera();},{passive:false});
new ResizeObserver(resize).observe(canvas);
globalThis.__AGENT_OFFICE__={inspect,seek,select:(id)=>{selectedFact=id;renderUi();},capture:async()=>{await renderer?.flush();return canvas.toDataURL('image/png');}};
init().catch(error);
