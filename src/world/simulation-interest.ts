import {SIMULATION_TIERS,type SimulationTier} from '../core/depth.js';

export interface SimulationPoint{readonly x:number;readonly z:number}
function assertCounter(value:number,label:string){if(!Number.isSafeInteger(value)||value<0)throw new RangeError(`${label} must be a non-negative safe integer`);}
const compareIds=(a:string,b:string)=>a<b?-1:a>b?1:0;

export interface SimulationInterestSubject extends SimulationPoint {
  readonly id: string;
  /** Conservative radius of a physical object or an entire location. */
  readonly radius?: number;
  /** Contacts, boarding, injuries and explicit interactions must not lose fidelity. */
  readonly critical?: boolean;
}
export interface SimulationInterestDecision {
  readonly id: string;
  readonly tier: SimulationTier;
  readonly previousTier: SimulationTier;
  readonly distance: number;
  readonly changed: boolean;
}
export interface SimulationInterestConfig {
  readonly detailedRadius: number;
  readonly activeRadius: number;
  readonly aggregateRadius: number;
  readonly hysteresis: number;
  readonly downgradeTicks: number;
  readonly maxSubjects: number;
  readonly maxObservers: number;
}
interface InterestMemory { tier: SimulationTier; downgradeAt: number | null }

/** O(subjects × observers), bounded explicitly; no filled rectangle between distant players. */
export class SimulationInterestPlanner {
  readonly config: SimulationInterestConfig;
  private memory = new Map<string, InterestMemory>();
  private lastTick = -1;
  constructor(config: SimulationInterestConfig) {
    this.config = {...config};
    const c = this.config;
    if (![c.detailedRadius, c.activeRadius, c.aggregateRadius, c.hysteresis].every(v => Number.isFinite(v) && v >= 0)
      || c.detailedRadius > c.activeRadius || c.activeRadius > c.aggregateRadius) throw new RangeError('Interest radii must be finite and ordered');
    for (const [name, value] of Object.entries({downgradeTicks: c.downgradeTicks, maxSubjects: c.maxSubjects, maxObservers: c.maxObservers})) assertCounter(value, name);
    if (!c.maxSubjects || !c.maxObservers) throw new RangeError('Interest budgets must be positive');
  }
  plan(tick: number, subjects: readonly SimulationInterestSubject[], observers: readonly SimulationPoint[]): SimulationInterestDecision[] {
    assertCounter(tick, 'tick');
    if (tick < this.lastTick) throw new RangeError('Interest ticks cannot move backwards');
    if (subjects.length > this.config.maxSubjects || observers.length > this.config.maxObservers) throw new RangeError('Interest budget exceeded');
    const ids = new Set<string>();
    for (const subject of subjects) {
      if (!subject.id || ids.has(subject.id)) throw new TypeError('Interest subjects require unique identities');
      ids.add(subject.id);
      if (![subject.x, subject.z, subject.radius ?? 0].every(Number.isFinite) || (subject.radius ?? 0) < 0) throw new RangeError('Invalid interest subject');
    }
    for (const observer of observers) if (![observer.x, observer.z].every(Number.isFinite)) throw new RangeError('Invalid observer');
    this.lastTick = tick;
    const next = new Map<string, InterestMemory>();
    const decisions = subjects.map(subject => {
      let distance = Infinity;
      for (const observer of observers) distance = Math.min(distance, Math.max(0, Math.hypot(observer.x - subject.x, observer.z - subject.z) - (subject.radius ?? 0)));
      const old = this.memory.get(subject.id), previousTier = old?.tier ?? 'dormant';
      const desired = subject.critical ? 'detailed' : this.tierAt(distance);
      let tier = previousTier, downgradeAt = old?.downgradeAt ?? null;
      if (!old || this.rank(desired) <= this.rank(previousTier)) { tier = desired; downgradeAt = null; }
      else {
        const exitRadius = this.radiusFor(previousTier) + this.config.hysteresis;
        if (distance > exitRadius) {
          downgradeAt ??= tick;
          if (tick - downgradeAt >= this.config.downgradeTicks) { tier = desired; downgradeAt = null; }
        } else downgradeAt = null;
      }
      next.set(subject.id, {tier, downgradeAt});
      return {id: subject.id, tier, previousTier, distance, changed: tier !== previousTier};
    });
    this.memory = next; // Removed actors cannot accumulate unbounded history.
    return decisions.sort((a, b) => compareIds(a.id, b.id));
  }
  private rank(tier: SimulationTier): number { return SIMULATION_TIERS.indexOf(tier); }
  private radiusFor(tier: SimulationTier): number {
    return tier === 'detailed' ? this.config.detailedRadius : tier === 'active' ? this.config.activeRadius : tier === 'aggregate' ? this.config.aggregateRadius : Infinity;
  }
  private tierAt(distance: number): SimulationTier {
    return distance <= this.config.detailedRadius ? 'detailed' : distance <= this.config.activeRadius ? 'active' : distance <= this.config.aggregateRadius ? 'aggregate' : 'dormant';
  }
  forget(id: string): void { this.memory.delete(id); }
  get tracked(): number { return this.memory.size; }
}
