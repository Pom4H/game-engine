import type {Binding} from './source-document.js';
export interface InspectorHost {change(key:string,value:Binding['value'],group:string):void;end():void;select(binding:Binding):void}
const limits:Record<string,readonly[number,number,number,string?]>={
 resolutionScale:[.25,1.5,.05],maxPixelRatio:[1,2,.25],shadowExtent:[4,100,1,'м'],exposure:[.1,4,.01],sunIntensity:[0,5,.01],fogDensity:[0,.1,.001],fov:[15,100,1,'°'],roughness:[.02,1,.01],metalness:[0,1,.01],clearcoat:[0,1,.01],clearcoatRoughness:[.02,1,.01],
 throttle:[-1,1,.01],brake:[0,1,.01],steer:[-1,1,.01],flap:[-1,1,.01],pitch:[-1,1,.01],roll:[-1,1,.01],massKg:[100,4000,10,'кг'],mass:[0,1000,1,'кг'],radiusM:[.2,.6,.001,'м'],springNPerM:[5000,120000,500,'Н/м'],damperNsPerM:[0,10000,50],spanM:[.2,10,.05,'м'],chordM:[.1,4,.01,'м'],incidenceRad:[-.5,.5,.005,'рад'],wearEnergyJ:[30000,20000000,10000,'Дж'],speed:[0,6,.05,'м/с'],height:[.5,8,.05,'м'],upper:[.05,3,.01,'м'],lower:[.05,3,.01,'м'],swing:[0,2,.01,'м'],radius:[.2,8,.1,'м'],cell:[.25,10,.25],count:[1,256,1],wetness:[0,1,.01],snowM:[0,.5,.005,'м'],yieldStrain:[.001,.3,.001],stiffness:[10000,10000000,10000],
};
const labels:Record<string,string>={resolutionScale:'Масштаб рендера',maxPixelRatio:'Лимит Retina / DPR',shadowExtent:'Охват теней',exposure:'Экспозиция',sunIntensity:'Интенсивность солнца',sunDirection:'Солнце · направление',roughness:'Шероховатость',metalness:'Металличность',clearcoat:'Лак',clearcoatRoughness:'Шероховатость лака',throttle:'Газ',brake:'Тормоз',steer:'Руль',flap:'Отклонение крыльев',massKg:'Масса кузова',mass:'Масса',radiusM:'Радиус колеса',springNPerM:'Жёсткость подвески',damperNsPerM:'Демпфер',spanM:'Размах',chordM:'Хорда',incidenceRad:'Угол установки',wearEnergyJ:'Ресурс шины',position:'Положение',target:'Цель камеры',fov:'Поле зрения',color:'Цвет',skyColor:'Цвет неба',sunColor:'Цвет солнца',speed:'Скорость',height:'Высота',upper:'Верхнее звено',lower:'Нижнее звено',count:'Количество',radius:'Радиус запроса',cell:'Размер ячейки',damage:'Повреждения',wetness:'Влажность поверхности',snowM:'Снег',yieldStrain:'Порог пластичности',stiffness:'Модуль упругости'};
const choices:Record<string,string[]>={model:['m3','pickup'],kind:['default','glass','steel','wood','concrete','asphalt','snow','rubber','plastic','aluminum','mirror'],control:['flap','pitch','roll'],rate:['10','20','30','60']};
const el=<K extends keyof HTMLElementTagNameMap>(tag:K,text?:string)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;return e;};
export class Inspector {
 private bindings:Binding[]=[];private owner='';private key='';private rows=new Map<string,HTMLElement>();
 private readonly select=el('select');private readonly fields=el('div');private group=0;private gesture:string|undefined;private active:Element|null=null;
 constructor(readonly root:HTMLElement,private readonly host:InspectorHost){
  this.select.setAttribute('aria-label','Объект для редактирования');this.fields.className='fields';root.append(this.select,this.fields);
  this.select.onchange=()=>this.selectOwner(this.select.value,true);
  root.addEventListener('pointerdown',()=>{this.gesture=`hud:${++this.group}`;});
  window.addEventListener('pointerup',()=>{if(this.gesture){this.gesture=undefined;host.end();}});
  root.addEventListener('focusin',e=>{this.active=e.target as Element;});root.addEventListener('focusout',()=>{this.active=null;host.end();});
 }
 set(bindings:Binding[],enabled=true):void{
  this.bindings=bindings;const owners=[...new Set(bindings.map(b=>b.owner))];
  const values=[...this.select.options].map(o=>o.value);if(JSON.stringify(values)!==JSON.stringify(owners)){this.select.replaceChildren(...owners.map(owner=>{const option=el('option',owner);option.value=owner;return option;}));}
  if(!owners.includes(this.owner))this.owner=owners.find(o=>!['Сцена','Камера'].includes(o))??owners[0]??'';
  this.select.value=this.owner;this.draw();
  for(const input of this.fields.querySelectorAll<HTMLInputElement|HTMLSelectElement>('input,select'))input.disabled=!enabled||input.dataset.readonly==='true';
  this.root.dataset.stale=String(!enabled);
 }
 selectOwner(owner:string,focus=false):void{
  if(!this.bindings.some(b=>b.owner===owner))return;this.owner=owner;this.select.value=owner;this.key='';this.draw();
  const first=this.bindings.find(b=>b.owner===owner);if(focus&&first)this.host.select(first);
 }
 get selected(){return this.owner;}
 private emit(binding:Binding,value:Binding['value']):void{this.host.change(binding.key,value,this.gesture??`hud:${binding.key}`);}
 private draw():void{
  const bindings=this.bindings.filter(b=>b.owner===this.owner),key=bindings.map(b=>`${b.key}:${b.writable}:${typeof b.value}`).join('|');
  if(key!==this.key){this.key=key;this.rows.clear();this.fields.replaceChildren();
   for(const b of bindings){const row=el('div');row.className='field';row.dataset.binding=b.key;
    const label=el('button',this.title(b));label.className='field-label';label.type='button';label.title=`${b.path}${b.shared>1?` · общая запись для ${b.shared} применений`:''}`;label.onclick=()=>this.host.select(this.bindings.find(x=>x.key===b.key)!);row.append(label);
    if(!b.writable){row.append(el('code',String(b.value)),el('small','Вычисляется · перейти в код'));}
    else if(typeof b.value==='number'){
     const control=limits[b.path.split('.').at(-1)!];if(control){const range=el('input');range.type='range';range.min=String(Math.min(control[0],b.value));range.max=String(Math.max(control[1],b.value));range.step=String(control[2]);range.setAttribute('aria-label',this.title(b));range.dataset.key=b.key;range.oninput=()=>this.emit(this.get(b.key),Number(range.value));row.append(range);}
     const input=el('input');input.type='number';input.step=String(control?.[2]??(Number.isInteger(b.value)?1:.01));input.setAttribute('aria-label',`${this.title(b)} · число`);input.dataset.key=b.key;
     input.oninput=()=>{if(input.value!==''&&Number.isFinite(input.valueAsNumber))this.emit(this.get(b.key),input.valueAsNumber);};input.onchange=()=>this.host.end();row.append(input);
    }else if(typeof b.value==='boolean'){const input=el('input');input.type='checkbox';input.setAttribute('aria-label',this.title(b));input.dataset.key=b.key;input.onchange=()=>{this.emit(this.get(b.key),input.checked);this.host.end();};row.append(input);}
    else {const property=b.path.split('.').at(-1)!,options=b.factory==='body'&&b.path==='mesh.kind'?['box','sphere','cylinder','torus','plane']:choices[property];
     if(options){const select=el('select');select.setAttribute('aria-label',this.title(b));select.dataset.key=b.key;for(const value of new Set([...options,String(b.value)])){const o=el('option',value);o.value=value;select.append(o);}select.onchange=()=>{this.emit(this.get(b.key),select.value);this.host.end();};row.append(select);}
     else {const input=el('input');input.type='text';input.setAttribute('aria-label',this.title(b));input.dataset.key=b.key;input.onchange=()=>{this.emit(this.get(b.key),input.value);this.host.end();};row.append(input);}
    }
    if(b.shared>1)row.append(el('small',`↔ ${b.shared} применения`));this.fields.append(row);this.rows.set(b.key,row);
   }
   for(const prefix of new Set(bindings.filter(b=>/\[0\]$/.test(b.path)).map(b=>b.path.slice(0,-3)))){
    const components=[0,1,2,3].map(i=>bindings.find(b=>b.path===`${prefix}[${i}]`)).filter((b):b is Binding=>!!b);
    if(components.length<3||components.some(b=>typeof b.value!=='number'))continue;
    const group=el('div');group.className='vector';const heading=el('span',labels[prefix.split('.').at(-1)!]??prefix);heading.className='vector-label';group.append(heading);
    const first=this.rows.get(components[0]!.key)!;this.fields.insertBefore(group,first);
    for(let i=0;i<components.length;i++){const row=this.rows.get(components[i]!.key)!;row.classList.add('component');row.querySelector('button')!.textContent=(/color$/i.test(prefix)?['R','G','B','A']:['X','Y','Z','W'])[i]!;group.append(row);}
   }
   // A color edit patches separate numeric tokens, never rewrites an array/comment.
   for(const prefix of new Set(bindings.filter(b=>/color\[0\]$/i.test(b.path)).map(b=>b.path.slice(0,-3)))){
    const rgb=[0,1,2].map(i=>bindings.find(b=>b.path===`${prefix}[${i}]`));if(rgb.some(b=>!b?.writable||typeof b.value!=='number'))continue;
    const input=el('input');input.type='color';input.setAttribute('aria-label',`${prefix} · палитра`);input.dataset.color=prefix;
    input.oninput=()=>{const group=this.gesture??`color:${prefix}`;for(let i=0;i<3;i++)this.host.change(rgb[i]!.key,parseInt(input.value.slice(1+i*2,3+i*2),16)/255,group);};input.onchange=()=>this.host.end();const row=this.rows.get(rgb[0]!.key)!;(row.parentElement?.classList.contains('vector')?row.parentElement:row).append(input);
   }
  }
  for(const b of bindings)for(const input of this.rows.get(b.key)?.querySelectorAll<HTMLInputElement|HTMLSelectElement>('[data-key]')??[]){
   if(input===this.active&&input instanceof HTMLInputElement&&input.type!=='range')continue;
   if(input instanceof HTMLInputElement&&input.type==='checkbox')input.checked=Boolean(b.value);else input.value=String(b.value);
  }
  for(const input of this.fields.querySelectorAll<HTMLInputElement>('input[type=color]'))if(input!==this.active){const rgb=[0,1,2].map(i=>this.bindings.find(b=>b.owner===this.owner&&b.path===`${input.dataset.color}[${i}]`)?.value);input.value='#'+rgb.map(v=>Math.round(Math.max(0,Math.min(1,Number(v)))*255).toString(16).padStart(2,'0')).join('');}
 }
 private get(key:string):Binding{const b=this.bindings.find(b=>b.key===key);if(!b)throw new Error('Binding expired');return b;}
 private title(b:Binding):string{const path=b.path.split('.').at(-1)!,match=/^(\w+)\[(\d)\]$/.exec(path);return match?`${labels[match[1]!]??match[1]} · ${['X','Y','Z','A'][Number(match[2])]}`:labels[path]??path;}
}
