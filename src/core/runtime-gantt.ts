import type {RuntimeCapability,RuntimeTimelineEntry,RuntimeTimelineScalar} from './runtime-timeline.js';
import type {RuntimeMemoryEntry} from './runtime-memory.js';

export interface RuntimeGanttRow{
  readonly id:number;
  readonly group:string;
  readonly owner:string;
  readonly kind:string;
  readonly label:string;
  readonly start:number;
  readonly end:number;
  readonly open:boolean;
  readonly cause?:number;
  readonly refs:readonly string[];
  readonly capabilities:readonly RuntimeCapability[];
  readonly data:Readonly<Record<string,RuntimeTimelineScalar>>;
}
export interface RuntimeGanttGroup{readonly id:string;readonly owner:string;readonly kind:string;readonly rows:readonly number[]}
export interface RuntimeGanttEdge{readonly from:number;readonly to:number;readonly kind:'cause'}
export interface RuntimeGanttProjection{
  readonly start:number;
  readonly end:number;
  readonly groups:readonly RuntimeGanttGroup[];
  readonly rows:readonly RuntimeGanttRow[];
  readonly edges:readonly RuntimeGanttEdge[];
}

/** Pure diagnostics projection. New runtime kinds appear automatically because
 * the task manager groups by declared owner/kind rather than a UI switch. */
export function projectRuntimeGantt(entries:readonly RuntimeTimelineEntry[],now?:number,memory:readonly RuntimeMemoryEntry[]=[]):RuntimeGanttProjection{
  if(now!==undefined&&(!Number.isFinite(now)||now<0))throw new RangeError('Gantt time must be finite and non-negative');
  if(!entries.length&&!memory.length)return Object.freeze({start:now??0,end:now??0,groups:Object.freeze([]),rows:Object.freeze([]),edges:Object.freeze([])});
  const maxRecorded=entries.length?Math.max(...entries.map(entry=>entry.end??entry.start)):0,current=now??maxRecorded;
  const timelineRows=entries.map(entry=>{
    const end=entry.end??Math.max(current,entry.start),group=`${entry.owner}/${entry.kind}`;
    return Object.freeze({
      id:entry.id,group,owner:entry.owner,kind:entry.kind,label:entry.name,start:entry.start,end,open:entry.end===null,
      ...(entry.cause!==undefined?{cause:entry.cause}:{}),refs:entry.refs,capabilities:entry.capabilities,data:entry.data,
    }) as RuntimeGanttRow;
  });
  const memoryRows=memory.map(entry=>Object.freeze({
    id:-entry.id,group:`${entry.owner}/memory:${entry.kind}`,owner:entry.owner,kind:`memory:${entry.kind}`,label:entry.name,
    start:0,end:current,open:true,refs:Object.freeze([]),capabilities:Object.freeze([]),
    data:Object.freeze({type:entry.type,items:entry.items,bytes:entry.bytes,...(entry.capacity!==undefined?{capacity:entry.capacity}:{})}),
  }) as RuntimeGanttRow);
  const rows=[...timelineRows,...memoryRows].sort((a,b)=>a.start-b.start||a.id-b.id);
  const rowIds=new Set(rows.map(row=>row.id)),byGroup=new Map<string,{owner:string;kind:string;rows:number[]}>();
  for(const row of rows){let group=byGroup.get(row.group);if(!group){group={owner:row.owner,kind:row.kind,rows:[]};byGroup.set(row.group,group);}group.rows.push(row.id);}
  const groups=[...byGroup].map(([id,value])=>Object.freeze({id,owner:value.owner,kind:value.kind,rows:Object.freeze(value.rows)}));
  const edges=rows.flatMap(row=>row.cause!==undefined&&rowIds.has(row.cause)?[Object.freeze({from:row.cause,to:row.id,kind:'cause' as const})]:[]);
  return Object.freeze({
    start:Math.min(...rows.map(row=>row.start)),
    end:Math.max(current,...rows.map(row=>row.end)),
    groups:Object.freeze(groups),rows:Object.freeze(rows),edges:Object.freeze(edges),
  });
}
