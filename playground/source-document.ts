/** The editor and inspector share one document and undo stack. Spans refer to a
 * specific source revision; stale edits are rejected rather than guessed. */
export interface Span {start:number;end:number;text:string}
export interface Binding {
 key:string;owner:string;factory:string;path:string;value:number|string|boolean;
 span:Span;writable:boolean;shared:number;call:{start:number;end:number};
}
export interface TextEdit extends Span {replacement:string}
interface Revision {text:string;anchor:number;focus:number}
export class SourceDocument {
 private past:Revision[]=[];private future:Revision[]=[];private group:string|undefined;
 text:string;version=0;anchor=0;focus=0;
 constructor(text:string){this.text=text;}
 private current():Revision{return {text:this.text,anchor:this.anchor,focus:this.focus};}
 get canUndo(){return this.past.length>0;}
 get canRedo(){return this.future.length>0;}
 replace(text:string,group?:string,selection:readonly[number,number]=[this.anchor,this.focus]):boolean {
  if(text===this.text){this.anchor=selection[0];this.focus=selection[1];return false;}
  if(text.length>65536)throw new RangeError('Максимум 64 КБ исходного кода');
  if(!group||group!==this.group){this.past.push(this.current());if(this.past.length>100)this.past.shift();}
  this.future=[];this.group=group;this.text=text;this.anchor=selection[0];this.focus=selection[1];this.version++;return true;
 }
 endGroup():void{this.group=undefined;}
 edit(edits:readonly TextEdit[],expectedVersion:number,group?:string):readonly TextEdit[]{
  if(expectedVersion!==this.version)throw new Error('Устаревшая привязка к коду');
  const sorted=[...edits].sort((a,b)=>a.start-b.start);
  for(let i=0;i<sorted.length;i++){
   const e=sorted[i]!;if(e.start<0||e.end<e.start||this.text.slice(e.start,e.end)!==e.text||i>0&&e.start<sorted[i-1]!.end)throw new Error('Диапазон кода изменился; дождитесь компиляции');
  }
  let next=this.text;for(const e of [...sorted].reverse())next=next.slice(0,e.start)+e.replacement+next.slice(e.end);
  this.replace(next,group);return sorted;
 }
 undo():boolean{const previous=this.past.pop();if(!previous)return false;this.future.push(this.current());Object.assign(this,previous);this.version++;this.endGroup();return true;}
 redo():boolean{const next=this.future.pop();if(!next)return false;this.past.push(this.current());Object.assign(this,next);this.version++;this.endGroup();return true;}
}
export function literal(value:Binding['value'],original:string):string {
 if(typeof value==='number'){if(!Number.isFinite(value))throw new TypeError('Нужно конечное число');return String(Number(value.toPrecision(12)));}
 if(typeof value==='boolean')return String(value);
 const json=JSON.stringify(value);return original.startsWith("'")?"'"+json.slice(1,-1).replace(/'/g,"\\'").replace(/\\"/g,'"')+"'":json;
}
/** Rebase every binding, including aliases sharing the edited initializer. */
export function rebase(bindings:readonly Binding[],edits:readonly TextEdit[]):Binding[]{
 const translate=(position:number,end=false)=>{
  let delta=0;for(const e of edits){if(position>=e.end)delta+=e.replacement.length-(e.end-e.start);else if(position>e.start)return e.start+delta+(end?e.replacement.length:0);}return position+delta;
 };
 return bindings.map(b=>{const matching=edits.find(e=>e.start===b.span.start&&e.end===b.span.end),overlap=edits.some(e=>e.start<b.span.end&&e.end>b.span.start);
  return {...b,span:{start:translate(b.span.start),end:translate(b.span.end,true),text:matching?.replacement??b.span.text},writable:b.writable&&(!overlap||!!matching),call:{start:translate(b.call.start),end:translate(b.call.end,true)}};
 });
}

export function validateBindings(input:unknown,source:string):Binding[]{
 if(!Array.isArray(input)||input.length>256)throw new TypeError('Invalid source map');
 for(const b of input){
  if(!b||typeof b.key!=='string'||typeof b.owner!=='string'||b.owner.length>180||typeof b.path!=='string'||b.path.length>256||typeof b.factory!=='string'||typeof b.writable!=='boolean')throw new TypeError('Invalid source binding');
  if(!['number','string','boolean'].includes(typeof b.value)||typeof b.value==='number'&&!Number.isFinite(b.value))throw new TypeError('Invalid bound value');
  if(!b.span||!Number.isInteger(b.span.start)||!Number.isInteger(b.span.end)||b.span.start<0||b.span.end<b.span.start||b.span.end>source.length||b.span.text!==source.slice(b.span.start,b.span.end))throw new TypeError('Invalid source span');
  if(!b.call||!Number.isInteger(b.call.start)||!Number.isInteger(b.call.end)||b.call.start<0||b.call.end<b.call.start||b.call.end>source.length)throw new TypeError('Invalid call site');
 }
 return input;
}
