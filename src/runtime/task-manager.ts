import {trackRuntimeInstance,type RuntimeMemoryEntry} from '../core/runtime-memory.js';
import type {RuntimeGanttProjection,RuntimeGanttRow} from '../core/runtime-gantt.js';

export interface RuntimeTaskManagerSource{
  snapshot():{readonly memory:readonly RuntimeMemoryEntry[];readonly gantt:RuntimeGanttProjection};
  act(recordId:number,capability:string):Promise<unknown>;
}

export class RuntimeTaskManager{
  private host:HTMLElement|null=null;
  private timer:ReturnType<typeof setInterval>|undefined;
  private opened=false;
  private selected:number|null=null;
  private readonly onKey=(event:KeyboardEvent)=>{
    if(event.code!=='Backquote'||event.metaKey||event.ctrlKey||event.altKey)return;
    event.preventDefault();this.toggle();
  };
  constructor(private readonly source:RuntimeTaskManagerSource){
    trackRuntimeInstance('RuntimeTaskManager',this);
    addEventListener('keydown',this.onKey,true);
  }
  toggle(force=!this.opened):void{
    if(force===this.opened)return;this.opened=force;
    if(force){this.ensure();this.host!.hidden=false;this.refresh();this.timer=setInterval(()=>this.refresh(),250);}
    else{if(this.host)this.host.hidden=true;if(this.timer!==undefined){clearInterval(this.timer);this.timer=undefined;}}
  }
  inspect(){return{open:this.opened,selected:this.selected};}
  dispose():void{
    removeEventListener('keydown',this.onKey,true);
    if(this.timer!==undefined)clearInterval(this.timer);
    this.host?.remove();this.host=null;this.timer=undefined;this.opened=false;
  }
  private ensure():void{
    if(this.host)return;
    const host=document.createElement('div');host.id='game-engine-task-manager';host.hidden=true;
    const root=host.attachShadow({mode:'open'});
    const style=document.createElement('style');
    style.textContent=':host{all:initial}*{box-sizing:border-box}.panel{position:fixed;inset:4vh 3vw;z-index:2147483647;background:#111214;color:#e8e8e8;border:1px solid #34363a;border-radius:10px;box-shadow:0 20px 80px #000a;font:12px/1.35 ui-monospace,SFMono-Regular,Menlo,monospace;display:grid;grid-template-rows:auto 1fr;overflow:hidden}header{height:42px;display:flex;align-items:center;gap:12px;padding:0 14px;border-bottom:1px solid #292b2e;background:#17181b}header b{font-size:14px}header span{color:#8f949b}header button{margin-left:auto}button{font:inherit;color:inherit;background:#25272b;border:1px solid #3a3d42;border-radius:5px;padding:4px 8px;cursor:pointer}button:hover{background:#30333a}.body{min-height:0;display:grid;grid-template-columns:minmax(260px,30%) 1fr}.memory{overflow:auto;border-right:1px solid #292b2e;padding:10px}.timeline{overflow:auto;padding:10px}h3{margin:10px 0 6px;font-size:11px;color:#9ba1aa;text-transform:uppercase;letter-spacing:.08em}.mem{display:grid;grid-template-columns:1fr auto;gap:4px 8px;padding:5px 6px;border-bottom:1px solid #202226}.mem small{color:#858b94}.num{font-variant-numeric:tabular-nums;color:#bbc0c8}.axis{position:sticky;top:-10px;z-index:2;background:#111214ef;padding:6px 0 8px;color:#858b94}.group{margin:8px 0 14px}.group-title{position:sticky;left:0;margin-bottom:4px;color:#9ba1aa}.row{display:grid;grid-template-columns:minmax(170px,24%) 1fr minmax(150px,auto);align-items:center;min-height:30px;border-top:1px solid #1f2124}.row.selected{background:#1d2025}.label{padding:5px 8px 5px 4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.label small{display:block;color:#777e87}.track{position:relative;height:18px;background:#181a1d;border-radius:3px;overflow:visible}.bar{position:absolute;top:4px;height:10px;min-width:3px;border-radius:3px;background:#787f8c}.bar.open{outline:1px solid #b8bec8}.bar.event{width:5px!important}.cause{color:#858b94;cursor:pointer}.actions{display:flex;gap:4px;justify-content:flex-end;padding-left:6px}.actions button{padding:2px 5px}.empty{color:#666b72;padding:10px 0}';
    const panel=document.createElement('div');panel.className='panel';
    const header=document.createElement('header'),title=document.createElement('b'),meta=document.createElement('span'),close=document.createElement('button');
    title.textContent='ё runtime';meta.dataset.role='meta';close.textContent='×';close.onclick=()=>this.toggle(false);header.append(title,meta,close);
    const body=document.createElement('div');body.className='body';
    const memory=document.createElement('section');memory.className='memory';memory.dataset.role='memory';
    const timeline=document.createElement('section');timeline.className='timeline';timeline.dataset.role='timeline';
    body.append(memory,timeline);panel.append(header,body);root.append(style,panel);document.body.append(host);this.host=host;
  }
  private refresh():void{
    if(!this.host||!this.opened)return;
    const root=this.host.shadowRoot!,memory=root.querySelector<HTMLElement>('[data-role=memory]')!,timeline=root.querySelector<HTMLElement>('[data-role=timeline]')!,meta=root.querySelector<HTMLElement>('[data-role=meta]')!;
    const snapshot=this.source.snapshot(),gantt=snapshot.gantt;
    meta.textContent=snapshot.memory.length+' memory · '+gantt.rows.length+' timeline · '+formatTime(gantt.end);
    memory.replaceChildren();const mh=document.createElement('h3');mh.textContent='Memory';memory.append(mh);
    if(!snapshot.memory.length){const empty=document.createElement('div');empty.className='empty';empty.textContent='No tracked runtime structures';memory.append(empty);}
    for(const entry of snapshot.memory){
      const row=document.createElement('div');row.className='mem';const name=document.createElement('div'),value=document.createElement('div');value.className='num';
      const primary=document.createElement('div');primary.textContent=entry.owner+' / '+entry.name;const detail=document.createElement('small');detail.textContent=entry.kind+' · '+entry.type;name.append(primary,detail);
      value.textContent=entry.bytes!==null?formatBytes(entry.bytes):entry.items!==null?entry.items+' items':'—';row.append(name,value);memory.append(row);
    }
    timeline.replaceChildren();const axis=document.createElement('div');axis.className='axis';axis.textContent='Gantt  '+formatTime(gantt.start)+' → '+formatTime(gantt.end);timeline.append(axis);
    const byId=new Map(gantt.rows.map(row=>[row.id,row] as const)),span=Math.max(.000001,gantt.end-gantt.start);
    for(const group of gantt.groups){
      const section=document.createElement('div');section.className='group';const heading=document.createElement('div');heading.className='group-title';heading.textContent=group.id;section.append(heading);
      for(const id of group.rows){const row=byId.get(id);if(row)section.append(this.makeRow(row,byId,gantt,span));}
      timeline.append(section);
    }
  }
  private makeRow(row:RuntimeGanttRow,byId:ReadonlyMap<number,RuntimeGanttRow>,gantt:RuntimeGanttProjection,span:number):HTMLElement{
    const element=document.createElement('div');element.className='row'+(this.selected===row.id?' selected':'');element.onclick=()=>{this.selected=row.id;this.refresh();};
    const label=document.createElement('div');label.className='label';const name=document.createElement('div');name.textContent=row.label;const detail=document.createElement('small');
    detail.textContent='#'+row.id+' · '+formatTime(row.start)+(row.open?' → now':row.end===row.start?'':' → '+formatTime(row.end));label.append(name,detail);
    if(row.cause!==undefined){const cause=document.createElement('div');cause.className='cause';const parent=byId.get(row.cause);cause.textContent='← '+(parent?.label??'#'+row.cause);cause.onclick=event=>{event.stopPropagation();this.selected=row.cause!;this.refresh();};label.append(cause);}
    const track=document.createElement('div');track.className='track';const bar=document.createElement('div');bar.className='bar'+(row.open?' open':'')+(row.start===row.end?' event':'');
    bar.style.left=((row.start-gantt.start)/span*100)+'%';bar.style.width=Math.max(row.start===row.end ? .4 : (row.end-row.start)/span*100,.25)+'%';bar.title=JSON.stringify(row.data);track.append(bar);
    const actions=document.createElement('div');actions.className='actions';
    for(const capability of row.capabilities){const button=document.createElement('button');button.textContent=capability.label;button.onclick=event=>{event.stopPropagation();void this.source.act(row.id,capability.id).then(()=>this.refresh()).catch(error=>console.error('Runtime action failed',error));};actions.append(button);}
    element.append(label,track,actions);return element;
  }
}
function formatTime(value:number):string{return value<10?value.toFixed(3)+'s':value.toFixed(1)+'s';}
function formatBytes(value:number):string{return value<1024?value+' B':value<1024**2?(value/1024).toFixed(1)+' KiB':(value/1024**2).toFixed(1)+' MiB';}
