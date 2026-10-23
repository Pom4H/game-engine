import {compileTemporalMeshPlan,type TemporalMeshPlan,type TemporalMeshPlanInput,type TemporalWorkerAssignment} from './temporal.js';
import {MeshLeasePool,OrderedSegmentAssembler,type MeshTaskLease} from './coordinator.js';
import type {MeshAttemptDecision,MeshRenderSegmentResult} from './protocol.js';

export class TemporalRenderSession{
  readonly plan:TemporalMeshPlan;readonly leases:MeshLeasePool;readonly assembler:OrderedSegmentAssembler;
  constructor(input:TemporalMeshPlanInput){
    this.plan=compileTemporalMeshPlan(input);if(!this.plan.admitted)throw new Error('Temporal Meshwork plan misses capacity/deadline admission');
    this.leases=new MeshLeasePool(input.epoch.epoch);this.assembler=new OrderedSegmentAssembler(input.firstOutputFrame);
    for(const assignment of this.plan.assignments)this.leases.add(assignment.task,assignment.workerId);
  }
  claim(workerId:string,nowNs:bigint,leaseDurationNs:bigint):MeshTaskLease|undefined{return this.leases.claim(workerId,nowNs,leaseDurationNs);}
  accept(lease:MeshTaskLease,result:MeshRenderSegmentResult,nowNs:bigint):{readonly decision:MeshAttemptDecision;readonly ready:readonly MeshRenderSegmentResult[]}{
    const decision=this.leases.accept(lease,result,nowNs);if(decision==='accept')this.assembler.push(result);
    return Object.freeze({decision,ready:decision==='accept'?this.assembler.drainReady():Object.freeze([])});
  }
}
export function assignmentsByWorker(plan:TemporalMeshPlan):ReadonlyMap<string,TemporalWorkerAssignment>{return new Map(plan.assignments.map(assignment=>[assignment.workerId,assignment] as const));}
