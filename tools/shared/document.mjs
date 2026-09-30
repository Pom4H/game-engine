/** One bounded source history for keyboard, HUD, and camera edits. No mutable settings shadow. */
export class SourceDocument {
 constructor(source=''){this.source=source;this.revision=0;this.past=[];this.future=[];this.group=null;this.at=0;}
 set(source,{group=null,at=Date.now(),selection=null}={}){
  if(source===this.source)return false;
  if(!group||group!==this.group||at-this.at>900){this.past.push({source:this.source,selection});if(this.past.length>100)this.past.shift();}
  this.source=source;this.revision++;this.group=group;this.at=at;this.future=[];return true;
 }
 end(){this.group=null;}
 undo(selection=null){if(!this.past.length)return null;const old=this.past.pop();this.future.push({source:this.source,selection});this.source=old.source;this.revision++;this.end();return old;}
 redo(selection=null){if(!this.future.length)return null;const next=this.future.pop();this.past.push({source:this.source,selection});this.source=next.source;this.revision++;this.end();return next;}
}
/** Rebase syntax locations after a token edit. Unrelated comments/formatting are untouched. */
export function rebaseBindings(bindings,edits,source,changedId,value){
 const ordered=[...edits].sort((a,b)=>a.from-b.from);
 const changedValue=range=>{const edit=ordered.find(e=>e.from===range.start&&e.to===range.end);if(!edit)return range.value;return range.shape==='boolean'?edit.insert==='true':range.shape==='select'?edit.insert.slice(1,-1):Number(edit.insert);};
 const map=(position,bias)=>{let delta=0;for(const e of ordered){if(position<e.from)break;if(position>=e.to){delta+=e.insert.length-(e.to-e.from);}else return e.from+delta+(bias>0?e.insert.length:0);}return position+delta;};
 return bindings.map(b=>{const start=map(b.start,-1),end=map(b.end,1),copy={...b,start,end,raw:source.slice(start,end),value:changedValue(b),line:source.slice(0,start).split('\n').length};
  if(b.elements)copy.elements=b.elements.map(e=>{const start=map(e.start,-1),end=map(e.end,1);return {...e,start,end,raw:source.slice(start,end),value:changedValue(e)};});
  if(copy.elements)copy.value=copy.elements.map(e=>e.value);
  else if(b.id===changedId&&b.shape==='select')copy.value=value;return copy;
 });
}
