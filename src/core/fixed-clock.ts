/** Monotonic fixed-step clock. Timer delays accumulate as bounded simulation debt. */
export class FixedClock {
  private previous: number | null = null;
  private debt = 0;
  droppedMs = 0;
  constructor(readonly stepMs = 1000 / 60, readonly maxDebtMs = 250, readonly maxSteps = 6) {
    if (!(stepMs > 0) || !(maxDebtMs >= stepMs) || !Number.isSafeInteger(maxSteps) || maxSteps < 1) throw new RangeError('Invalid fixed clock configuration');
  }
  reset(now: number): void { if (!Number.isFinite(now)) throw new RangeError('Clock time must be finite'); this.previous = now; this.debt = 0; }
  /** A read-only, non-reentrant predicate may yield between completed steps. */
  advance(now: number, step: () => void, continueCatchUp?: () => boolean): number {
    if (this.previous === null) { this.reset(now); return 0; }
    const elapsed = Math.max(0, now - this.previous); this.previous = now; const total = this.debt + elapsed;
    this.droppedMs += Math.max(0, total - this.maxDebtMs); this.debt = Math.min(this.maxDebtMs, total);
    let count = 0; while (this.debt + 1e-6 >= this.stepMs && count < this.maxSteps) { if (count > 0 && continueCatchUp && !continueCatchUp()) break; this.debt -= this.stepMs; step(); count++; }
    return count;
  }
  get backlogMs(): number { return Math.max(0, this.debt); }
  get delay(): number { return Math.max(0, this.stepMs - this.debt); }
}
