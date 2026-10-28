function assertCounter(value:number,label:string){if(!Number.isSafeInteger(value)||value<0)throw new RangeError(`${label} must be a non-negative safe integer`);}

export interface CausalEvent<TPayload = unknown> {
  readonly id: string;
  readonly dueTick: number;
  readonly kind: string;
  readonly subject?: string;
  readonly payload?: TPayload;
}

interface HeapEvent<TPayload> extends CausalEvent<TPayload> { active: boolean }

const compareId=(a:string,b:string)=>a<b?-1:a>b?1:0;
function compareEvent(a: CausalEvent, b: CausalEvent): number {
  return a.dueTick - b.dueTick || compareId(a.id,b.id);
}

/**
 * Deterministic event queue for work that does not belong in the 60 Hz hot loop.
 * Production, contracts, remote travel and social/economic wakeups schedule the next
 * meaningful transition instead of polling every entity every authority tick.
 */
export class CausalEventQueue<TPayload = unknown> {
  private readonly heap: HeapEvent<TPayload>[] = [];
  private readonly byId = new Map<string, HeapEvent<TPayload>>();

  schedule(event: CausalEvent<TPayload>): void {
    if (!event.id || event.id.length > 180 || this.byId.has(event.id)) throw new TypeError('Causal events require distinct stable IDs');
    if (!event.kind || event.kind.length > 120) throw new TypeError('Causal events require a kind');
    assertCounter(event.dueTick, 'event due tick');
    const stored: HeapEvent<TPayload> = {...event, active: true};
    this.byId.set(stored.id, stored);
    this.heap.push(stored);
    this.siftUp(this.heap.length - 1);
  }

  cancel(id: string): boolean {
    const event = this.byId.get(id);
    if (!event) return false;
    // The heap keeps a tombstone until it reaches the root; no O(n) removal is needed.
    event.active = false;
    this.byId.delete(id);
    return true;
  }

  has(id: string): boolean { return this.byId.has(id); }
  get size(): number { return this.byId.size; }
  get nextDueTick(): number | undefined { this.pruneInactiveRoot(); return this.heap[0]?.dueTick; }

  drain(tick: number, limit = 1024): CausalEvent<TPayload>[] {
    assertCounter(tick, 'event drain tick');
    if (!Number.isSafeInteger(limit) || limit < 0) throw new RangeError('Event drain limit must be a non-negative integer');
    const out: CausalEvent<TPayload>[] = [];
    this.pruneInactiveRoot();
    while (out.length < limit) {
      const next = this.heap[0];
      if (!next || next.dueTick > tick) break;
      this.popRoot();
      if (!next.active) { this.pruneInactiveRoot(); continue; }
      this.byId.delete(next.id);
      out.push({id:next.id,dueTick:next.dueTick,kind:next.kind,...(next.subject?{subject:next.subject}:{}),...(next.payload!==undefined?{payload:next.payload}:{})});
      this.pruneInactiveRoot();
    }
    return out;
  }

  snapshot(): CausalEvent<TPayload>[] {
    return [...this.byId.values()].sort(compareEvent).map(event => ({
      id:event.id,dueTick:event.dueTick,kind:event.kind,
      ...(event.subject?{subject:event.subject}:{}),
      ...(event.payload!==undefined?{payload:event.payload}:{}),
    }));
  }

  restore(events: readonly CausalEvent<TPayload>[]): void {
    this.heap.length = 0; this.byId.clear();
    for (const event of events) this.schedule(event);
  }

