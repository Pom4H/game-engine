import {WebGPURenderer} from '../src/render/webgpu.js';
import {ProgramRuntime} from '../src/dsl/runtime.js';
import {FixedClock} from '../src/core/fixed-clock.js';
import type {Vec3,MutableVec3} from '../src/math.js';
import {V3} from '../src/math.js';
import {ForceFrame} from '../src/physics/force-frame.js';
import type {Primitive,CameraSpec} from '../src/scene/types.js';
import {ProceduralAudio} from '../src/audio/browser.js';
import {SourceDocument,literal,rebase,validateBindings,type Binding} from './source-document.js';
import {Inspector} from './inspector.js';
declare const __EXAMPLES__:readonly {id:string;title:string;source:string;scope:string}[];
const $=<T extends HTMLElement>(id:string)=>document.getElementById(id) as T;
const source=$<HTMLTextAreaElement>('source'),canvas=$<HTMLCanvasElement>('canvas'),compiler=$<HTMLIFrameElement>('compiler'),examples=$<HTMLSelectElement>('example');
const state=$('state'),error=$('error'),notice=$('notice'),hud=$('hud'),metrics=$('metrics');
const doc=new SourceDocument('');let bindings:Binding[]=[],bindingVersion=-1,serial=0,compilerReady=false,pending=false,textDirty=true;
let runtime:ProgramRuntime|undefined,renderer:WebGPURenderer|undefined,playing=true,raf=0,compileTimer:ReturnType<typeof setTimeout>|undefined,typingTimer:ReturnType<typeof setTimeout>|undefined;
let selectionPending=true;
let lastGood=-1,compileCount=0,coldBuilds=0,hotEdits=0,frameCount=0,lastFrame=0,frameMs:number[]=[],audio:ProceduralAudio|undefined,audioOn=false;
const clock=new FixedClock(1000/60,250,8),inspector=new Inspector($('inspector'),{change:changeBinding,end:()=>doc.endGroup(),select:selectBinding});
const fail=(message:string)=>{error.textContent=message;state.textContent='Ошибка · последний корректный рендер';state.dataset.error='true';};
const escape=(s:string)=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
function paintCode(){
 const re=/(\/\/[^\n]*|\/\*[\s\S]*?\*\/|'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`|\b(?:import|from|export|default|const|let|return|true|false|as|type|new)\b|\b\d+(?:\.\d*)?(?:e[+-]?\d+)?\b)/gi;
 let html='',end=0;for(const match of doc.text.matchAll(re)){html+=escape(doc.text.slice(end,match.index));const token=match[0],kind=token.startsWith('/')?'comment':/^['"`]/.test(token)?'string':/^\d/.test(token)?'number':'keyword';html+=`<span class="${kind}">${escape(token)}</span>`;end=match.index!+token.length;}
 $('highlight').innerHTML=html+escape(doc.text.slice(end))+'\n';syncScroll();
 $('undo').toggleAttribute('disabled',!doc.canUndo);$('redo').toggleAttribute('disabled',!doc.canRedo);
}
function syncScroll(){const pre=$('highlight');pre.scrollTop=source.scrollTop;pre.scrollLeft=source.scrollLeft;}
function showDocument(selection=false){source.value=doc.text;if(selection)source.setSelectionRange(doc.anchor,doc.focus);paintCode();}
function queueCompile(delay=60){
 pending=true;state.textContent='Применение кода…';delete state.dataset.error;
 if(delay>=300){clearTimeout(compileTimer);compileTimer=setTimeout(()=>{compileTimer=undefined;compile();},delay);}
 else if(!compileTimer)compileTimer=setTimeout(()=>{compileTimer=undefined;compile();},delay);
}
function compile(){if(!compilerReady||requests.size)return;const id=++serial;pending=true;compiler.contentWindow!.postMessage({type:'compile',id,code:doc.text},'*');requests.set(id,{version:doc.version,text:doc.text});for(const key of requests.keys())if(key!==id)requests.delete(key);}
const requests=new Map<number,{version:number;text:string}>();
function changeBinding(key:string,value:Binding['value'],group:string){
 try{
  if(bindingVersion!==doc.version)throw new Error('Код изменяется: дождитесь проверки');
  const binding=bindings.find(b=>b.key===key);if(!binding?.writable)throw new Error('Это вычисляемое выражение. Измените его в коде.');
  const replacement=literal(value,binding.span.text),before=bindings,edit={...binding.span,replacement};
  if(replacement===binding.span.text)return;
  doc.edit([edit],bindingVersion,group);bindings=rebase(bindings,[edit]);
  for(let i=0;i<bindings.length;i++)if(before[i]!.span.start===edit.start&&before[i]!.span.end===edit.end)bindings[i]!.value=value;
  bindingVersion=doc.version;textDirty=false;showDocument();inspector.set(bindings);queueCompile();
 }catch(cause){fail((cause as Error).message);}
}
function selectBinding(b:Binding){source.focus({preventScroll:true});source.setSelectionRange(b.span.start,b.span.end);doc.anchor=b.span.start;doc.focus=b.span.end;const line=doc.text.slice(0,b.span.start).split('\n').length-1;source.scrollTop=Math.max(0,line*parseFloat(getComputedStyle(source).lineHeight)-source.clientHeight/3);syncScroll();}
source.addEventListener('input',()=>{try{doc.replace(source.value,'typing',[source.selectionStart,source.selectionEnd]);textDirty=true;inspector.set(bindings,false);paintCode();queueCompile(350);clearTimeout(typingTimer);typingTimer=setTimeout(()=>doc.endGroup(),650);}catch(cause){showDocument();fail((cause as Error).message);}});
source.addEventListener('select',()=>{doc.anchor=source.selectionStart;doc.focus=source.selectionEnd;});source.addEventListener('scroll',syncScroll);
function history(redo=false){if(redo?doc.redo():doc.undo()){textDirty=true;showDocument(true);inspector.set(bindings,false);queueCompile(0);}}
source.addEventListener('beforeinput',e=>{if(e.inputType==='historyUndo'||e.inputType==='historyRedo'){e.preventDefault();history(e.inputType==='historyRedo');}});
source.addEventListener('keydown',e=>{if(e.key==='Tab'){e.preventDefault();const start=source.selectionStart,end=source.selectionEnd;doc.replace(doc.text.slice(0,start)+'  '+doc.text.slice(end),'typing',[start+2,start+2]);showDocument(true);textDirty=true;inspector.set(bindings,false);queueCompile(350);}});
window.addEventListener('keydown',e=>{if(e.metaKey||e.ctrlKey){if(e.key.toLowerCase()==='z'){e.preventDefault();history(e.shiftKey);}else if(e.key.toLowerCase()==='y'){e.preventDefault();history(true);}else if(e.key==='Enter'){e.preventDefault();queueCompile(0);}}});
$('undo').onclick=()=>history();$('redo').onclick=()=>history(true);$('apply').onclick=()=>queueCompile(0);
$('save').onclick=()=>download(new Blob([doc.text],{type:'text/typescript'}),'scene.ts');
$('inspector-toggle').onclick=()=>{const panel=$('inspector');panel.hidden=!panel.hidden;$('inspector-toggle').setAttribute('aria-expanded',String(!panel.hidden));};
$('play').onclick=()=>{playing=!playing;clock.reset(performance.now());$('play').textContent=playing?'Пауза':'Продолжить';};
$('step').onclick=()=>{playing=false;$('play').textContent='Продолжить';runtime?.step();render();};
$('reset').onclick=()=>{if(lastGood>=0){forceCold=true;queueCompile(0);}};let forceCold=false;
$('sound').onclick=async()=>{audio??=new ProceduralAudio();audioOn=!audioOn;if(audioOn)await audio.unlock();$('sound').textContent=audioOn?'Звук: вкл':'Звук: выкл';};
$('json').onclick=()=>{if(runtime)download(new Blob([JSON.stringify({program:runtime.program,state:runtime.scene.snapshot(),metrics:runtime.metrics,renderer:renderer?.inspect()},null,2)],{type:'application/json'}),'scene-state.json');};
$('png').onclick=async()=>{render();await renderer?.flush();canvas.toBlob(blob=>{if(blob)download(blob,'scene.png');});};
function download(blob:Blob,name:string){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
for(const example of __EXAMPLES__){const option=document.createElement('option');option.value=example.id;option.textContent=example.title;examples.append(option);}
function loadExample(id:string){selectionPending=true;const example=__EXAMPLES__.find(e=>e.id===id)??__EXAMPLES__[0]!;examples.value=example.id;doc.endGroup();doc.replace(example.source);showDocument();textDirty=true;$('scope').textContent=example.scope;$('scope').title=example.scope;forceCold=true;queueCompile(0);try{historyReplace(example.id);}catch{}}
function historyReplace(id:string){window.history.replaceState(null,'','#'+encodeURIComponent(id));}
examples.onchange=()=>loadExample(examples.value);
window.addEventListener('message',async event=>{
 if(event.source!==compiler.contentWindow||!event.data?.compiler)return;
 if(event.data.ready){if(!compilerReady){compilerReady=true;compile();}return;}
 const request=requests.get(event.data.id);if(!request||event.data.id!==serial)return;
 requests.delete(event.data.id);const latest=request.version===doc.version&&request.text===doc.text;pending=!latest;
 if(!latest){queueCompile(0);if(textDirty||event.data.error)return;}
 if(event.data.error){fail(`${event.data.line?`Строка ${event.data.line}:${event.data.column}\n`:''}${event.data.error}`);inspector.set(bindings,!textDirty&&bindingVersion===doc.version);return;}
 try{
  const nextBindings=validateBindings(event.data.bindings,request.text);
  // No author JavaScript enters this context. ProgramRuntime validates plain data.
  if(runtime&&!forceCold&&runtime.reconcile(event.data.program))hotEdits++;
  else {const next=new ProgramRuntime(event.data.program),previous=runtime;runtime=next;previous?.dispose();coldBuilds++;clock.reset(performance.now());}
  forceCold=false;lastGood=request.version;compileCount++;
  if(latest){bindings=nextBindings;bindingVersion=doc.version;textDirty=false;}
  inspector.set(bindings);
  if(selectionPending&&latest){const item=runtime.program.items.find(i=>'kind'in i)??runtime.program.items.find(i=>'id'in i&&i.id!=='пол');const owner=runtime.program.input??(item&&'kind'in item&&item.kind==='vehicle'?item.blueprint.source.id:item&&'id'in item?item.id:undefined);if(owner)inspector.selectOwner(owner);selectionPending=false;}
  error.textContent='';delete state.dataset.error;state.textContent=latest?'Код ↔ параметры ↔ рендер':'Применение кода…';
  for(const id of ['play','step','reset','sound','png','json'])$(id).removeAttribute('disabled');resize();render();
 }catch(cause){fail((cause as Error).message);}
});
// Compiler in an opaque-origin frame, not in the authenticated renderer document.
compiler.src='./compiler.html';
const initial=decodeURIComponent(location.hash.slice(1));loadExample(__EXAMPLES__.some(e=>e.id===initial)?initial:__EXAMPLES__[0]!.id);
async function start(){
 try{renderer=await WebGPURenderer.create(canvas,{profiling:true});resize();notice.hidden=true;raf=requestAnimationFrame(frame);}
 catch(cause){notice.textContent='WebGPU недоступен в этом браузере. Код и 2-way параметры остаются доступны. '+(cause as Error).message;fail((cause as Error).message);}
}
let resolution='';
function resize(){if(!renderer)return;const r=canvas.getBoundingClientRect(),quality=runtime?.program.preview,scale=Math.min(quality?.maxPixelRatio??1.5,devicePixelRatio||1)*(quality?.resolutionScale??1),width=Math.max(1,Math.min(1920,Math.round(r.width*scale))),height=Math.max(1,Math.min(1080,Math.round(r.height*scale))),key=`${width}:${height}`;
 if(key!==resolution){resolution=key;renderer.setResolution(width,height);}render();}

new ResizeObserver(resize).observe(canvas);
function cameraForFrame():CameraSpec|undefined{
 if(!runtime)return;const authored=runtime.program.stage.camera??runtime.scene.camera,id=runtime.program.follow;
 if(!id)return runtime.scene.camera;
 const body=runtime.vehicles.get(id)?.vehicle.body,anchor=body?.position??runtime.scene.entities.get(id)?.position??runtime.scene.entities.get(id+'/torso')?.position;if(!anchor)return runtime.scene.camera;
 const target:Vec3=[anchor[0],anchor[1]+.2,anchor[2]],delta=V3.sub(target,authored.target);
 return {...authored,target,position:V3.add(authored.position,delta)};
}
function render(){if(!renderer||!runtime)return;try{renderer.render(runtime.scene,cameraForFrame());}catch(cause){playing=false;fail((cause as Error).message);}}
function frame(now:number){
 if(lastFrame){frameMs.push(now-lastFrame);if(frameMs.length>120)frameMs.shift();}lastFrame=now;
 try{if(playing&&runtime)clock.advance(now,()=>runtime!.step());else clock.reset(now);
  if(runtime){const events=runtime.scene.drainEvents();if(audioOn)audio?.play(events);runtime.scene.contacts.drainFootsteps();}
  render();if(++frameCount%12===0)diagnostics();
 }catch(cause){playing=false;fail((cause as Error).message);}raf=requestAnimationFrame(frame);
}
function diagnostics(){
 if(!runtime||!renderer)return;const stats=renderer.inspect(),ms=frameMs.length?frameMs.reduce((a,b)=>a+b,0)/frameMs.length:0;
 metrics.textContent=`${ms?Math.round(1000/ms):0} FPS · ${stats.triangles.toLocaleString('ru')} △ · ${stats.drawCalls} draws · ${stats.width}×${stats.height}`;
 const selected=runtime.vehicles.get(inspector.selected)?.vehicle??runtime.vehicles.values().next().value?.vehicle;
 const lines=[`t=${runtime.scene.time.toFixed(2)} s · ${runtime.scene.physics.bodies.size} тел · WebGPU`,`hot edits ${hotEdits} · builds ${coldBuilds} · dropped ${clock.droppedMs.toFixed(0)} ms`];
 if(selected){lines.push(`${selected.body.id} · ${Math.hypot(...selected.body.velocity).toFixed(1)} м/с · ${selected.body.mass} кг`);for(const p of selected.blueprint.parts){const v=selected.part(p.source.id);if(v.kind==='wing')lines.push(`${v.id}: lift=${v.liftN.toFixed(0)} Н · α=${v.alphaRad.toFixed(3)}`);else if(v.id==='rear.left')lines.push(`Шина: ${(v.wear*100).toFixed(2)}% · ${(v.treadDepthM*1000).toFixed(2)} мм · ${v.slipPowerW.toFixed(0)} Вт`);}}
 for(const [id,value]of Object.entries(runtime.metrics))lines.push(`${id}: ${JSON.stringify(value)}`);
 hud.textContent=lines.join('\n');if(stats.errors.length)fail(stats.errors.join('\n'));
}
// Author camera edits are committed to its numeric literals. Follow is a projection,
// so driving does not rewrite initial source positions on every physical tick.
function editCamera(camera:CameraSpec,group:string){
 const edits:{binding:Binding;value:number}[]=[],spans=new Map<string,number>();
 for(const name of ['position','target'] as const)for(let i=0;i<3;i++){
  const b=bindings.find(b=>(b.factory==='camera'&&b.path===`${name}[${i}]`||b.factory==='scene'&&b.path===`camera.${name}[${i}]`));
  if(!b?.writable){state.textContent='Камера вычисляется выражением — редактируйте его в коде';return;}
  const value=Number(camera[name][i]!.toFixed(4)),key=`${b.span.start}:${b.span.end}`;
  if(spans.has(key)&&spans.get(key)!==value){state.textContent='У камеры общие переменные: измените их в коде';return;}
  spans.set(key,value);edits.push({binding:b,value});
 }
 for(const e of edits)changeBinding(e.binding.key,e.value,group);
}
let drag:{x:number;y:number;startX:number;startY:number;camera:CameraSpec;group:string}|undefined;
canvas.addEventListener('pointerdown',e=>{if(!runtime)return;canvas.focus();canvas.setPointerCapture(e.pointerId);const camera=runtime.program.stage.camera??runtime.scene.camera;drag={x:e.clientX,y:e.clientY,startX:e.clientX,startY:e.clientY,camera:structuredClone(camera),group:`camera:${Date.now()}`};});
canvas.addEventListener('pointermove',e=>{
 if(!drag||!runtime||bindingVersion!==doc.version)return;const delta=V3.sub(drag.camera.position,drag.camera.target),distance=V3.length(delta),yaw=Math.atan2(delta[0],delta[2])-(e.clientX-drag.x)*.007,pitch=Math.max(-.05,Math.min(1.48,Math.asin(delta[1]/distance)+(e.clientY-drag.y)*.007));
 editCamera({...drag.camera,position:V3.add(drag.camera.target,[Math.sin(yaw)*Math.cos(pitch)*distance,Math.sin(pitch)*distance,Math.cos(yaw)*Math.cos(pitch)*distance])},drag.group);
});
canvas.addEventListener('pointerup',e=>{if(drag&&Math.hypot(e.clientX-drag.startX,e.clientY-drag.startY)<4)pick(e.clientX,e.clientY);drag=undefined;doc.endGroup();});
canvas.addEventListener('pointercancel',()=>{drag=undefined;doc.endGroup();});
let wheelEnd:ReturnType<typeof setTimeout>|undefined;
canvas.addEventListener('wheel',e=>{if(!runtime)return;e.preventDefault();const camera=runtime.program.stage.camera??runtime.scene.camera,delta=V3.sub(camera.position,camera.target),distance=V3.length(delta),next=Math.max(1.5,Math.min(60,distance*Math.exp(e.deltaY*.001)));editCamera({...camera,position:V3.add(camera.target,V3.scale(delta,next/distance))},'camera:wheel');clearTimeout(wheelEnd);wheelEnd=setTimeout(()=>doc.endGroup(),250);},{passive:false});
const keys=new Set<string>();
function drive(){if(!runtime?.program.input)return;for(const [path,value]of Object.entries({throttle:keys.has('w')?1:keys.has('s')?-1:0,steer:(keys.has('d')?1:0)-(keys.has('a')?1:0),brake:keys.has(' ')?1:0})){const b=bindings.find(b=>b.owner===runtime!.program.input&&b.path===`controls.${path}`);if(b?.writable)changeBinding(b.key,value,'driving');}}
canvas.addEventListener('keydown',e=>{if(['w','a','s','d',' '].includes(e.key.toLowerCase())){e.preventDefault();keys.add(e.key.toLowerCase());drive();}});
window.addEventListener('keyup',e=>{if(keys.delete(e.key.toLowerCase())){drive();if(!keys.size)doc.endGroup();}});
window.addEventListener('blur',()=>{if(keys.size){keys.clear();drive();doc.endGroup();}playing=false;$('play').textContent='Продолжить';});
// Coarse author selection uses actual mesh bounds, not fake render-ID pixels.
const boundsCache=new WeakMap<object,{min:Vec3;max:Vec3}>();
function bounds(mesh:Primitive){const known=boundsCache.get(mesh);if(known)return known;let half:Vec3=[.5,.5,.5],min:MutableVec3=[Infinity,Infinity,Infinity],max:MutableVec3=[-Infinity,-Infinity,-Infinity];
 if(mesh.kind==='triangle-mesh')for(let i=0;i<mesh.positions.length;i++){const k=i%3;min[k]=Math.min(min[k]!,mesh.positions[i]!);max[k]=Math.max(max[k]!,mesh.positions[i]!);}
 else {if(mesh.kind==='box'||mesh.kind==='shard'||mesh.kind==='snowdrift')half=V3.scale(mesh.size??[1,1,1],.5);else if(mesh.kind==='sphere')half=[mesh.radius??1,mesh.radius??1,mesh.radius??1];else if(mesh.kind==='cylinder')half=[mesh.radius,mesh.height/2,mesh.radius];else if(mesh.kind==='torus')half=[mesh.radius+mesh.tube,mesh.tube,mesh.radius+mesh.tube];else if(mesh.kind==='plane')half=[(mesh.size?.[0]??1)/2,.01,(mesh.size?.[1]??1)/2];min=V3.scale(half,-1);max=[...half];}
 const result={min,max};boundsCache.set(mesh,result);return result;
}
function pick(x:number,y:number){
 if(!runtime)return;const camera=cameraForFrame()!,rect=canvas.getBoundingClientRect(),forward=V3.normalize(V3.sub(camera.target,camera.position)),right=V3.normalize(V3.cross(forward,[0,1,0])),up=V3.cross(right,forward),tan=Math.tan((camera.fov??42)*Math.PI/360),u=((x-rect.left)/rect.width*2-1)*tan*rect.width/rect.height,v=(1-(y-rect.top)/rect.height*2)*tan,ray=V3.normalize(V3.add(forward,V3.add(V3.scale(right,u),V3.scale(up,v))));
 let nearest=Infinity,owner:string|undefined;const frame=new ForceFrame(),o:MutableVec3=[0,0,0],d:MutableVec3=[0,0,0];
 for(const e of runtime.scene.entities.values()){
  const mesh=e.renderMesh??e.mesh;if(!mesh)continue;const b=bindings.find(b=>e.id===b.owner||e.id.startsWith(b.owner+'/')||e.id.endsWith('/'+b.owner));if(!b)continue;
  frame.update(e.rotation);const diff=V3.sub(camera.position,e.position),m=frame.basis;
  for(let k=0;k<3;k++){o[k]=(diff[0]*m[k*3]!+diff[1]*m[k*3+1]!+diff[2]*m[k*3+2]!)/e.scale[k]!;d[k]=(ray[0]*m[k*3]!+ray[1]*m[k*3+1]!+ray[2]*m[k*3+2]!)/e.scale[k]!;}
  const box=bounds(mesh);let low=0,high=Infinity;
  for(let k=0;k<3;k++){if(Math.abs(d[k]!)<1e-10){if(o[k]!<box.min[k]!||o[k]!>box.max[k]!)high=-1;}else{const a=(box.min[k]!-o[k]!)/d[k]!,b=(box.max[k]!-o[k]!)/d[k]!;low=Math.max(low,Math.min(a,b));high=Math.min(high,Math.max(a,b));}}
  if(high>=low&&low<nearest){nearest=low;owner=b.owner;}
 }
 if(owner)inspector.selectOwner(owner,true);
}
let splitDrag=false;const split=$('split');
const mobile=()=>matchMedia('(max-width:760px)').matches;
const splitValue=(value:number)=>{value=Math.max(25,Math.min(70,value));document.documentElement.style.setProperty(mobile()?'--top':'--left',value+'%');split.setAttribute('aria-valuenow',value.toFixed(0));split.setAttribute('aria-orientation',mobile()?'horizontal':'vertical');};
split.onpointerdown=e=>{splitDrag=true;split.setPointerCapture(e.pointerId);};split.onpointermove=e=>{if(splitDrag)splitValue(mobile()?(e.clientY-53)/(innerHeight-53)*100:e.clientX/innerWidth*100);};split.onpointerup=()=>{splitDrag=false;};split.onpointercancel=()=>{splitDrag=false;};split.onkeydown=e=>{if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)){e.preventDefault();splitValue(Number(split.getAttribute('aria-valuenow'))+(['ArrowRight','ArrowDown'].includes(e.key)?2:-2));}};

// QA reads real state; no renderer output or benchmark result is fabricated here.
Object.assign(window,{__PLAYGROUND__:{inspect:()=>({source:doc.text,version:doc.version,lastGood,pending,compileCount,coldBuilds,hotEdits,bindings,renderer:renderer?.inspect(),scene:runtime?.scene.snapshot(),program:runtime?.program,metrics:runtime?.metrics}),flush:async()=>{render();await renderer?.flush();},edit:changeBinding,undo:()=>history(),redo:()=>history(true),example:loadExample,pause:()=>{playing=false;},select:(owner:string)=>inspector.selectOwner(owner,true)}});
window.addEventListener('pagehide',()=>{cancelAnimationFrame(raf);clearTimeout(compileTimer);runtime?.dispose();renderer?.dispose();audio?.dispose();compiler.src='about:blank';});
void start();
