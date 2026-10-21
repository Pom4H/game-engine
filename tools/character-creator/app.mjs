import {CHARACTER_PRESETS,DEFAULT_CHARACTER_SPEC,characterSpec} from '../../dist/characters/character.js';
import {CharacterStudio} from './studio.mjs';
import {DRAFT_KEY,readPath,changedSpec,parseCharacterJSON,CharacterHistory,characterTypeScript} from './model.mjs';

const $=selector=>document.querySelector(selector),$$=selector=>[...document.querySelectorAll(selector)];
const format=new Intl.NumberFormat('ru-RU');
const bodyFields=[
  ['height','Рост',1.5,2.05,.01,'150 см','205 см'],
  ['build','Комплекция',0,1,.01,'Худощавый','Плотный'],
  ['shoulders','Ширина плеч',.7,1.3,.01,'Уже','Шире'],
  ['hips','Ширина бёдер',.7,1.3,.01,'Уже','Шире'],
  ['torso','Длина торса',.7,1.3,.01,'Короче','Длиннее'],
  ['arms','Длина рук',.7,1.3,.01,'Короче','Длиннее'],
  ['legs','Длина ног',.7,1.3,.01,'Короче','Длиннее'],
];
const colorFields=[['top','Верх','outfit'],['bottom','Брюки','outfit'],['shoes','Обувь','outfit'],['scarf','Шарф','outfit'],['skin','Кожа','face'],['hair','Волосы','face']];
let spec=structuredClone(DEFAULT_CHARACTER_SPEC),draft,history,studio,desired=null,updateTask=null,toastTimer,renderTimer,raf=0,playing=false,lastTime=0,motionTime=0,tab='body',restored=false,jsonDirty=false,disposed=false;
try{
  const saved=localStorage.getItem(DRAFT_KEY);if(saved){spec=parseCharacterJSON(saved);restored=true;}
}catch{ /* An unavailable or malformed saved draft never prevents editing. */ }
history=new CharacterHistory(spec);
draft=structuredClone(spec);

