/** Project composition runs at installation, never inside an entity/physics loop.
 * Plans are ordinary imported TypeScript values. A missing dependency is an error,
 * not an instruction to secretly activate a commented-out module. */
export interface ModuleContext {
  use<C extends object, R>(plan: ModulePlan<C, R>): R;
}
export interface EntityView {
  readonly id: string;
  readonly kind: string;
  readonly label: string;
  readonly source?: string;
  readonly data: Readonly<Record<string, unknown>>;
}
export interface ModulePlan<C extends object = object, R = unknown> {
  readonly id: string;
  readonly label: string;
  readonly config: Readonly<C>;
  readonly requires?: readonly ModulePlan[];
  /** Validate the whole merged config before any module starts. */
  validate(config: Readonly<C>): void;
  create(config: Readonly<C>, context: ModuleContext): R;
  dispose?(value: R): void;
  views?(value: R): readonly EntityView[];
}
type Selection = Readonly<Record<string, ModulePlan>>;
export type ModuleValue<M> = M extends ModulePlan<infer _C, infer R> ? R : never;
export type ModuleConfig<M> = M extends ModulePlan<infer C, infer _R> ? C : never;
export type ProjectPreset<M extends Selection> = { readonly [K in keyof M]?: Partial<ModuleConfig<M[K]>> };
export interface ProjectDefinition<M extends Selection> {
  readonly id: string;
  readonly modules: M;
  readonly presets?: Readonly<Record<string, ProjectPreset<M>>>;
}
export interface ProjectRuntime<M extends Selection> {
  /** Direct module instances. There is no proxy or generic update wrapper. */
  readonly values: { readonly [K in keyof M]: ModuleValue<M[K]> };
  /** Observer failures are counted; they never change resource ownership. */
  readonly observerErrors: number;
  inspect(): readonly EntityView[];
  dispose(): void;
}
export interface LifecycleEvent { readonly module: string; readonly phase: 'started' | 'stopped' | 'failed'; }
const own = (object: object, key: PropertyKey): boolean => Object.prototype.hasOwnProperty.call(object, key);
const safeName = (value: string) => /^[A-Za-z][A-Za-z0-9:_./-]{0,127}$/.test(value) && !['__proto__', 'constructor', 'prototype'].includes(value);

function immutable<T extends object>(input: T): Readonly<T> {
  const copy = structuredClone(input), pending: object[] = [copy], seen = new Set<object>();
  while (pending.length) {
    const value = pending.pop()!; if (seen.has(value)) continue; seen.add(value);
    if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) throw new TypeError('Module configuration must be plain data');
    for (const child of Object.values(value)) if (child && typeof child === 'object') pending.push(child);
    Object.freeze(value);
  }
  return copy;
}

/** The helper preserves the exact config and instance types; it adds no runtime wrapper. */
export function modulePlan<C extends object, R>(plan: ModulePlan<C, R>): ModulePlan<C, R> {
  if (!safeName(plan.id)) throw new TypeError('Module requires a stable id');
  return Object.freeze({ ...plan, config: immutable(plan.config), ...(plan.requires ? { requires: Object.freeze([...plan.requires]) } : {}) });
}

