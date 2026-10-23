import type {SimulationTier} from '../core/depth.js';

function assertCounter(value:number,label:string){if(!Number.isSafeInteger(value)||value<0)throw new RangeError(`${label} must be a non-negative safe integer`);}
const compareIds=(a:string,b:string)=>a<b?-1:a>b?1:0;
export interface LocationWorkCandidate {
  readonly id: string;
  readonly tier: SimulationTier;
  /** Estimated work units, independent of noisy elapsed wall-clock time. */
  readonly cost: number;
}
export interface LocationWorkBudget { readonly maxJobs: number; readonly maxCost: number }
export interface LocationWorkPlan {
  readonly selected: readonly LocationWorkCandidate[];
  readonly deferred: readonly LocationWorkCandidate[];
  readonly cost: number;
}
interface ScheduleMemory { due: number; tier: SimulationTier }

/** Oldest due work first prevents an always-busy nearby location starving cold locations. */
export class LocationWorkScheduler {
  private memory = new Map<string, ScheduleMemory>();
  private lastTick = -1;
  constructor(readonly periods: Readonly<Record<SimulationTier, number>>, readonly capacity = 4096) {
    if (!Number.isSafeInteger(capacity) || capacity < 1) throw new RangeError('Invalid location scheduler capacity');
    for (const value of Object.values(periods)) if (!Number.isSafeInteger(value) || value < 1) throw new RangeError('Periods are positive integer tick counts');
  }
  plan(tick: number, candidates: readonly LocationWorkCandidate[], budget: LocationWorkBudget): LocationWorkPlan {
    assertCounter(tick, 'tick'); assertCounter(budget.maxJobs, 'max jobs');
    if (tick < this.lastTick) throw new RangeError('Scheduler ticks cannot move backwards');
    if (!Number.isFinite(budget.maxCost) || budget.maxCost < 0 || candidates.length > this.capacity) throw new RangeError('Invalid location work budget');
    const unique = new Set<string>();
    for (const candidate of candidates) {
      if (!candidate.id || unique.has(candidate.id) || !Number.isFinite(candidate.cost) || candidate.cost <= 0) throw new TypeError('Locations need unique IDs and positive finite costs');
      unique.add(candidate.id);
    }
    this.lastTick = tick;
    const next = new Map<string, ScheduleMemory>(), due: LocationWorkCandidate[] = [];
    for (const candidate of candidates) {
      const previous = this.memory.get(candidate.id);
      // Promotion may bring a cold due date forward, never postpone already deferred work.
      const when = previous ? Math.min(previous.due, tick + this.periods[candidate.tier] - 1) : tick;
      next.set(candidate.id, {due: when, tier: candidate.tier});
      if (when <= tick) due.push(candidate);
    }
    due.sort((a, b) => next.get(a.id)!.due - next.get(b.id)!.due || compareIds(a.id, b.id));
    const selected: LocationWorkCandidate[] = [], deferred: LocationWorkCandidate[] = [];
    let cost = 0;
    for (const candidate of due) {
      if (selected.length < budget.maxJobs && cost + candidate.cost <= budget.maxCost) {
        selected.push(candidate); cost += candidate.cost;
        next.set(candidate.id, {due: tick + this.periods[candidate.tier], tier: candidate.tier});
      } else deferred.push(candidate);
    }
    this.memory = next;
    return {selected, deferred, cost};
  }
  get tracked(): number { return this.memory.size; }
}
