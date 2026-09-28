import {mountRecording} from '../shared/recording-ui.mjs';
import {consoleSession,mountConsole} from '../shared/console.mjs';
import {NetworkPanel} from './network-ui.mjs';
import {EXAMPLES,LEGACY_PENDING} from './examples.mjs';
import {SourceDocument,rebaseBindings} from './document.mjs';
import {BoundControls} from './controls.mjs';
import {CompilerClient} from './compiler-client.mjs';
import {BrowserRuntime} from '../engine/runtime/browser.js';
import {FixedClock} from '../engine/core/fixed-clock.js';
import {installProgram,programVehicles} from '../engine/dsl/runtime.js';
import {planProgramEdit,applyLiveProgram} from '../engine/dsl/edits.js';
await import('./bindings.cjs');
const {editsFor,applyEdits,groups}=globalThis.DSLBindings;
const $=id=>document.getElementById(id),source=$('source'),doc=new SourceDocument();
const names={native:'Новый движок',ported:'Перенесено',partial:'Частичный перенос'};
const fmt=(value,digits=2)=>Number.isFinite(value)?value.toFixed(digits):'—';
const el=(tag,text,className)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(className)node.className=className;return node;};
const button=(text,action,cls)=>{const b=el('button',text,cls);b.type='button';b.onclick=action;return b;};
let example=EXAMPLES[0],bindings=[],bindingReady=false,resetBindings=true,runtime=null,boot=null,bootProgram=null,program=null,compiledRevision=-1;
let timer=0,raf=0,running=false,lastHud=0,external=false,disposed=false,applySerial=0,lastSelection=[0,0],lastCompiler=null,lastPatch='rebuild',seekSerial=0;
const clock=new FixedClock(1000/60,250,6),stats={compiles:0,liveEdits:0,rebuilds:0,frameMs:0,compileMs:0};
const network=new NetworkPanel({runtime:()=>runtime,program:()=>program,pause:()=>pause(),restore:()=>reset(),onError:showError,download});
const compiler=new CompilerClient(reply=>void accept(reply).catch(showError));
const recording=mountRecording({host:$('recording-panel'),canvas:$('render'),runtime:()=>runtime,
 metadata:()=>{const physical=runtime.scene.physics.stats;return{mode:network.active?'network-presentation':'local',tick:runtime.scene.tick,time:runtime.scene.time,revision:compiledRevision,entities:runtime.scene.entities.size,physicsBodies:physical.bodies,physicsContacts:physical.contacts};},download});
// Readers expose existing domain views. The console owns no engine state or clock.
const session=consoleSession({
 sources:{recording:()=>recording.model.inspect(),render:()=>runtime?.renderer.inspect(),profile:()=>runtime?.profile(),physics:()=>runtime?.scene.physics.stats,
  scene:()=>runtime&&({tick:runtime.scene.tick,time:runtime.scene.time,entities:runtime.scene.entities.size}),
  entities:()=>runtime?.scene.entities,network:()=>network.inspect(),
  editor:()=>({revision:doc.revision,appliedRevision:compiledRevision,running,external,lastPatch,...stats})},
 bindings:()=>bindings,
 edit:(id,value)=>{doc.end();try{const changed=changeBinding(id,value,'console');return changed?`Source r${doc.revision} queued; applied r${compiledRevision}`:'Source unchanged';}finally{doc.end();}},
 actions:{
  record:tail=>recording.command(tail),
  pause:target=>{if(target==='server'){if(!network.active)throw new Error('Server is not connected');return network.pauseServer().then(()=> 'Server paused');}localCommand(target);pause();return 'Local simulation paused';},
  play:target=>{if(target==='server'){if(!network.active)throw new Error('Server is not connected');return network.resumeServer().then(()=> 'Server resumed');}localCommand(target);play();return 'Local simulation running';},
  step:target=>{if(target==='server'){if(!network.active)throw new Error('Server is not connected');return network.command('step').then(()=> 'Server stepped');}localCommand(target);step();return `Local tick ${runtime.scene.tick}`;},
  reset:tail=>{localCommand(tail);return reset();},
  seek:tail=>{localCommand();const seconds=Number(tail);if(!tail||!Number.isFinite(seconds)||seconds<0)throw new Error('seek <non-negative seconds>');return seek(seconds);},
  undo:tail=>{noArguments(tail);restored(doc.undo(selection()));return `Source r${doc.revision}; applied r${compiledRevision}`;},
  apply:tail=>{noArguments(tail);apply();return `Compiling source r${doc.revision}`;},
 }
});
function noArguments(tail=''){if(tail)throw new Error('Unexpected arguments');}
function localCommand(tail=''){noArguments(tail);if(!runtime||!program)throw new Error('Scene is not ready');if(network.active)throw new Error('Use an explicit server command or disconnect the server');}
const terminal=mountConsole({panel:$('control-panel'),toggle:$('panel-toggle'),session,onOpen:()=>refreshHud(performance.now(),true)});