  private pruneInactiveRoot(): void {
    while (this.heap[0] && !this.heap[0].active) this.popRoot();
  }
  private popRoot(): HeapEvent<TPayload> | undefined {
    const root = this.heap[0], tail = this.heap.pop();
    if (!root) return undefined;
    if (this.heap.length && tail) { this.heap[0] = tail; this.siftDown(0); }
    return root;
  }
  private siftUp(index: number): void {
    while (index > 0) {
      const parent = (index - 1) >> 1;
      const current = this.heap[index], parentValue = this.heap[parent];
      if (!current || !parentValue || compareEvent(parentValue,current) <= 0) return;
      this.heap[parent] = current; this.heap[index] = parentValue; index = parent;
    }
  }
  private siftDown(index: number): void {
    for (;;) {
      const left = index * 2 + 1, right = left + 1;
      let best = index;
      const current = this.heap[best], l = this.heap[left], r = this.heap[right];
      if (l && current && compareEvent(l,current) < 0) best = left;
      const bestValue = this.heap[best];
      if (r && bestValue && compareEvent(r,bestValue) < 0) best = right;
      if (best === index) return;
      const a = this.heap[index], b = this.heap[best];
      if (!a || !b) return;
      this.heap[index] = b; this.heap[best] = a; index = best;
    }
  }
}

/**
 * Resource-to-consumer index. A mutation invalidates only projections/plans whose
 * declared inputs changed; unrelated businesses, routes and UI models do no work.
 */
export class ReactiveDependencyIndex {
  private readonly consumers = new Map<string, Set<string>>();
  private readonly resourcesByConsumer = new Map<string, Set<string>>();
  private readonly versions = new Map<string, number>();

  watch(consumerId: string, resources: readonly string[]): void {
    if (!consumerId || !resources.length) throw new TypeError('Dependency watchers need an id and at least one resource');
    this.unwatch(consumerId);
    const unique = new Set(resources);
    if ([...unique].some(resource => !resource)) throw new TypeError('Dependency resources need stable names');
    this.resourcesByConsumer.set(consumerId, unique);
    for (const resource of unique) {
      let set = this.consumers.get(resource);
      if (!set) this.consumers.set(resource, set = new Set());
      set.add(consumerId);
    }
  }

  unwatch(consumerId: string): boolean {
    const resources = this.resourcesByConsumer.get(consumerId);
    if (!resources) return false;
    for (const resource of resources) {
      const set = this.consumers.get(resource); set?.delete(consumerId);
      if (set?.size === 0) this.consumers.delete(resource);
    }
    this.resourcesByConsumer.delete(consumerId);
    return true;
  }

  invalidate(resources: readonly string[]): string[] {
    const affected = new Set<string>();
    for (const resource of new Set(resources)) {
      if (!resource) throw new TypeError('Dependency resources need stable names');
      this.versions.set(resource, (this.versions.get(resource) ?? 0) + 1);
      for (const consumer of this.consumers.get(resource) ?? []) affected.add(consumer);
    }
    return [...affected].sort();
  }

  version(resource: string): number { return this.versions.get(resource) ?? 0; }
  get watcherCount(): number { return this.resourcesByConsumer.size; }
}

export interface CausalAdvanceResult<TPayload> {
  readonly tick: number;
  readonly processed: readonly CausalEvent<TPayload>[];
  readonly saturated: boolean;
}

/** Isomorphic deterministic clock: no DOM, network, database or wall-clock access. */
export class CausalWorldRuntime<TPayload = unknown> {
  readonly events = new CausalEventQueue<TPayload>();
  readonly dependencies = new ReactiveDependencyIndex();
  tick = 0;

  scheduleAfter(deltaTicks: number, event: Omit<CausalEvent<TPayload>, 'dueTick'>): void {
    assertCounter(deltaTicks, 'event delay');
    this.events.schedule({...event,dueTick:this.tick + deltaTicks});
  }

  advanceTo(tick: number, limit = 1024): CausalAdvanceResult<TPayload> {
    assertCounter(tick, 'world tick');
    if (tick < this.tick) throw new RangeError('Causal runtime cannot move backwards');
    this.tick = tick;
    const processed = this.events.drain(tick, limit);
    const nextDue=this.events.nextDueTick;
    return {tick,processed,saturated:nextDue!==undefined&&nextDue<=tick};
  }
}
