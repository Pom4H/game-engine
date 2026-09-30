import {SourceDocument} from './document.mjs';
import './bindings.cjs';
const create=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;};
/** One authored document and AST ranges, reused from the engine editor.
 * Runtime moves never silently edit source; Apply is a separate installation boundary. */
export function workbench({host,game,source,onApply}){
 const doc=new SourceDocument(source),head=create('div',undefined,'wb-head'),body=create('div',undefined,'wb-body'),editor=create('textarea'),highlight=create('pre',undefined,'wb-highlight'),code=create('div',undefined,'wb-code'),fields=create('div',undefined,'wb-fields'),status=create('p','Параметры извлекаются из TypeScript','wb-status');
 editor.setAttribute('aria-label','Исходник игрового проекта');editor.spellcheck=false;editor.wrap='off';editor.value=source;
 const apply=create('button','Применить'),undo=create('button','↶'),redo=create('button','↷'),save=create('button','Скачать .ts'),presets=create('select');
 undo.title='Отменить правку исходника';redo.title='Повторить правку исходника';presets.setAttribute('aria-label','Пресет проекта');apply.className='primary';
 head.append(create('code','project.ts'),undo,redo,save,presets,apply);code.append(highlight,editor);body.append(code,fields);host.append(head,body,status);
 let worker,request=0,timeout,analyzeTimer,disposed=false,bindings=[],tokens=[],compiled=null,dirty=true,applying=false,controller;
 const nodes=new Map();
 function restart(){worker?.terminate();worker=new Worker(new URL('./game-compiler.js',import.meta.url));worker.onerror=event=>fail(event.message);worker.onmessage=event=>receive(event.data);}
 function fail(message){clearTimeout(timeout);applying=false;apply.disabled=false;presets.disabled=false;status.textContent=message;status.dataset.error='true';}
 function send(kind){if(disposed)return;clearTimeout(timeout);if(!worker)restart();const id=++request;worker.postMessage({id,kind,game,source:doc.source});timeout=setTimeout(()=>{worker?.terminate();worker=null;fail('Компиляция остановлена по лимиту времени. Действующая игра не изменена.');},6000);}
 function paint(){highlight.replaceChildren();let at=0;for(const [start,end,kind] of tokens){highlight.append(document.createTextNode(doc.source.slice(at,start)),create('span',doc.source.slice(start,end),'syntax-'+kind));at=end;}highlight.append(document.createTextNode(doc.source.slice(at)+'\n'));editor.value=doc.source;undo.disabled=!doc.past.length;redo.disabled=!doc.future.length;}
 function cancelInstall(){controller?.abort();controller=null;if(applying){++request;restart();applying=false;apply.disabled=false;presets.disabled=false;}}
 function edit(source){cancelInstall();doc.set(source,{group:'typing',selection:[editor.selectionStart,editor.selectionEnd]});dirty=true;clearTimeout(analyzeTimer);analyzeTimer=setTimeout(()=>send('analyze'),160);status.textContent='Исходник изменён. Действующая игра сохранена до применения.';status.dataset.error='false';}
 editor.oninput=()=>edit(editor.value);editor.onscroll=()=>{highlight.scrollTop=editor.scrollTop;highlight.scrollLeft=editor.scrollLeft;};
 editor.onkeydown=event=>{if(event.key==='Tab'){event.preventDefault();editor.setRangeText('  ',editor.selectionStart,editor.selectionEnd,'end');edit(editor.value);}if((event.ctrlKey||event.metaKey)&&event.key==='Enter'){event.preventDefault();void install();}};
 function change(binding,value){cancelInstall();clearTimeout(analyzeTimer);try{const next=globalThis.DSLBindings.applyEdits(doc.source,globalThis.DSLBindings.editsFor(doc.source,binding,value));doc.set(next,{group:binding.id});dirty=true;editor.value=doc.source;send('analyze');status.textContent='Параметр записан в исходник. Примените проект.';}catch(error){fail(error.message);}}
 function controls(){const live=new Set();for(const binding of bindings.filter(b=>b.editable)){
  live.add(binding.id);let row=nodes.get(binding.id);
  if(!row){row=create('label',undefined,'wb-field');const label=create('span'),input=create('input'),line=create('button','↗');line.type='button';line.title='Перейти к строке исходника';row.append(label,input,line);nodes.set(binding.id,row);fields.append(row);}
  const [label,input,line]=row.children;row.dataset.key=binding.key;label.textContent=binding.label;label.title=binding.path??binding.key;input.type=binding.shape==='number'?'number':'text';if(binding.shape==='number'){input.min=binding.min;input.max=binding.max;input.step=binding.step;}
  if(document.activeElement!==input)input.value=String(binding.value);input.onchange=()=>change(binding,binding.shape==='number'?input.valueAsNumber:input.value);
  line.onclick=event=>{event.preventDefault();editor.focus();editor.setSelectionRange(binding.start,binding.end);editor.scrollTop=Math.max(0,(binding.line-3)*22);highlight.scrollTop=editor.scrollTop;};
 }
 for(const [id,row] of nodes)if(!live.has(id)){row.remove();nodes.delete(id);}}
 async function receive(data){if(disposed||data.id!==request)return;clearTimeout(timeout);if(data.error){fail(data.error);return;}
  const selection=[editor.selectionStart,editor.selectionEnd],focused=document.activeElement===editor;
  bindings=data.bindings;tokens=data.tokens;paint();if(focused)editor.setSelectionRange(...selection);controls();
  if(data.compiled){
   const next=data.compiled, old=presets.value, chosen=Object.hasOwn(next.presets,old)?old:undefined;
   controller=new AbortController();const active=controller;
   try{await onApply(next,chosen,{signal:active.signal});if(disposed||data.id!==request||active.signal.aborted)return;
    compiled=next;presets.replaceChildren(new Option('Исходный состав',''),...Object.keys(compiled.presets).map(name=>new Option(name,name)));presets.value=chosen??'';
    dirty=false;status.textContent='Применён проверенный проект. Код и параметры связаны.';status.dataset.error='false';
   }catch(error){if(!active.signal.aborted)fail(error.message);}
   if(data.id===request){applying=false;apply.disabled=false;presets.disabled=false;controller=null;}
  }
 }
 async function install(){if(applying)return;clearTimeout(analyzeTimer);applying=true;apply.disabled=true;presets.disabled=true;doc.end();send('compile');}
 apply.onclick=install;presets.onchange=async()=>{if(dirty){fail('Сначала примените изменённый исходник. Пресет не запускает черновик.');return;}try{applying=true;apply.disabled=true;presets.disabled=true;controller=new AbortController();const active=controller;await onApply(compiled,presets.value||undefined,{signal:active.signal});if(active.signal.aborted)return;status.textContent=presets.value?'Применён пресет '+presets.value:'Применены исходные параметры';}catch(error){fail(error.message);}finally{applying=false;apply.disabled=false;presets.disabled=false;}};
 undo.onclick=()=>{cancelInstall();clearTimeout(analyzeTimer);if(doc.undo()){dirty=true;editor.value=doc.source;send('analyze');}};redo.onclick=()=>{cancelInstall();clearTimeout(analyzeTimer);if(doc.redo()){dirty=true;editor.value=doc.source;send('analyze');}};
 save.onclick=()=>{const url=URL.createObjectURL(new Blob([doc.source],{type:'text/plain'})),a=create('a');a.href=url;a.download='project.ts';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
 restart();void install();
 return {get source(){return doc.source;},setParameter(key,value){const binding=bindings.find(b=>b.key===key);if(!binding)throw Error('Нет редактируемого параметра '+key);change(binding,value);},apply:install,dispose(){disposed=true;controller?.abort();worker?.terminate();clearTimeout(timeout);clearTimeout(analyzeTimer);host.replaceChildren();}};
}