const controls=new BoundControls({list:$('control-list'),search:$('parameter-search'),count:$('parameter-count'),empty:$('parameter-empty'),groups,
 onEdit:changeBinding,onSelect:focusSource,begin:()=>doc.end(),end:()=>doc.end()});
function focusSource(binding){
 if(!binding)return;
 if(innerWidth<801){document.querySelector('.workspace').dataset.pane='code';for(const b of document.querySelectorAll('button[data-pane]'))b.setAttribute('aria-pressed',String(b.dataset.pane==='code'));}
 source.focus();source.setSelectionRange(binding.start,binding.end);source.scrollTop=Math.max(0,(binding.line-7)*parseFloat(getComputedStyle(source).lineHeight));syncScroll();controls.select(binding.start,binding.end);
}
function syncControlValues(){controls.update(bindings,{ready:bindingReady&&!external});}
function renderBindings(next){bindings=next;bindingReady=true;controls.update(bindings,{ready:!external,reset:resetBindings});resetBindings=false;controls.select(...lastSelection);}

function showError(error){const message=error instanceof Error?error.message:String(error);$('error').textContent=message.slice(0,1500);$('error').hidden=false;$('code-status').textContent='Ошибка · предыдущая сцена сохранена';if(!runtime)$('placeholder').textContent=message;}
function clearError(){$('error').hidden=true;$('error').textContent='';}
function selection(){return[source.selectionStart,source.selectionEnd];}
function syncScroll(){$('highlight').style.transform=`translate(${-source.scrollLeft}px,${-source.scrollTop}px)`;$('line-numbers').style.transform=`translateY(${-source.scrollTop}px)`;}
function highlight(tokens=[]){
 const fragment=document.createDocumentFragment();let end=0;
 for(const [from,to,cls] of tokens){if(from<end||to>doc.source.length)continue;fragment.append(document.createTextNode(doc.source.slice(end,from)));fragment.append(el('span',doc.source.slice(from,to),cls));end=to;}
 fragment.append(document.createTextNode(doc.source.slice(end)+'\n'));$('highlight').replaceChildren(fragment);
 $('line-numbers').textContent=Array.from({length:doc.source.split('\n').length},(_,i)=>i+1).join('\n');syncScroll();
}
function status(text){$('code-status').textContent=text;$('undo').disabled=!doc.past.length;$('redo').disabled=!doc.future.length;}
function schedule(delay=180){
 if(external){status('Импортированный код · нажмите «Применить»');return;}
 status('Изменения в коде…');if(timer)return;timer=setTimeout(()=>{timer=0;compiler.submit(doc.source,doc.revision);},delay);
}
function setSource(text,{group=null,cursor,trust=!external,compile=true}={}){
 if(text.length>64000){showError('Лимит исходника — 64 000 символов');return false;}
 const oldSelection=selection();if(!doc.set(text,{group,selection:oldSelection}))return false;
 runtime?.cancelReplacement();seekSerial++;external=!trust;
 const top=source.scrollTop,left=source.scrollLeft;source.value=doc.source;if(cursor)source.setSelectionRange(...cursor);else source.setSelectionRange(Math.min(oldSelection[0],text.length),Math.min(oldSelection[1],text.length));source.scrollTop=top;source.scrollLeft=left;
 highlight();if(!group?.startsWith('hud:')&&!group?.startsWith('camera:')){bindingReady=false;syncControlValues();}
 if(compile)schedule(group?.startsWith('hud:')||group?.startsWith('camera:')?40:180);return true;
}
function restored(entry){if(!entry)return;runtime?.cancelReplacement();seekSerial++;source.value=doc.source;source.setSelectionRange(...(entry.selection??[0,0]));highlight();bindingReady=false;syncControlValues();schedule(0);}
source.addEventListener('input',()=>{const text=source.value,cursor=selection();setSource(text,{group:'typing',cursor});});
source.addEventListener('scroll',syncScroll);
source.addEventListener('select',()=>{lastSelection=selection();controls.select(...lastSelection);});
source.addEventListener('keydown',event=>{
 const command=event.metaKey||event.ctrlKey;
 if(command&&event.key.toLowerCase()==='z'){event.preventDefault();restored(event.shiftKey?doc.redo(selection()):doc.undo(selection()));return;}
 if(command&&event.key==='Enter'){event.preventDefault();apply();return;}
 if(event.key==='Tab'){
  event.preventDefault();const [from,to]=selection(),insert='  ';setSource(applyEdits(doc.source,[{from,to,insert}]),{group:'typing',cursor:[from+2,from+2]});return;
 }
 if(event.key==='Enter'){
  event.preventDefault();const [from,to]=selection(),line=doc.source.slice(0,from).split('\n').at(-1),indent=line.match(/^\s*/)[0],more=/[{[(]\s*$/.test(line)?'  ':'',insert='\n'+indent+more;
  setSource(applyEdits(doc.source,[{from,to,insert}]),{group:'typing',cursor:[from+insert.length,from+insert.length]});return;
 }
 if(command&&event.key==='/'){
  event.preventDefault();const [a,b]=selection(),from=doc.source.lastIndexOf('\n',a-1)+1,to=doc.source.indexOf('\n',b),end=to<0?doc.source.length:to;
  const lines=doc.source.slice(from,end).split('\n'),remove=lines.every(l=>/^\s*\/\//.test(l)),text=lines.map(l=>remove?l.replace(/^(\s*)\/\/ ?/,'$1'):'// '+l).join('\n');
  setSource(applyEdits(doc.source,[{from,to:end,insert:text}]),{cursor:[from,from+text.length]});
 }
});
$('undo').onclick=()=>restored(doc.undo(selection()));$('redo').onclick=()=>restored(doc.redo(selection()));
addEventListener('keydown',event=>{
 if(event.target===source||!(event.metaKey||event.ctrlKey))return;
 const key=event.key.toLowerCase();
 if(key==='z'||key==='y'){event.preventDefault();restored(key==='y'||event.shiftKey?doc.redo(selection()):doc.undo(selection()));}
 if(key==='enter'){event.preventDefault();apply();}
});
function apply(){external=false;clearTimeout(timer);timer=0;status('Компиляция…');compiler.submit(doc.source,doc.revision);}
$('apply').onclick=apply;
function selectExample(id,{imported}={}){
 const next=EXAMPLES.find(x=>x.id===id);if(!next)return;if(network.active){network.stop();program=null;}pause();example=next;$('examples').value=id;
 $('filename').textContent=id+'.scene.ts';$('preview-title').textContent=next.title;$('scope-text').textContent=next.limit;$('scope-badge').textContent=names[next.status];$('scope-badge').className='badge '+next.status;
 resetBindings=true;clearTimeout(timer);timer=0;compiler.cancel();bindingReady=false;bindings=[];controls.update([],{ready:false,reset:true});$('parameter-search').value='';
 external=imported!==undefined;setSource(imported??next.source,{compile:false,cursor:[0,0],trust:!external});doc.end();
 if(external){status('Код из ссылки · нажмите «Применить»');$('placeholder').textContent='Код из ссылки ожидает подтверждения запуска';}
 else{history.replaceState(null,'','#scene='+encodeURIComponent(id));apply();}
}
const groupNodes=new Map();for(const item of EXAMPLES){let group=groupNodes.get(item.group);if(!group){group=el('optgroup');group.label=item.group;groupNodes.set(item.group,group);$('examples').append(group);}const option=el('option',item.title);option.value=item.id;group.append(option);}
$('examples').onchange=()=>selectExample($('examples').value);
function changeBinding(id,value,origin='hud'){
 if(!bindingReady||external){if(origin==='console')throw new Error('Bindings are not ready; Apply the source first');return false;}const binding=bindings.find(x=>x.id===id);if(!binding){if(origin==='console')throw new Error('Unknown source binding');return false;}
 try{const edits=editsFor(doc.source,binding,value);if(!edits.length)return false;const next=applyEdits(doc.source,edits),rebased=rebaseBindings(bindings,edits,next,id,value);
  if(setSource(next,{group:origin==='camera'?'camera:orbit':'hud:'+id})){bindings=rebased;bindingReady=true;syncControlValues();return true;}return false;
 }catch(error){if(origin==='console')throw error;showError(error);return false;}
}
async function accept(reply){
 if(disposed||reply.revision!==doc.revision||external)return;
 if(reply.error){bindingReady=false;syncControlValues();if(reply.tokens)highlight(reply.tokens);showError(reply.error);return;}
 if(reply.bindings){renderBindings(reply.bindings);highlight(reply.tokens);}
 const serial=++applySerial,wasRunning=running;stats.compiles++;stats.compileMs=reply.compileMs;lastCompiler=reply.compilers;
 if(!boot){
  bootProgram=reply.program;boot=BrowserRuntime.create($('render'),reply.program.scene,{autoplay:false,audio:false,exposeBridge:true,profiling:true,install:s=>installProgram(s,reply.program)}).then(value=>{if(disposed){value.dispose();throw new Error('Editor disposed');}runtime=value;return value;});
  try{await boot;}catch(error){boot=null;showError('WebGPU: '+String(error));return;}
 }
 const engine=await boot;
 if(disposed||serial!==applySerial||reply.revision!==doc.revision)return;
 try{
  const next=reply.program,edit=program?planProgramEdit(program,next):{mode:'rebuild',reason:'Сцена готова'};
  if(network.active){await network.edit(program,next,edit);if(serial!==applySerial||reply.revision!==doc.revision)return;}
  else if(!program){if(next!==bootProgram){await engine.replaceScene(next.scene,s=>installProgram(s,next));if(serial!==applySerial||reply.revision!==doc.revision)return;}stats.rebuilds++;}else if(edit.mode==='live'){applyLiveProgram(engine.scene,program,next,edit);stats.liveEdits++;}
  else{await engine.replaceScene(next.scene,s=>installProgram(s,next));if(serial!==applySerial||reply.revision!==doc.revision)return;stats.rebuilds++;}
  program=next;compiledRevision=doc.revision;lastPatch=edit.mode;clearError();$('placeholder').hidden=true;
  $('update-mode').textContent=edit.mode==='live'?'Живое изменение · состояние сохранено':'Сборка из кода · начало опыта';
  $('time').max=String(program.durationSeconds);
  for(const id of ['play','reset','time','step','audio'])$(id).disabled=network.active;
  status(`r${doc.revision} · ${fmt(stats.compileMs,1)} мс · ${edit.mode==='live'?'без сброса':'сборка'}`);
  engine.render();if(!network.active&&wasRunning&&engine.scene.time<program.durationSeconds)play();else pause(false);refreshHud(performance.now(),true);
 }catch(error){showError(error);}
}
function play(){if(!runtime||!program||network.active)return;if(runtime.scene.time>=program.durationSeconds){void reset(true);return;}running=true;clock.reset(performance.now());$('play').textContent='Ⅱ Пауза';$('live-dot').classList.add('running');}
function pause(silence=true){running=false;$('play').textContent='▶ Запуск';$('live-dot').classList.remove('running');if(silence&&runtime?.audio){runtime.setAudioEnabled(false);$('audio').textContent='Звук выкл.';$('audio').setAttribute('aria-pressed','false');}}
async function reset(resume=false){if(!runtime||!program)return;pause();const p=program,serial=++seekSerial;await runtime.replaceScene(p.scene,s=>installProgram(s,p));if(serial!==seekSerial)return;lastPatch='rebuild';stats.rebuilds++;if(resume)play();refreshHud(performance.now(),true);}
function step(){if(!runtime||!program||network.active)return;pause();if(runtime.scene.time<program.durationSeconds)runtime.step();refreshHud(performance.now(),true);}
$('play').onclick=()=>running?pause():play();$('reset').onclick=()=>void reset().catch(showError);$('step').onclick=step;
$('time').oninput=()=>{void seek($('time').valueAsNumber).catch(showError);};
async function seek(seconds){
 if(!runtime||!program)return;pause();const serial=++seekSerial;
 if(seconds+1e-9<runtime.scene.time){await runtime.replaceScene(program.scene,s=>installProgram(s,program));if(serial!==seekSerial)return;}
 // Yield between bounded batches so rapid scrubbing/cancellation never queues minutes of work.
 const target=Math.min(program.durationSeconds,Math.max(0,seconds));
 while(runtime.scene.time+1/120<target){if(serial!==seekSerial||disposed)return;runtime.step(Math.min(30,Math.max(1,Math.round((target-runtime.scene.time)*60))));await new Promise(resolve=>setTimeout(resolve,0));}
 refreshHud(performance.now(),true);
}
$('audio').onclick=()=>{if(!runtime)return;if(runtime.audio){runtime.setAudioEnabled(false);$('audio').textContent='Звук выкл.';$('audio').setAttribute('aria-pressed','false');}else{runtime.setAudioEnabled(true);void runtime.activateAudio().then(ready=>{if(ready){$('audio').textContent='Звук вкл.';$('audio').setAttribute('aria-pressed','true');}}).catch(showError);}};
function metricsList(node,values){const fragment=document.createDocumentFragment();for(const [name,value] of values)fragment.append(el('dt',name),el('dd',String(value)));node.replaceChildren(fragment);}
function refreshHud(now,force=false){
 if(!runtime||!program||!force&&now-lastHud<250)return;lastHud=now;
 const t=runtime.scene.time;
 $('time').value=String(t);$('time-label').textContent=fmt(t)+' / '+program.durationSeconds+' с';
 if($('control-panel').hidden)return;
 const read=session.sample(),render=read('render'),profile=read('profile'),phys=read('physics');terminal.refresh(read);
 $('render-hud').replaceChildren(...[render.backend.toUpperCase(),`${render.triangles.toLocaleString('ru-RU')} △`,`${render.drawCalls} draw`,`CPU ${fmt(profile?.latestCpu?.totalMs)} мс`,profile?.latestGpu?`GPU ${fmt(profile.latestGpu.totalMs)} мс`:'GPU timer —'].map(text=>el('span',text)));
 if(render.errors?.length)showError('Ошибка рендера: '+render.errors.join('; '));
 if(!$('diagnostics').hidden){
  metricsList($('metrics'),[['Физический tick',runtime.scene.tick],['Тела / контакты',phys.bodies+' / '+phys.contacts],['Подшаги',phys.substeps],['CPU рендер, мс',fmt(profile?.latestCpu?.totalMs)],['GPU, мс',fmt(profile?.latestGpu?.totalMs)],['Буферы / текстуры',(render.buffers??'—')+' / '+(render.textures??'—')],['Пересборки мира',stats.rebuilds],['Живые изменения',stats.liveEdits],['Компиляция, мс',fmt(stats.compileMs)],['Пропущено времени, мс',fmt(clock.droppedMs,0)]]);
  const cards=[];for(const [id,handle] of programVehicles(runtime.scene))for(const p of handle.vehicle.blueprint.parts){
   const sample=handle.vehicle.part(p.source.id),card=el('section',undefined,'part-sample');card.append(el('h4',id+' / '+sample.id));const dl=el('dl');
   metricsList(dl,sample.kind==='wheel'?[['Нагрузка, Н',fmt(sample.loadN,0)],['Сжатие, мм',fmt(sample.compressionM*1000,1)],['Износ, %',fmt(sample.wear*100,3)],['Протектор, мм',fmt(sample.treadDepthM*1000,3)],['Работа скольжения, Дж',fmt(sample.dissipatedJ,1)]]:[['Подъёмная сила, Н',fmt(sample.liftN,0)],['Сопротивление, Н',fmt(sample.dragN,0)],['Угол атаки, рад',fmt(sample.alphaRad,3)],['Производные',sample.derivedBuilds],['Отказ',sample.failed?'да':'нет']]);card.append(dl);cards.push(card);
  }$('parts').replaceChildren(...cards);
 }
}
function animate(now){if(disposed)return;try{if(network.active)network.frame(now);if(!network.active&&running&&runtime&&program){let count=0;clock.advance(now,()=>count++);count=Math.min(count,Math.max(0,Math.ceil((program.durationSeconds-runtime.scene.time)*60)));if(count){const start=performance.now();runtime.step(count);stats.frameMs=performance.now()-start;}if(runtime.scene.time+1e-8>=program.durationSeconds)pause();}recording.refresh(now);refreshHud(now);}catch(error){pause();showError(error);}raf=requestAnimationFrame(animate);}
function tab(mode){
 $('recording-panel').hidden=mode!=='recording';$('diagnostics').hidden=mode!=='diagnostics';
 for(const id of ['parameter-tools','parameter-empty','control-list'])$(id).hidden=mode!=='parameters';
 for(const id of ['parameters','diagnostics','recording'])$(id+'-tab').setAttribute('aria-pressed',String(id===mode));
 if(mode==='parameters')controls.filter();recording.refresh(performance.now());refreshHud(performance.now(),true);
}
for(const mode of ['parameters','diagnostics','recording'])$(mode+'-tab').onclick=()=>tab(mode);
$('edit-parameters').onclick=()=>{tab('parameters');$('parameter-search').focus();};
for(const b of document.querySelectorAll('[data-pane] button,button[data-pane]'))if(b.dataset.pane)b.onclick=()=>{document.querySelector('.workspace').dataset.pane=b.dataset.pane;for(const x of document.querySelectorAll('button[data-pane]'))x.setAttribute('aria-pressed',String(x===b));runtime?.render();};
// Camera gestures edit exactly the orbit literals. Expressions remain read-only.
let drag=null;
$('render').addEventListener('pointerdown',e=>{if(e.button!==0||!bindingReady)return;const yaw=bindings.find(b=>b.key==='orbit.2'),height=bindings.find(b=>b.key==='orbit.3');if(!yaw?.editable||!height?.editable)return;drag={x:e.clientX,y:e.clientY,yaw:yaw.value,height:height.value,yawId:yaw.id,heightId:height.id};doc.end();$('render').setPointerCapture(e.pointerId);});
$('render').addEventListener('pointermove',e=>{if(!drag)return;changeBinding(drag.yawId,Math.max(-Math.PI,Math.min(Math.PI,drag.yaw-(e.clientX-drag.x)*.008)),'camera');changeBinding(drag.heightId,Math.max(-.1,Math.min(1.45,drag.height+(e.clientY-drag.y)*.006)),'camera');});
$('render').addEventListener('pointerup',()=>{drag=null;doc.end();});$('render').addEventListener('pointercancel',()=>{drag=null;doc.end();});
$('render').addEventListener('wheel',e=>{const b=bindings.find(b=>b.key==='orbit.1');if(!b?.editable||!bindingReady)return;e.preventDefault();changeBinding(b.id,Math.max(2,Math.min(60,b.value*Math.exp(e.deltaY*.001))),'camera');},{passive:false});
const divider=document.querySelector('.divider');let resizing=false;
divider.onpointerdown=e=>{resizing=true;divider.setPointerCapture(e.pointerId);};divider.onpointermove=e=>{if(resizing)document.documentElement.style.setProperty('--code-width',Math.max(25,Math.min(65,e.clientX/innerWidth*100))+'%');};divider.onpointerup=()=>{resizing=false;runtime?.render();};divider.onkeydown=e=>{if(!['ArrowLeft','ArrowRight'].includes(e.key))return;e.preventDefault();const current=parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--code-width'));document.documentElement.style.setProperty('--code-width',Math.max(25,Math.min(65,current+(e.key==='ArrowRight'?2:-2)))+'%');runtime?.render();};
new ResizeObserver(()=>{if(runtime&&!running)runtime.render();}).observe($('viewport'));
function download(name,blob){const url=URL.createObjectURL(blob),a=el('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
$('save').onclick=()=>download(example.id+'.scene.ts',new Blob([doc.source],{type:'text/plain;charset=utf-8'}));$('open').onclick=()=>$('file').click();
$('file').onchange=async()=>{const file=$('file').files?.[0];if(!file)return;try{if(file.size>64000)throw new RangeError('Лимит файла — 64 КБ');pause();compiler.cancel();resetBindings=true;setSource(await file.text(),{trust:false});status('Код из файла · нажмите «Применить»');}catch(error){showError(error);}finally{$('file').value='';}};
$('image').onclick=()=>{if(runtime)void runtime.capture().then(blob=>download(example.id+'.png',blob)).catch(showError);};
const encode=text=>{let binary='';for(const byte of new TextEncoder().encode(text))binary+=String.fromCharCode(byte);return btoa(binary);};
const decode=text=>{const data=atob(text);if(data.length>64000)throw new RangeError('Лимит ссылки — 64 КБ');return new TextDecoder('utf-8',{fatal:true}).decode(Uint8Array.from(data,c=>c.charCodeAt(0)));};
$('share').onclick=async()=>{const url=new URL(location.href);url.hash=new URLSearchParams({scene:example.id,source:encode(doc.source)}).toString();try{await navigator.clipboard.writeText(url.href);status('Ссылка скопирована · получатель подтверждает запуск');}catch{history.replaceState(null,'',url);status('Ссылка в адресной строке');}};
function coverage(){
 const all=new Map();for(const entry of EXAMPLES)for(const id of entry.legacy){const row=all.get(id)??{id,examples:[]};row.examples.push(entry);all.set(id,row);}for(const pending of LEGACY_PENDING){const row=all.get(pending.id)??{id:pending.id,examples:[]};Object.assign(row,pending);all.set(row.id,row);}
 const nodes=[];for(const row of all.values()){const item=el('div',undefined,'coverage-item'),left=el('div');left.append(el('strong',row.title??row.examples[0]?.title??row.id),el('small',row.id));for(const x of row.examples)left.append(button(x.id,()=>{$('coverage-dialog').close();selectExample(x.id);},'quiet'));item.append(left,el('p',row.reason??row.examples.map(x=>x.limit).join(' ')));nodes.push(item);}$('coverage-content').replaceChildren(...nodes);$('coverage-dialog').showModal();
}
$('coverage').onclick=coverage;$('scope-badge').onclick=coverage;$('scope-badge').role='button';$('scope-badge').tabIndex=0;$('scope-badge').onkeydown=e=>{if(e.key==='Enter'||e.key===' ')coverage();};$('close-coverage').onclick=()=>$('coverage-dialog').close();
addEventListener('visibilitychange',()=>{if(document.hidden)pause();});
addEventListener('pagehide',()=>{disposed=true;cancelAnimationFrame(raf);clearTimeout(timer);compiler.dispose();recording.dispose();terminal.dispose();network.stop();runtime?.dispose();},{once:true});
// Small test/automation surface. Production uses exactly the same actions as a human.
globalThis.__DSL_EDITOR__={recording,network,console:session,get source(){return doc.source;},get revision(){return doc.revision;},get appliedRevision(){return compiledRevision;},get bindings(){return bindings;},get stats(){return {...stats};},get lastPatch(){return lastPatch;},get compilers(){return lastCompiler;},get program(){return program;},get runtime(){return runtime;},edit:(id,value)=>changeBinding(id,value),setSource:text=>setSource(text),select:selectExample,apply,seek,play,pause,undo:()=>restored(doc.undo(selection()))};
const initialHash=new URLSearchParams(location.hash.slice(1)),id=initialHash.get('scene');
try{selectExample(EXAMPLES.some(x=>x.id===id)?id:EXAMPLES[0].id,initialHash.has('source')?{imported:decode(initialHash.get('source'))}:{});}
catch(error){external=true;showError(error);}
raf=requestAnimationFrame(animate);