export function project<const M extends Selection>(definition: ProjectDefinition<M>) {
  if (!safeName(definition.id)) throw new TypeError('Project requires a stable id');
  const entries = Object.entries(definition.modules);
  const byKey = Object.freeze(Object.fromEntries(entries));
  if (entries.length > 128) throw new RangeError('Project module budget: 128');
  const selected = new Map<ModulePlan, string>(), ids = new Set<string>();
  for (const [key, plan] of entries) {
    if (!safeName(key) || !safeName(plan.id) || selected.has(plan) || ids.has(plan.id)) throw new TypeError('Module keys, plans and ids must be distinct');
    selected.set(plan, key); ids.add(plan.id);
  }
  // Resolve topology once. No directory scan, global registration or automatic dependency inclusion.
  const ordered: ModulePlan[] = [], visiting = new Set<ModulePlan>(), visited = new Set<ModulePlan>();
  const visit = (plan: ModulePlan): void => {
    if (!selected.has(plan)) throw new TypeError(`Required module is not active: ${plan.id}`);
    if (visiting.has(plan)) throw new TypeError(`Module dependency cycle: ${plan.id}`);
    if (visited.has(plan)) return;
    visiting.add(plan); for (const dependency of plan.requires ?? []) visit(dependency);
    visiting.delete(plan); visited.add(plan); ordered.push(plan);
  };
  for (const [, plan] of entries) visit(plan);
  // Snapshot authoring metadata; later mutations cannot change an installed project's preset meaning.
  const presets = immutable(definition.presets ?? {}) as Readonly<Record<string, ProjectPreset<M>>>;
  for (const preset of Object.values(presets)) validatePreset(preset);
  function validatePreset(preset: ProjectPreset<M>): void {
    for (const key of Object.keys(preset)) {
      if (!own(byKey, key)) throw new TypeError(`Preset addresses an inactive module: ${key}`);
      const patch = (preset as Readonly<Record<string, object>>)[key];
      if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new TypeError(`Invalid preset: ${key}`);
      for (const field of Object.keys(patch)) if (!own(byKey[key]!.config, field)) throw new TypeError(`Unknown parameter: ${key}.${field}`);
    }
  }
  function configuration(preset?: string): Map<ModulePlan, object> {
      if (preset !== undefined && !own(presets, preset)) throw new TypeError(`Unknown preset: ${preset}`);
      const patches = (preset === undefined ? {} : presets[preset]!) as Readonly<Record<string, object>>;
      const configs = new Map<ModulePlan, object>();
      // No side effects until every parameter and dependency has been checked.
      for (const plan of ordered) {
        const config = immutable({ ...plan.config, ...patches[selected.get(plan)!] });
        plan.validate(config); configs.set(plan, config);
      }
      return configs;
  }
  return Object.freeze({
    id: definition.id,
    modules: Object.freeze(Object.fromEntries(entries)) as M,
    presets: Object.freeze(presets),
    /** Static configuration check: never calls a module factory. Imports are trusted source. */
    check(preset?: string) { const configs = configuration(preset); return Object.freeze({id: definition.id, preset: preset ?? null, modules: ordered.map(plan => Object.freeze({key: selected.get(plan)!, id: plan.id, label: plan.label, config: configs.get(plan)!, requires: (plan.requires ?? []).map(p => p.id)}))}); },
    start(preset?: string, onLifecycle?: (event: LifecycleEvent) => void): ProjectRuntime<M> {
      const configs = configuration(preset);
      const instances = new Map<ModulePlan, unknown>(), started: ModulePlan[] = [];
      const context: ModuleContext = { use<C extends object, R>(plan: ModulePlan<C, R>): R {
        if (!instances.has(plan)) throw new TypeError(`Dependency not installed: ${plan.id}`);
        return instances.get(plan) as R;
      } };
      // Instrumentation is observational. A failing observer must not leak an installed resource.
      let observerErrors = 0;
      const emit = (module: string, phase: LifecycleEvent['phase']) => { try { onLifecycle?.({ module, phase }); } catch { observerErrors++; } };
      const release = (): unknown[] => {
        const errors: unknown[] = [];
        for (let i = started.length - 1; i >= 0; i--) {
          const plan = started[i]!;
          try { plan.dispose?.(instances.get(plan)); emit(plan.id, 'stopped'); }
          catch (error) { errors.push(error); emit(plan.id, 'failed'); }
        }
        started.length = 0; instances.clear(); return errors;
      };
      try {
        for (const plan of ordered) {
          // Only declared dependencies are readable, even when another module happens to start first.
          const restricted: ModuleContext = { use<C extends object, R>(dependency: ModulePlan<C, R>): R {
            if (!(plan.requires ?? []).includes(dependency)) throw new TypeError(`Undeclared dependency: ${plan.id} -> ${dependency.id}`);
            return context.use(dependency);
          } };
          const value = plan.create(configs.get(plan)!, restricted);
          if (value && typeof (value as { then?: unknown }).then === 'function') throw new TypeError('Async module startup needs a host adapter');
          instances.set(plan, value); started.push(plan); emit(plan.id, 'started');
        }
      } catch (error) { const errors = release(); throw errors.length ? new AggregateError([error, ...errors], 'Project startup failed') : error; }
      const values = Object.freeze(Object.fromEntries(entries.map(([key, plan]) => [key, instances.get(plan)]))) as ProjectRuntime<M>['values'];
      let disposed = false;
      return {
        values,
        get observerErrors() { return observerErrors; },
        inspect() {
          if (disposed) return [];
          const views: EntityView[] = [], viewIds = new Set<string>();
          for (const plan of ordered) for (const view of plan.views?.(instances.get(plan)) ?? []) {
            if (viewIds.has(view.id)) throw new TypeError(`Duplicate entity view: ${view.id}`);
            viewIds.add(view.id); views.push(view);
          }
          return views;
        },
        dispose() { if (disposed) return; disposed = true; const errors = release(); if (errors.length) throw new AggregateError(errors, 'Project cleanup failed'); },
      };
    },
  });
}
