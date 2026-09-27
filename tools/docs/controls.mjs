/** DOM projection of AST bindings. All edits go back to SourceDocument, never to the renderer. */
const node=(tag,text,className)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(className)n.className=className;return n;};
const same=(a,b)=>Array.isArray(a)&&Array.isArray(b)?a.length===b.length&&a.every((v,i)=>v===b[i]):a===b;
const copy=v=>Array.isArray(v)?[...v]:v;
const axes=['x','y','z','w'];
export class BoundControls {
 constructor({list,search,count,empty,groups,onEdit,onSelect,begin,end}){
  Object.assign(this,{list,search,count,empty,groups,onEdit,onSelect,begin,end});
  this.bindings=new Map();this.rows=new Map();this.sections=new Map();this.defaults=new Map();this.ready=false;
  search.addEventListener('input',()=>this.filter());
  search.addEventListener('keydown',e=>{if(e.key==='Escape'){search.value='';this.filter();}});
 }
 update(bindings,{ready=true,reset=false}={}){
  this.ready=ready;this.bindings=new Map(bindings.map(b=>[b.id,b]));
  if(reset)this.defaults=new Map(bindings.filter(b=>b.editable).map(b=>[b.id,copy(b.value)]));
  for(const [id,row] of this.rows)if(!this.bindings.has(id)){row.remove();this.rows.delete(id);}
  for(const key of ['camera','render','material','input','mechanics','environment','scene']){
   const items=bindings.filter(b=>b.group===key);let section=this.sections.get(key);
   if(!items.length){if(section){section.remove();this.sections.delete(key);}continue;}
   if(!section){section=node('details',undefined,'control-group');section.dataset.group=key;section.open=['render','material'].includes(key);const summary=node('summary',this.groups[key]);summary.append(node('small'));section.append(summary);this.sections.set(key,section);}
   if(section.parentElement!==this.list)this.list.append(section);
   section.querySelector('small').textContent=String(items.length);
   let previous=section.querySelector('summary');
   for(const b of items){
    const signature=JSON.stringify([b.shape,b.editable,b.elements?.length,b.options]);let row=this.rows.get(b.id);
    if(!row||row.dataset.signature!==signature){const old=row;row=this.create(b);row.dataset.signature=signature;this.rows.set(b.id,row);old?.replaceWith(row);}
    // Do not detach/reinsert a live slider: pointer capture and numeric caret must survive compilation.
    if(previous.nextElementSibling!==row)previous.after(row);previous=row;
    this.sync(row,b);
   }
  }
  this.filter();
 }
 create(b){
  const row=node('div',undefined,'control-row');row.dataset.binding=b.id;row.dataset.key=b.key;
  const id='control-'+encodeURIComponent(b.id),title=node('div',undefined,'row-title');
  const label=node('label',b.label+(b.unit?' · '+b.unit:''));label.htmlFor=id;
  const actions=node('div',undefined,'row-actions');
  const link=node('button',':'+b.line,'source-link');link.type='button';link.title='Показать значение в коде';link.setAttribute('aria-label',b.label+': показать в коде');link.onclick=()=>this.onSelect(this.bindings.get(b.id));actions.append(link);
  if(b.editable){const reset=node('button','↺','value-reset');reset.type='button';reset.title='Вернуть значение при открытии сцены';reset.setAttribute('aria-label',b.label+': сбросить значение');reset.onclick=()=>{if(!this.ready||!this.defaults.has(b.id))return;this.begin();this.onEdit(b.id,copy(this.defaults.get(b.id)));this.end();};actions.prepend(reset);}
  title.append(label,actions);row.append(title,node('small',undefined,'control-context'));
  if(!b.editable){row.append(node('code',b.raw,'expression'));return row;}
  const input=type=>{const f=node('input');f.type=type;f.setAttribute('aria-label',b.label);return f;};
  const edit=value=>{if(this.ready)this.onEdit(b.id,value);};
  const numeric=(f,axis)=>{
   f.step=String(axis===undefined?b.step:.01);f.inputMode='decimal';if(axis!==undefined){f.dataset.axis=String(axis);f.setAttribute('aria-label',b.label+' '+axes[axis]);}
   f.oninput=()=>{if(!Number.isFinite(f.valueAsNumber))return;if(axis===undefined)edit(f.valueAsNumber);else{const v=[...this.bindings.get(b.id).value];v[axis]=f.valueAsNumber;edit(v);}};
   f.onblur=()=>this.sync(row,this.bindings.get(b.id),true);
   f.onkeydown=e=>{if(e.key==='Enter')f.blur();if(e.key==='Escape'){this.sync(row,this.bindings.get(b.id),true);f.blur();}};
  };
  if(b.shape==='number'){
   const line=node('div',undefined,'range-row'),range=input('range'),field=input('number');field.id=id;range.step=String(b.step);range.oninput=()=>edit(range.valueAsNumber);numeric(field);line.append(range,field);row.append(line);
   label.classList.add('scrubbable');label.title='Тянуть мышью: изменить. Shift — точнее, Alt — крупнее. Можно ввести число справа.';
   let drag=null;
   label.onpointerdown=e=>{if(e.button!==0||e.pointerType==='touch'||!this.ready)return;e.preventDefault();this.begin();drag={x:e.clientX,value:this.bindings.get(b.id).value,moved:false};label.setPointerCapture(e.pointerId);};
   label.onpointermove=e=>{if(!drag)return;const dx=e.clientX-drag.x;if(!drag.moved&&Math.abs(dx)<3)return;drag.moved=true;const current=this.bindings.get(b.id),step=current.step*(e.shiftKey?.1:e.altKey?10:1);edit(Number(Math.max(Math.min(current.min,drag.value),Math.min(Math.max(current.max,drag.value),drag.value+Math.round(dx/4)*step)).toPrecision(12)));};
   label.onpointerup=e=>{if(!drag)return;const moved=drag.moved;drag=null;label.releasePointerCapture(e.pointerId);this.end();if(!moved){field.focus();field.select();}};
   label.onpointercancel=()=>{drag=null;this.end();};
  }else if(b.shape==='vector'){
   const line=node('div',undefined,'vector');b.value.forEach((_,i)=>{const tag=node('label',axes[i]),field=input('number');field.id=id+'-'+i;if(!i)label.htmlFor=field.id;numeric(field,i);tag.append(field);line.append(tag);});row.append(line);
  }else if(b.shape==='color'){
   const line=node('div',undefined,'color-row'),field=input('color');field.id=id;field.oninput=()=>{const v=[...this.bindings.get(b.id).value];for(let i=0;i<3;i++)v[i]=Number((parseInt(field.value.slice(i*2+1,i*2+3),16)/255).toFixed(4));edit(v);};line.append(field,node('output'));row.append(line);
  }else if(b.shape==='select'){
   const select=node('select');select.id=id;select.setAttribute('aria-label',b.label);for(const v of b.options){const option=node('option',v);option.value=v;select.append(option);}select.onchange=()=>edit(select.value);row.append(select);
  }else if(b.shape==='boolean'){
   const line=node('div',undefined,'toggle-row'),field=input('checkbox');field.id=id;field.onchange=()=>edit(field.checked);line.append(field,node('output'));row.append(line);
  }
  row.addEventListener('pointerdown',()=>this.begin());row.addEventListener('change',()=>this.end());return row;
 }
 sync(row,b,force=false){
  if(!b)return;row.querySelector('.source-link').textContent=':'+b.line;
  const context=[b.where,b.path,b.uses>1?'Общее значение ×'+b.uses:''].filter(Boolean).join(' / ');
  row.querySelector('.control-context').textContent=context;row.querySelector('.control-context').title=context;
  const expression=row.querySelector('.expression');if(expression){expression.textContent=b.raw;expression.title=b.reason;}
  for(const f of row.querySelectorAll('input,select')){
   f.disabled=!this.ready;
   if(f.type==='range'){f.min=String(Math.min(b.min,b.value));f.max=String(Math.max(b.max,b.value));f.setAttribute('aria-valuetext',String(b.value)+(b.unit?' '+b.unit:''));}
   if(f.type==='checkbox')f.checked=!!b.value;
   else if(f.type==='color')f.value='#'+b.value.slice(0,3).map(v=>Math.round(Math.max(0,Math.min(1,v))*255).toString(16).padStart(2,'0')).join('');
   else {const v=f.dataset.axis===undefined?b.value:b.value[Number(f.dataset.axis)];
    if(f.type==='number'&&!force&&(f.valueAsNumber===v||f===document.activeElement&&!Number.isFinite(f.valueAsNumber)))continue;
    if(f.value!==String(v))f.value=String(v);
   }
  }
  const out=row.querySelector('output');if(out)out.textContent=b.shape==='boolean'?(b.value?'Включено':'Выключено'):b.value.slice(0,3).map(v=>v.toFixed(2)).join(' / ');
  const reset=row.querySelector('.value-reset');if(reset)reset.disabled=!this.ready||!this.defaults.has(b.id)||same(b.value,this.defaults.get(b.id));
 }
 filter(){
  const words=this.search.value.toLocaleLowerCase('ru').trim().split(/\s+/).filter(Boolean);let shown=0;
  for(const [key,section] of this.sections){let count=0;
   if(words.length&&section.dataset.beforeSearch===undefined)section.dataset.beforeSearch=String(section.open);
   for(const row of section.querySelectorAll('.control-row')){const b=this.bindings.get(row.dataset.binding);const text=[b.label,b.key,b.where,b.path,this.groups[key]].join(' ').toLocaleLowerCase('ru');row.hidden=!words.every(w=>text.includes(w));if(!row.hidden)count++;}
   section.hidden=count===0;shown+=count;
   if(words.length&&count)section.open=true;
   else if(!words.length&&section.dataset.beforeSearch!==undefined){section.open=section.dataset.beforeSearch==='true';delete section.dataset.beforeSearch;}
  }
  this.count.textContent=shown+' / '+this.bindings.size;this.empty.hidden=shown!==0;
 }
 select(from,to){for(const [id,row] of this.rows){const b=this.bindings.get(id),ranges=b.elements??[b];row.classList.toggle('active',ranges.some(r=>from<=r.end&&to>=r.start));}}
}
