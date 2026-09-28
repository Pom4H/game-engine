import {trackRuntimeMemory} from './runtime-memory.js';

export interface RuntimeCapability {readonly id:string;readonly label:string}
export type RuntimeTimelineScalar=string|number|boolean|null;
export interface RuntimeTimelineEntry{
  readonly id:number;
  readonly owner:string;
  readonly kind:string;
  readonly name:string;
  readonly start:number;
  readonly end:number|null;
  readonly cause?:number;
  readonly refs:readonly string[];
  readonly capabilities:readonly RuntimeCapability[];
  readonly data:Readonly<Record<string,RuntimeTimelineScalar>>;
}
export interface RuntimeTimelineInput{
  readonly owner:string;readonly kind:string;readonly name:string;readonly at:number;
  readonly cause?:number;readonly refs?:readonly string[];readonly capabilities?:readonly RuntimeCapability[];
  readonly data?:Readonly<Record<string,RuntimeTimelineScalar>>;readonly payload?:unknown;
}
interface TimelineRecord{entry:RuntimeTimelineEntry;payload?:unknown}
const CAPACITY=4096;
const records=trackRuntimeMemory('RuntimeTimeline','records','history',new Map<number,TimelineRecord>(),CAPACITY);
const order=trackRuntimeMemory('RuntimeTimeline','order','history',[] as number[],CAPACITY);
let sequence=0;

function validate(input:RuntimeTimelineInput):void{
  if(!input.owner||!input.kind||!input.name)throw new TypeError('Runtime timeline requires owner, kind and name');
  if(!Number.isFinite(input.at)||input.at<0)throw new RangeError('Runtime timeline time must be finite and non-negative');
  if(input.refs?.some(ref=>!ref))throw new TypeError('Runtime timeline refs require stable IDs');
  if(input.capabilities?.some(capability=>!capability.id||!capability.label))throw new TypeError('Runtime capabilities require id and label');
}
function trim():void{
  while(order.length>CAPACITY){
    const index=order.findIndex(id=>records.get(id)?.entry.end!==null),at=index>=0?index:0,id=order[at]!;
    order.splice(at,1);records.delete(id);
  }
}
function create(input:RuntimeTimelineInput,end:number|null):number{
  validate(input);const id=++sequence;
  const entry:Object=Object.freeze({
    id,owner:input.owner,kind:input.kind,name:input.name,start:input.at,end,
    ...(input.cause!==undefined?{cause:input.cause}:{}),
    refs:Object.freeze([...(input.refs??[])]),
    capabilities:Object.freeze((input.capabilities??[]).map(capability=>Object.freeze({...capability}))),
    data:Object.freeze({...input.data}),
  });
  records.set(id,{entry:entry as RuntimeTimelineEntry,...(input.payload!==undefined?{payload:input.payload}:{})});order.push(id);trim();return id;
}
export function beginRuntimeSpan(input:RuntimeTimelineInput):number{return create(input,null);}
export function recordRuntimeEvent(input:RuntimeTimelineInput):number{return create(input,input.at);}
export function endRuntimeSpan(id:number,at:number):void{
  const record=records.get(id);if(!record)return;
  if(!Number.isFinite(at)||at<record.entry.start)throw new RangeError('Runtime span end precedes start');
  record.entry=Object.freeze({...record.entry,end:at});
}
export function runtimeTimelineSnapshot():readonly RuntimeTimelineEntry[]{
  return Object.freeze(order.map(id=>records.get(id)?.entry).filter((entry):entry is RuntimeTimelineEntry=>!!entry));
}
export function runtimeTimelineEntry(id:number):RuntimeTimelineEntry|undefined{return records.get(id)?.entry;}
export function runtimeTimelinePayload<T=unknown>(id:number):T|undefined{return records.get(id)?.payload as T|undefined;}