function toast(message){clearTimeout(toastTimer);$('#toast').textContent=message;$('#toast').hidden=false;toastTimer=setTimeout(()=>{$('#toast').hidden=true;},3400);}
function fail(error){
  pause();const message=error?.message??String(error);
  $('#engine-error-text').textContent=message;$('#engine-error').hidden=false;$('#loading').hidden=true;$('#save-status').textContent='Ошибка предпросмотра';
  globalThis.__CHARACTER_ERROR__=error?.stack??String(error);
  console.error(error);
}
function button(label,className){
  const b=document.createElement('button');b.type='button';if(className)b.className=className;b.textContent=label;return b;
}
function createControls(){
  bodyFields.forEach(([key,label,min,max,step,low,high])=>{
    const wrap=document.createElement('label');wrap.className='range-field';
    const caption=document.createElement('span');caption.className='range-caption';
    const name=document.createElement('span');name.textContent=label;const output=document.createElement('output');output.dataset.for='body.'+key;caption.append(name,output);
    const input=document.createElement('input');Object.assign(input,{type:'range',min:String(min),max:String(max),step:String(step),id:'body-'+key});input.dataset.path='body.'+key;output.htmlFor=input.id;
    const limits=document.createElement('span');limits.className='range-limits';const a=document.createElement('span'),b=document.createElement('span');a.textContent=low;b.textContent=high;limits.append(a,b);
    wrap.append(caption,input,limits);$('#body-controls').append(wrap);
  });
  colorFields.forEach(([key,label,group])=>{
    const wrap=document.createElement('label');wrap.className='color-field';const name=document.createElement('span');name.textContent=label;
    const right=document.createElement('span');right.className='color-input-wrap';const output=document.createElement('output');output.dataset.for='colors.'+key;
    const input=document.createElement('input');input.type='color';input.dataset.path='colors.'+key;input.id='color-'+key;output.htmlFor=input.id;
    right.append(output,input);wrap.append(name,right);$('#'+group+'-colors').append(wrap);
  });
  CHARACTER_PRESETS.forEach((preset,index)=>{
    const b=button('','preset');b.dataset.preset=preset.id;b.setAttribute('aria-pressed','false');
    const swatch=document.createElement('span');swatch.className='preset-swatch';swatch.setAttribute('aria-hidden','true');
    for(const part of ['top','bottom','shoes']){const color=document.createElement('i');color.style.background=preset.spec.colors[part];swatch.append(color);}
    const copy=document.createElement('span'),name=document.createElement('span'),details=document.createElement('span'),number=document.createElement('span');
    name.className='preset-name';name.textContent=preset.name;details.className='preset-detail';details.textContent=Math.round(preset.spec.body.height*100)+' см · '+({parka:'Парка',jacket:'Куртка',sweater:'Свитер'}[preset.spec.outfit.top]);number.className='preset-index';number.textContent=String(index+1).padStart(2,'0');copy.append(name,details);b.append(swatch,copy,number);
    b.addEventListener('click',()=>act(async()=>{await setSpec(preset.spec);studio?.setView('three-quarter');syncView();toast('Образ «'+preset.name+'» выбран');}));$('#presets').append(b);
  });
}
function formatValue(path,value){
  if(path==='body.height')return Math.round(value*100)+' см';
  if(path==='body.build')return Math.round(value*100)+'%';
  if(path.startsWith('body.'))return Math.round(value*100)+'%';
  return String(value);
}
function syncControls(){
  for(const el of $$('[data-path]')){
    const value=readPath(draft,el.dataset.path);
    if(el.type==='checkbox')el.checked=value;else el.value=String(value);
    if(el.type==='range')el.style.setProperty('--range-progress',((value-Number(el.min))/(Number(el.max)-Number(el.min))*100)+'%');
  }
  $$('output[data-for]').forEach(output=>{output.textContent=formatValue(output.dataset.for,readPath(draft,output.dataset.for));});
  const exact=CHARACTER_PRESETS.find(p=>JSON.stringify(p.spec)===JSON.stringify(draft));
  $('#character-name').textContent=exact?exact.name:'Свой персонаж';
  $('#character-number').textContent=exact?String(CHARACTER_PRESETS.indexOf(exact)+1).padStart(3,'0'):'EDIT';
  $('#character-description').textContent=exact?exact.description:Math.round(draft.body.height*100)+' см · '+({parka:'Зимняя парка',jacket:'Рабочая куртка',sweater:'Свитер'}[draft.outfit.top]);
  $$('[data-preset]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.preset===exact?.id)));
  $('#height-label').textContent=draft.body.height.toFixed(2).replace('.',',')+' м';
  if(!jsonDirty||tab!=='code'){$('#spec-json').value=JSON.stringify(draft,null,2);jsonDirty=false;}
  $('#undo').disabled=!history.canUndo;$('#redo').disabled=!history.canRedo;
}
function persist(){
  try{localStorage.setItem(DRAFT_KEY,JSON.stringify(spec));$('#save-status').textContent='Изменения сохранены';}
  catch{$('#save-status').textContent='Сохрани персонажа через JSON';}
}
function stats(){
  if(!studio)return;
  const s=studio.inspect();$('#geometry-status').textContent=format.format(s.metrics.triangles)+' треугольников · '+s.metrics.entityCount+' деталей';
  const software=s.adapter.isFallbackAdapter||/swiftshader|lavapipe|llvmpipe|software|microsoft basic|warp/i.test(JSON.stringify(s.adapter));
  $('#backend-status').textContent=software?'WEBGPU · ПРОГРАММНЫЙ':'WEBGPU';
}
function syncView(){if(studio)$$('[data-view]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.view===studio.view)));}
function selectTab(next){
  if(!['body','outfit','face','code'].includes(next))return;tab=next;
  $$('[data-tab]').forEach(el=>{const selected=el.dataset.tab===next;el.setAttribute('aria-selected',String(selected));el.tabIndex=selected?0:-1;});
  $$('[role=tabpanel]').forEach(el=>el.hidden=el.id!=='panel-'+next);
  if(next==='code'&&!jsonDirty)$('#spec-json').value=JSON.stringify(spec,null,2);
  $('.panel-scroll').scrollTop=0;
}
async function performUpdates(){
  while(desired&&!disposed){
    const next=desired;desired=null;
    if(studio)await studio.replace(next);
    // Only publish a committed state after the corresponding geometry succeeds.
    spec=next;syncControls();persist();stats();
  }
}
function scheduleRender(){
  clearTimeout(renderTimer);
  if(updateTask)return updateTask;
  updateTask=performUpdates().finally(()=>{updateTask=null;});
  return updateTask;
}
async function setSpec(value,{record=true}={}){
  const next=characterSpec(value);clearTimeout(renderTimer);
  draft=next;desired=next;if(record)history.push(next);
  $('#save-status').textContent='Обновляю модель…';
  await scheduleRender();
  return structuredClone(spec);
}
async function settle(){
  clearTimeout(renderTimer);if(desired&&!updateTask)await scheduleRender();if(updateTask)await updateTask;
  if(studio)return studio.settle();return null;
}
function edit(path,value,commit){
  const next=changedSpec(draft,path,value);draft=next;desired=next;
  // Inputs display their requested value while a geometry rebuild is in flight.
  $$('output[data-for]').filter(e=>e.dataset.for===path).forEach(output=>output.textContent=formatValue(path,value));
  const range=$('[data-path="'+path+'"]');
  if(range?.type==='range')range.style.setProperty('--range-progress',((value-Number(range.min))/(Number(range.max)-Number(range.min))*100)+'%');
  if(commit){history.push(next);clearTimeout(renderTimer);return scheduleRender();}
  clearTimeout(renderTimer);renderTimer=setTimeout(()=>{void scheduleRender().catch(fail);},70);
}
async function act(fn){try{return await fn();}catch(error){toast(error.message??String(error));return null;}}
function pause(){playing=false;if(raf)cancelAnimationFrame(raf);raf=0;$('#play-motion').textContent='▷';$('#play-motion').setAttribute('aria-label','Запустить движение');}
function play(){
  if(!studio||playing)return;
  if(studio.poseMode!=='walk'){studio.setPose('walk',0);$('#pose-mode').value='walk';motionTime=0;}
  playing=true;lastTime=performance.now();$('#play-motion').textContent='Ⅱ';$('#play-motion').setAttribute('aria-label','Остановить движение');
  const frame=now=>{
    if(!playing||disposed)return;
    if(now-lastTime>1000/30&&!updateTask){
      motionTime+=(now-lastTime)/1000;lastTime=now;
      try{studio.setPose('walk',motionTime);}catch(error){fail(error);return;}
    }
    raf=requestAnimationFrame(frame);
  };raf=requestAnimationFrame(frame);
}
async function setPose(mode,time=0){pause();await settle();motionTime=time;studio?.setPose(mode,time);$('#pose-mode').value=mode;return studio?.settle();}
function download(blob,name){
  const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.hidden=true;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
}
const safeName=()=>spec.id.replace(/[^a-zA-Z0-9_-]/g,'-').slice(0,60)||'character';
function jsonMessage(message,error=false){$('#json-status').textContent=message;$('#json-status').classList.toggle('error',error);}
async function applyJSON(text){
  try{const parsed=parseCharacterJSON(text);jsonDirty=false;await setSpec(parsed);jsonMessage('Параметры применены и сохранены.');return true;}
  catch(error){jsonMessage(error.message??'Не удалось прочитать JSON',true);return false;}
}

createControls();syncControls();
for(const el of $$('button,input,select,textarea'))if(el.id!=='retry-engine')el.disabled=true;
for(const el of $$('[data-path]')){
  const value=()=>el.type==='checkbox'?el.checked:['range','number'].includes(el.type)?Number(el.value):el.value;
  const continuous=el.type==='range'||el.type==='color';
  if(continuous)el.addEventListener('input',()=>{void act(()=>edit(el.dataset.path,value(),false));});
  el.addEventListener('change',()=>{void act(()=>edit(el.dataset.path,value(),true));});
}
$$('[data-tab]').forEach(el=>{
  el.addEventListener('click',()=>selectTab(el.dataset.tab));
  el.addEventListener('keydown',event=>{
    const names=['body','outfit','face','code'];let index=names.indexOf(el.dataset.tab);
    if(event.key==='ArrowRight')index=(index+1)%4;else if(event.key==='ArrowLeft')index=(index+3)%4;else if(event.key==='Home')index=0;else if(event.key==='End')index=3;else return;
    event.preventDefault();selectTab(names[index]);$('#tab-'+names[index]).focus();
  });
});
$$('[data-view]').forEach(el=>el.addEventListener('click',()=>{studio?.setView(el.dataset.view);syncView();}));
$('#open-code').addEventListener('click',()=>{selectTab('code');if(innerWidth<=700)$('.inspector').scrollIntoView({block:'start',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});});
$('#pose-mode').addEventListener('change',()=>{void act(async()=>{const mode=$('#pose-mode').value;await setPose(mode);if(mode==='walk')play();});});
$('#play-motion').addEventListener('click',()=>{if(playing)pause();else play();});
$('#reset').addEventListener('click',()=>{void act(async()=>{pause();await setSpec(DEFAULT_CHARACTER_SPEC);await setPose('idle');studio?.setView('three-quarter');syncView();toast('Исходный образ восстановлен');});});
$('#new-seed').addEventListener('click',()=>{void act(()=>edit('seed',crypto.getRandomValues(new Uint32Array(1))[0],true));});
$('#undo').addEventListener('click',()=>{void act(()=>setSpec(history.undo(),{record:false}));});
$('#redo').addEventListener('click',()=>{void act(()=>setSpec(history.redo(),{record:false}));});
addEventListener('keydown',event=>{
  if(!(event.ctrlKey||event.metaKey)||event.key.toLowerCase()!=='z'||['TEXTAREA'].includes(event.target.tagName)||event.target.type==='text')return;
  event.preventDefault();void act(()=>setSpec(event.shiftKey?history.redo():history.undo(),{record:false}));
});
$('#spec-json').addEventListener('input',()=>{jsonDirty=true;jsonMessage('JSON изменён. Нажми «Применить JSON», чтобы обновить модель.');});
$('#import-json').addEventListener('click',()=>{void applyJSON($('#spec-json').value);});
$('#export-json').addEventListener('click',()=>{void act(async()=>{await settle();download(new Blob([JSON.stringify(spec,null,2)+'\n'],{type:'application/json'}),safeName()+'.character.json');jsonMessage('JSON сохранён. Его можно открыть в этом конструкторе.');});});
$('#download-ts').addEventListener('click',()=>{void act(async()=>{await settle();download(new Blob([characterTypeScript(spec)],{type:'text/typescript'}),safeName()+'.scene.ts');});});
$('#upload-json').addEventListener('click',()=>$('#json-file').click());
$('#json-file').addEventListener('change',()=>{void act(async()=>{const file=$('#json-file').files?.[0];if(!file)return;if(file.size>65536){jsonMessage('Файл параметров не должен превышать 64 КБ',true);return;}await applyJSON(await file.text());$('#json-file').value='';});});
$('#screenshot').addEventListener('click',()=>{void act(async()=>{pause();await settle();if(studio)download(await studio.capture(),safeName()+'.png');});});
$('#retry-engine').addEventListener('click',()=>location.reload());

const canvas=$('#character-canvas'),pointers=new Map();let pinchDistance=0;
canvas.addEventListener('pointerdown',event=>{if(!studio)return;pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});canvas.setPointerCapture(event.pointerId);pinchDistance=0;});
canvas.addEventListener('pointermove',event=>{
  const before=pointers.get(event.pointerId);if(!before||!studio)return;
  pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});
  if(pointers.size===2){const [a,b]=[...pointers.values()],d=Math.hypot(a.x-b.x,a.y-b.y);if(pinchDistance)studio.zoomBy((pinchDistance-d)*2);pinchDistance=d;}
  else studio.orbit(event.clientX-before.x,event.clientY-before.y);
});
for(const type of ['pointerup','pointercancel','lostpointercapture'])canvas.addEventListener(type,event=>{pointers.delete(event.pointerId);pinchDistance=0;});
canvas.addEventListener('wheel',event=>{if(!studio)return;event.preventDefault();studio.zoomBy(event.deltaY);},{passive:false});
canvas.addEventListener('keydown',event=>{
  const keys={ArrowLeft:[-10,0],ArrowRight:[10,0],ArrowUp:[0,-10],ArrowDown:[0,10]};
  if(keys[event.key]){event.preventDefault();studio?.orbit(...keys[event.key]);}else if(event.key==='+'||event.key==='='){event.preventDefault();studio?.zoomBy(-70);}else if(event.key==='-'){event.preventDefault();studio?.zoomBy(70);}
});
const resizeObserver=new ResizeObserver(()=>studio?.resize());resizeObserver.observe($('#viewport'));
addEventListener('visibilitychange',()=>{if(document.hidden)pause();});
addEventListener('pagehide',()=>{disposed=true;pause();clearTimeout(renderTimer);clearTimeout(toastTimer);resizeObserver.disconnect();studio?.dispose();},{once:true});

async function initialize(){
  try{
    if(!navigator.gpu)throw new Error('Этот браузер не предоставляет WebGPU. Открой конструктор в браузере с поддержкой WebGPU по HTTPS или через localhost.');
    const metadata=globalThis.__CHARACTER_BUILD_META__??await(await fetch('/meta.json')).json();
    studio=await CharacterStudio.create(canvas,spec,{...metadata,captureToken:new URLSearchParams(location.search).get('token')});studio.onError=fail;
    globalThis.characterCreator={
      getSpec:()=>structuredClone(spec),setSpec,
      setPose, setView:async view=>{await settle();studio.setView(view);syncView();return studio.settle();},
      inspect:()=>studio.inspect(),settle,selectTab,
      capture:()=>studio.capture(),
    };
    $('#loading').hidden=true;for(const el of $$('button,input,select,textarea'))el.disabled=false;
    syncControls();persist();stats();syncView();
    globalThis.__CHARACTER_READY__=true;globalThis.__CHARACTER_ERROR__=null;
    if(restored)toast('Последний персонаж восстановлен');
  }catch(error){fail(error);}
}
void initialize();
