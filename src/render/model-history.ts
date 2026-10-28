import type {Mat4} from '../math.js';

interface Entry {model:Mat4;frame:number;source:object|undefined}
export interface ModelHistorySnapshot {entries:number;frame:number;allocations:number;commits:number;modelChanges:number}

/** Render observation history, not world state. Each record is reused while its
 * source lives. A skipped observation expires logically without clearing the
 * table; returning objects start with their current pose rather than a stale
 * velocity. Matrices come from Render IR and remain immutable snapshots. */
export class RenderModelHistory {
 private readonly entries=new Map<string,Entry>();
 private frame=0;private allocations=0;private commits=0;private modelChanges=0;
 get size():number{return this.entries.size;}
 beginFrame():void{this.frame++;}
 get(id:string,source?:object):Mat4|undefined{
  const entry=this.entries.get(id);
  return entry&&entry.frame===this.frame-1&&(!source||!entry.source||entry.source===source)?entry.model:undefined;
 }
 set(id:string,model:Mat4,source?:object):this{
  const entry=this.entries.get(id);
  if(entry){
   if(entry.model!==model){entry.model=model;this.modelChanges++;}
   entry.frame=this.frame;entry.source=source;
  }else{this.entries.set(id,{model,frame:this.frame,source});this.allocations++;}
  this.commits++;return this;
 }
 retain(live:ReadonlyMap<string,object>):void{
  for(const [id,entry] of this.entries)if(!live.has(id)||(entry.source&&entry.source!==live.get(id)))this.entries.delete(id);
 }
 clear():void{this.entries.clear();this.frame=0;}
 inspect():ModelHistorySnapshot{return{entries:this.entries.size,frame:this.frame,allocations:this.allocations,commits:this.commits,modelChanges:this.modelChanges};}
}
