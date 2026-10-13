/** Experimental affine-tank dialect. Not a CFD model or a replacement for World Interaction IR. */
import {EngineKernel, type EngineModule, type KernelProgram} from '../core/kernel.js';

export const TANK_CONTRACT_SCHEMA = 'world-contract/tank-affine@1' as const;
const SCALE = 1_000_000n; // microlitres -> picolitres; seconds -> microseconds
const LIMIT = 1_000_000_000_000_000n;
export interface TankContract {
  readonly schema: typeof TANK_CONTRACT_SCHEMA;
  readonly id: string;
  readonly capacityUl: string;
  readonly observation: Readonly<{volumeUl: string; errorUl: string; atUs: string; source: string}>;
  readonly assumptions: Readonly<{law: 'constant-inflow-no-outflow'; flowUlPerSecond: string; startDelayUs: string}>;
  readonly goal: Readonly<{kind: 'reach'; volumeUl: string; withinUs: string}>;
}
function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Expected an object');
  const result = value as Record<string, unknown>;
  if (Object.keys(result).length !== keys.length || keys.some(key => !Object.hasOwn(result, key)))
    throw new TypeError('Missing or unknown contract field');
  return result;
}
function integer(value: unknown): string {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,15})$/.test(value) || BigInt(value) > LIMIT)
    throw new TypeError('Expected bounded canonical unsigned integer string');
  return value;
}
function identity(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z_][A-Za-z_0-9-]{0,79}$/.test(value))
    throw new TypeError('Invalid stable identity');
  return value;
}
/** Independent validation boundary for compiler output and LLM-authored JSON. */
export function decodeTankContract(value: unknown): TankContract {
  const root = record(value, ['schema', 'id', 'capacityUl', 'observation', 'assumptions', 'goal']);
  const o = record(root.observation, ['volumeUl', 'errorUl', 'atUs', 'source']);
  const a = record(root.assumptions, ['law', 'flowUlPerSecond', 'startDelayUs']);
  const g = record(root.goal, ['kind', 'volumeUl', 'withinUs']);
  if (root.schema !== TANK_CONTRACT_SCHEMA || a.law !== 'constant-inflow-no-outflow' || g.kind !== 'reach')
    throw new TypeError('Unsupported schema, law or temporal operator');
  const model: TankContract = Object.freeze({
    schema: TANK_CONTRACT_SCHEMA, id: identity(root.id), capacityUl: integer(root.capacityUl),
    observation: Object.freeze({volumeUl: integer(o.volumeUl), errorUl: integer(o.errorUl), atUs: integer(o.atUs), source: identity(o.source)}),
    assumptions: Object.freeze({law: a.law, flowUlPerSecond: integer(a.flowUlPerSecond), startDelayUs: integer(a.startDelayUs)}),
    goal: Object.freeze({kind: g.kind, volumeUl: integer(g.volumeUl), withinUs: integer(g.withinUs)}),
  });
  const capacity = BigInt(model.capacityUl), volume = BigInt(model.observation.volumeUl), error = BigInt(model.observation.errorUl);
  if (capacity === 0n || error > volume || volume + error > capacity || BigInt(model.goal.volumeUl) > capacity ||
      BigInt(model.assumptions.flowUlPerSecond) === 0n || BigInt(model.goal.withinUs) === 0n)
    throw new RangeError('Inconsistent tank bounds, flow or deadline');
  return model;
}
const ceilDiv = (a: bigint, b: bigint): bigint => (a + b - 1n) / b;
/** Conditional authoring result, NOT a command or a claim about measured equipment.
 * Request occurs at observation.atUs; declared actuator delay and constant flow hold. */
