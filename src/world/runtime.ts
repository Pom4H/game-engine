import type {SimulationTier} from '../core/kernel.js';
import type {ColdCodec} from './residency.js';
import {CompactResidencyStore} from './residency.js';
import {InterestPlanner,type InterestConfig,type InterestDecision,type InterestSubject} from './interest.js';
import {LocationScheduler,type WorkBudget,type WorkPlan} from './scheduler.js';
import type {WorldPoint} from './contracts.js';

export interface WorldRuntimeSubject<State> extends InterestSubject{
  readonly state?:State;readonly cost?:number;
}
export interface WorldRuntimePlan{
  readonly interest:readonly InterestDecision[];readonly work:WorkPlan;
}
export class WorldRuntime<State>{
  readonly interest:InterestPlanner;readonly residency:CompactResidencyStore<State>;readonly scheduler:LocationScheduler;
  constructor(codec:ColdCodec<State>,options:{interest?:Partial<InterestConfig>;capacity?:number}={}){
    this.interest=new InterestPlanner(options.interest);this.residency=new CompactResidencyStore(codec,options.capacity??200_000);this.scheduler=new LocationScheduler();
  }
  upsert(id:string,state:State,tier:SimulationTier='detailed'):void{this.residency.setHot(id,state,tier);}
  plan(tick:number,subjects:readonly WorldRuntimeSubject<State>[],observers:readonly WorldPoint[],budget:WorkBudget):WorldRuntimePlan{
    for(const subject of subjects)if(subject.state!==undefined&&!this.residency.tier(subject.id))this.residency.setHot(subject.id,subject.state);
    const interest=this.interest.plan(tick,subjects,observers);
    const byId=new Map(subjects.map(subject=>[subject.id,subject] as const));
    for(const decision of interest){
      if(!this.residency.tier(decision.id))continue;
      if(decision.tier==='detailed'||decision.tier==='active')this.residency.materialize(decision.id,decision.tier);
      else this.residency.hibernate(decision.id,decision.tier);
    }
    const candidates=interest.map(decision=>({id:decision.id,tier:decision.tier,cost:byId.get(decision.id)?.cost??1}));
    return{interest,work:this.scheduler.plan(tick,candidates,budget)};
  }
}
