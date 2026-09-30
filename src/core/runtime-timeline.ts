/** Scoped causal records, using the capability/refs shape from the causal-runtime
 * branch. No process-global registry and no unbounded collection of open spans. */
export interface RuntimeCapability {readonly id:string;readonly label:string}
export type RuntimeTimelineScalar=string|number|boolean|null;
export interface RuntimeTimelineEntry {
 readonly id:number;readonly owner:string;readonly kind:string;readonly name:string;
 /** Milliseconds in the recorder's clock domain; never a simulation timestamp. */
 readonly start:number;readonly end:number|null;readonly cause?:number;
 readonly refs:readonly string[];readonly capabilities:readonly RuntimeCapability[];
 readonly data:Readonly<Record<string,RuntimeTimelineScalar>>;readonly failed?:boolean;
}
export interface RuntimeTimelineInput {
 readonly owner:string;readonly kind:string;readonly name:string;readonly at:number;
 readonly cause?:number;readonly refs?:readonly string[];readonly capabilities?:readonly RuntimeCapability[];
 readonly data?:Readonly<Record<string,RuntimeTimelineScalar>>;
}
/** A hard-bounded recording, not a solver checkpoint or a heap size estimator.
 * Eviction may remove a parent/open span; consumers must retain orphan cause IDs. */
export class RuntimeTimeline {
 readonly enabled:boolean;readonly capacity:number;
 private readonly entries: (RuntimeTimelineEntry|undefined)[];
 private sequence=0;private count=0;private dropped=0;
 constructor(options:{enabled?:boolean;capacity?:number}={}) {
  this.enabled=options.enabled??false;this.capacity=options.capacity??1024;
  if(!Number.isSafeInteger(this.capacity)||this.capacity<1||this.capacity>65536)throw new RangeError('Invalid trace capacity');
  this.entries=this.enabled?new Array(this.capacity):[];
 }
 private append(input:RuntimeTimelineInput,end:number|null):number {
  if(!this.enabled)return 0;
  if(!input.owner||!input.kind||!input.name||[input.owner,input.kind,input.name].some(s=>s.length>256)||!Number.isFinite(input.at)||input.at<0)throw new TypeError('Invalid trace record');
  if(input.cause!==undefined&&(!Number.isSafeInteger(input.cause)||input.cause<1||input.cause>this.sequence))throw new TypeError('Trace cause must precede its child');
  if((input.refs?.length??0)>32||(input.capabilities?.length??0)>16||Object.keys(input.data??{}).length>32)throw new RangeError('Trace metadata budget');
  if(input.refs?.some(r=>typeof r!=='string'||r.length>256)||input.capabilities?.some(c=>!c.id||!c.label||c.id.length>128||c.label.length>256))throw new TypeError('Invalid trace refs or capabilities');
  for(const value of Object.values(input.data??{}))if(value!==null&&typeof value!=='boolean'&&!(typeof value==='number'&&Number.isFinite(value))&&!(typeof value==='string'&&value.length<=512))throw new TypeError('Trace data requires bounded scalars');
  const id=++this.sequence,index=(id-1)%this.capacity;if(this.count===this.capacity)this.dropped++;else this.count++;
  this.entries[index]=Object.freeze({id,owner:input.owner,kind:input.kind,name:input.name,start:input.at,end,...(input.cause?{cause:input.cause}:{}),refs:Object.freeze([...(input.refs??[])]),capabilities:Object.freeze((input.capabilities??[]).map(c=>Object.freeze({...c}))),data:Object.freeze({...input.data})});
  return id;
 }
 begin(input:RuntimeTimelineInput):number{return this.append(input,null);}
 event(input:RuntimeTimelineInput):number{return this.append(input,input.at);}
 end(id:number,at:number,failed=false):void {
  if(!this.enabled||!id)return;
  const index=(id-1)%this.capacity,entry=this.entries[index];if(!entry||entry.id!==id)return;
  if(!Number.isFinite(at)||at<entry.start)throw new RangeError('Trace end precedes start');
  this.entries[index]=Object.freeze({...entry,end:at,...(failed?{failed:true}:{})});
 }
 snapshot():readonly RuntimeTimelineEntry[]{
  const out:RuntimeTimelineEntry[]=[];
  for(let id=this.sequence-this.count+1;id<=this.sequence;id++){const entry=this.entries[(id-1)%this.capacity];if(entry?.id===id)out.push(entry);}
  return Object.freeze(out);
 }
 get diagnostics(){return {enabled:this.enabled,capacity:this.capacity,records:this.count,dropped:this.dropped};}
 clear():void {this.entries.fill(undefined);this.count=0;this.dropped=0;/* IDs never repeat in this clock domain. */}
}