export function earliestGuaranteedReachUs(input: TankContract): bigint {
  const c = decodeTankContract(input);
  const missing = BigInt(c.goal.volumeUl) - (BigInt(c.observation.volumeUl) - BigInt(c.observation.errorUl));
  return BigInt(c.observation.atUs) + (missing <= 0n ? 0n :
    BigInt(c.assumptions.startDelayUs) + ceilDiv(missing * SCALE, BigInt(c.assumptions.flowUlPerSecond)));
}
export type TankEventKind = 'start-requested' | 'started' | 'stopped' | 'failed' | 'goal-reached';
export interface TankEvent {readonly kind: TankEventKind; readonly atUs: bigint; readonly sequence: number}
export interface TankState {
  readonly timeUs: bigint;
  readonly volumePl: bigint;
  readonly flowUlPerSecond: bigint;
  readonly pendingStartUs: bigint | null;
  readonly running: boolean;
  readonly failed: boolean;
  readonly reachedAtUs: bigint | null;
  /** External changes invalidate contracts; ordinary evolution does not. */
  readonly revision: number;
}
export type TankBackend = 'stepped' | 'event-driven';
interface Frame {readonly state: TankState; readonly untilUs: bigint; readonly capacityPl: bigint; readonly targetPl: bigint}
interface Transition {readonly state: TankState; readonly events: readonly Omit<TankEvent, 'sequence'>[]; readonly segments: number}

/** Pure transition, evaluated by an existing EngineKernel module. Exact integer arithmetic.
 * All reported event times lie on the 1 us logical lattice. */
function integrate(frame: Readonly<Frame>, quantumUs: bigint | null): Transition {
  const initial = frame.state;
  let t = initial.timeUs, volume = initial.volumePl, running = initial.running;
  let pending = initial.pendingStartUs, reached = initial.reachedAtUs, segments = 0;
  const events: Omit<TankEvent, 'sequence'>[] = [];
  while (t < frame.untilUs) {
    if (pending !== null && pending <= t) {
      pending = null;
      if (!initial.failed) {running = true; events.push({kind: 'started', atUs: t});}
    }
    let end = quantumUs === null ? frame.untilUs : (t + quantumUs < frame.untilUs ? t + quantumUs : frame.untilUs);
    if (pending !== null && pending < end) end = pending;
    const next = volume + (running ? initial.flowUlPerSecond * (end - t) : 0n);
    if (next > frame.capacityPl) throw new RangeError('Capacity invariant would be violated; transition not committed');
    if (reached === null && next >= frame.targetPl) {
      reached = volume >= frame.targetPl ? t : t + ceilDiv(frame.targetPl - volume, initial.flowUlPerSecond);
      events.push({kind: 'goal-reached', atUs: reached});
    }
    volume = next; t = end; segments++;
  }
  // An actuator acknowledgement exactly at the requested endpoint is observable there.
  if (pending !== null && pending <= t) {
    pending = null;
    if (!initial.failed) {running = true; events.push({kind: 'started', atUs: t});}
  }
  return {state: Object.freeze({...initial, timeUs: t, volumePl: volume, running, pendingStartUs: pending, reachedAtUs: reached}), events, segments};
}
function moduleFor(backend: TankBackend): EngineModule<Frame, Transition> {
  return {
    id: `tank.${backend}`, slot: 'tank.flow', phase: 'simulate', rateHz: 1,
    reads: ['tank.state'], writes: ['tank.state'],
    depth: {axis: 'tank.flow', min: backend === 'stepped' ? 128 : 0, max: backend === 'stepped' ? 255 : 127},
    run: frame => [integrate(frame, backend === 'stepped' ? 1_000n : null)],
  };
}
export interface TankRefinementCertificate {
  readonly model: typeof TANK_CONTRACT_SCHEMA;
  readonly revision: number;
  readonly fromUs: bigint;
  readonly untilUs: bigint;
  readonly observables: readonly ['volume', 'goal-event', 'pump-events'];
  readonly errorPl: 0n;
  /** Mathematical derivation plus tests; deliberately NOT machine-checked proof. */
  readonly evidence: 'analytic-affine-lattice-and-tests';
}
export interface TankOptions {
  /** Explicit simulated initial state. An observation is never silently assigned as truth. */
  readonly initialVolumeUl: bigint;
  /** Host authorization policy, checked for EVERY requested action; default is deny. */
  readonly authorize?: (action: 'start' | 'stop', entity: string) => boolean;
}
/** One authoritative tank domain; both backends run through the existing EngineKernel.
 * No renderer, second live state, LLM or per-tick source parser is introduced. */
