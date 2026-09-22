import type {SimulationTier} from '../core/kernel.js';
import {assertCounter} from './contracts.js';
import {compareIds} from './locations.js';

export interface ScheduledLocation{readonly id:string;readonly tier:SimulationTier;readonly cost:number}
export interface WorkBudget{readonly maxJobs:number;readonly maxCost:number}
export interface WorkPlan{readonly selected:readonly ScheduledLocation[];readonly deferred:readonly ScheduledLocation[];readonly cost:number}
const DEFAULT_PERIOD:Readonly<Record<SimulationTier,number>>={detailed:1,active:6,aggregate:300,dormant:3600};
interface ScheduleMemory{due:number;tier:SimulationTier}
export class LocationScheduler{
  private memory=new Map<string,ScheduleMemory>();private lastTick=-1;
  constructor(readonly periods:Readonly<Record<SimulationTier,number>>=DEFAULT_PERIOD,readonly capacity=4096){
    if(!Number.isSafeInteger(capacity)||capacity<1)throw new RangeError('Invalid location scheduler capacity');
    for(const value of Object.values(periods))if(!Number.isSafeInteger(value)||value<1)throw new RangeError('Periods are positive integer tick counts');
  }
  plan(tick:number,candidates:readonly ScheduledLocation[],budget:WorkBudget):WorkPlan{
    assertCounter(tick,'tick');assertCounter(budget.maxJobs,'max jobs');
    if(tick<this.lastTick)throw new RangeError('Scheduler ticks cannot move backwards');
    if(!Number.isFinite(budget.maxCost)||budget.maxCost<0||candidates.length>this.capacity)throw new RangeError('Invalid location work budget');
    const unique=new Set<string>();for(const c of candidates){if(!c.id||unique.has(c.id)||!Number.isFinite(c.cost)||c.cost<=0)throw new TypeError('Locations need unique IDs and positive finite costs');unique.add(c.id);}
    this.lastTick=tick;const next=new Map<string,ScheduleMemory>(),due:ScheduledLocation[]=[];
    for(const c of candidates){const previous=this.memory.get(c.id),when=previous?Math.min(previous.due,tick+this.periods[c.tier]-1):tick;next.set(c.id,{due:when,tier:c.tier});if(when<=tick)due.push(c);}
    due.sort((a,b)=>next.get(a.id)!.due-next.get(b.id)!.due||compareIds(a.id,b.id));
    const selected:ScheduledLocation[]=[],deferred:ScheduledLocation[]=[];let cost=0;
    for(const c of due){if(selected.length<budget.maxJobs&&cost+c.cost<=budget.maxCost){selected.push(c);cost+=c.cost;next.set(c.id,{due:tick+this.periods[c.tier],tier:c.tier});}else deferred.push(c);}
    this.memory=next;return{selected,deferred,cost};
  }
  get tracked():number{return this.memory.size;}
}