export class TankContractRuntime {
  #contract: TankContract;
  get contract(): TankContract {return this.#contract;}
  #kernel = new EngineKernel<Frame, Transition>(1);
  readonly #programs: Readonly<Record<TankBackend, KernelProgram<Frame, Transition>>>;
  readonly #certificates = new WeakSet<object>();
  readonly #authorize: NonNullable<TankOptions['authorize']>;
  #state: TankState;
  readonly #journal: TankEvent[] = [];
  #sequence = 0;
  #tick = 0;
  #executedSegments = 0;
  constructor(input: TankContract, options: TankOptions) {
    this.#contract = decodeTankContract(input);
    const o = this.#contract.observation, initial = options.initialVolumeUl;
    if (typeof initial !== 'bigint' || initial < BigInt(o.volumeUl) - BigInt(o.errorUl) || initial > BigInt(o.volumeUl) + BigInt(o.errorUl))
      throw new RangeError('Explicit initial state must belong to the observation interval');
    this.#authorize = options.authorize ?? (() => false);
    this.#state = Object.freeze({timeUs: BigInt(o.atUs), volumePl: initial * SCALE,
      flowUlPerSecond: BigInt(this.#contract.assumptions.flowUlPerSecond), pendingStartUs: null,
      running: false, failed: false, reachedAtUs: initial >= BigInt(this.#contract.goal.volumeUl) ? BigInt(o.atUs) : null, revision: 0});
    if (this.#state.reachedAtUs !== null) this.#append('goal-reached', this.#state.timeUs);
    this.#kernel.usePlugin({id: 'world-contract.tank-affine', modules: [moduleFor('stepped'), moduleFor('event-driven')]});
    this.#programs = Object.freeze({
      stepped: this.#kernel.compile({defaultDepth: 255, axes: {'tank.flow': 255}}),
      'event-driven': this.#kernel.compile({defaultDepth: 0, axes: {'tank.flow': 0}}),
    });
  }
  #append(kind: TankEventKind, atUs: bigint): void {
    if (this.#journal.length === 256) this.#journal.shift();
    this.#journal.push(Object.freeze({kind, atUs, sequence: this.#sequence++}));
  }
  #change(patch: Partial<TankState>): void {
    this.#state = Object.freeze({...this.#state, ...patch, revision: this.#state.revision + 1});
  }
  snapshot(): TankState {return this.#state;}
  events(): readonly TankEvent[] {return Object.freeze([...this.#journal]);}
  get diagnostics() {return {segments: this.#executedSegments, ticks: this.#tick, eventsDropped: Math.max(0, this.#sequence - 256), kernel: this.#kernel.diagnostics};}
  requestStart(): void {
    if (!this.#authorize('start', this.#contract.id)) throw new Error('Start not authorized');
    if (this.#state.failed || this.#state.running || this.#state.pendingStartUs !== null) throw new Error('Pump cannot start in this state');
    this.#change({pendingStartUs: this.#state.timeUs + BigInt(this.#contract.assumptions.startDelayUs)});
    this.#append('start-requested', this.#state.timeUs);
  }
  requestStop(): void {
    if (!this.#authorize('stop', this.#contract.id)) throw new Error('Stop not authorized');
    this.#change({running: false, pendingStartUs: null}); this.#append('stopped', this.#state.timeUs);
  }
  failPump(): void {this.#change({failed: true, running: false, pendingStartUs: null}); this.#append('failed', this.#state.timeUs);}
  setFlowUlPerSecond(value: bigint): void {
    if (typeof value !== 'bigint' || value <= 0n || value > LIMIT) throw new RangeError('Invalid flow');
    this.#change({flowUlPerSecond: value});
  }
  applyVolumeDisturbanceUl(delta: bigint): void {
    if (typeof delta !== 'bigint') throw new TypeError('Volume disturbance must be bigint');
    const volumePl = this.#state.volumePl + delta * SCALE;
    if (volumePl < 0n || volumePl > BigInt(this.#contract.capacityUl) * SCALE) throw new RangeError('Invalid volume disturbance');
    const crossed = this.#state.reachedAtUs === null && volumePl >= BigInt(this.#contract.goal.volumeUl) * SCALE;
    this.#change({volumePl, ...(crossed ? {reachedAtUs: this.#state.timeUs} : {})});
    if (crossed) this.#append('goal-reached', this.#state.timeUs);
  }
  certify(untilUs: bigint, observables: readonly string[] = ['volume', 'goal-event', 'pump-events']): TankRefinementCertificate {
    if (typeof untilUs !== 'bigint' || untilUs <= this.#state.timeUs || untilUs - this.#state.timeUs > 100_000_000n)
      throw new RangeError('Certificate horizon must be in (0, 100 s]');
    if (observables.length !== 3 || new Set(observables).size !== 3 || observables.some(q => !['volume', 'goal-event', 'pump-events'].includes(q)))
      throw new Error('Unsupported observable; waves, pressures and audio are NOT certified');
    const start = this.#state.running ? this.#state.timeUs : this.#state.pendingStartUs;
    const duration = start === null || this.#state.failed || start >= untilUs ? 0n : untilUs - start;
    if (this.#state.volumePl + this.#state.flowUlPerSecond * duration > BigInt(this.#contract.capacityUl) * SCALE)
      throw new RangeError('Certificate horizon would violate capacity');
    const certificate: TankRefinementCertificate = Object.freeze({model: TANK_CONTRACT_SCHEMA,
      revision: this.#state.revision, fromUs: this.#state.timeUs, untilUs,
      observables: Object.freeze(['volume', 'goal-event', 'pump-events'] as const), errorPl: 0n, evidence: 'analytic-affine-lattice-and-tests'});
    this.#certificates.add(certificate); return certificate;
  }
  advance(untilUs: bigint, backend: TankBackend = 'stepped', certificate?: TankRefinementCertificate): TankState {
    if (typeof untilUs !== 'bigint' || untilUs <= this.#state.timeUs || untilUs - this.#state.timeUs > 100_000_000n)
      throw new RangeError('Advance must be in (0, 100 s]');
    if (backend !== 'stepped' && backend !== 'event-driven') throw new TypeError('Unknown backend');
    if (backend === 'event-driven' && (!certificate || !this.#certificates.has(certificate) ||
      certificate.revision !== this.#state.revision || this.#state.timeUs < certificate.fromUs || untilUs > certificate.untilUs))
      throw new Error('Missing, stale, foreign or expired refinement certificate');
    const frame: Frame = {state: this.#state, untilUs, capacityPl: BigInt(this.#contract.capacityUl) * SCALE, targetPl: BigInt(this.#contract.goal.volumeUl) * SCALE};
    // Calculate before committing: rejected invariants leave state, events and counters intact.
    const commands = this.#programs[backend].run(this.#tick, frame, {deltaSeconds: Number(untilUs - this.#state.timeUs) / 1e6});
    if (commands.length !== 1) throw new Error('Exactly one flow implementation must own the domain');
    const result = commands[0]!;
    this.#state = result.state;
    for (const event of result.events) this.#append(event.kind, event.atUs);
    this.#executedSegments += result.segments; this.#tick++;
    return this.#state;
  }
  goalStatus(): 'pending' | 'satisfied' | 'missed' {
    const deadline = BigInt(this.#contract.observation.atUs) + BigInt(this.#contract.goal.withinUs);
    if (this.#state.reachedAtUs !== null && this.#state.reachedAtUs <= deadline) return 'satisfied';
    return this.#state.timeUs >= deadline ? 'missed' : 'pending';
  }
}
