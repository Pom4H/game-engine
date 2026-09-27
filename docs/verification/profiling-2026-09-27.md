# Actual execution-boundary profiling

Base: `02f42630715b6f8b9878717a716b5f18aa7a8b01` on `codex/adaptive-core`.

## Working scope

`CpuProfiler` observes synchronous calls at the application boundary. No numerical
model imports it. It is disabled by default, does not read its clock or allocate
sample windows when disabled, and never controls simulation dt or scheduling.
The scene, its existing kernel and system registry share one collector. Browser
runtime audio dispatch uses that same collector. Renderer CPU/GPU timestamps remain
in their existing adapter; their statistics now reuse the shared pure helper rather
than retaining a second percentile implementation.

Captured work:

- `system:*`: all ten actual built-in handlers, including weather, surfaces,
  animation, physics, deformation, surface contacts, events, fracture, cleanup, clock.
- `kernel:plan`, `kernel:read`, `module:*`, `kernel:commit`: scheduling, optional
  context construction/copy, module callbacks, and command application respectively.
- `scene:step` and `scene:projections`: total step and final presentation sync.
- `audio:dispatch`: browser-side synthesis/submission during step and RAF playback;
  not AudioContext DSP thread time, activation, seek-only ambience, or speaker latency.

Built-in module callbacks only produce commands. Timing those alone would miss the
physics work. Handler measurements occur inside command application. Inclusive times
therefore overlap; self time subtracts measured child durations. A dropped/unmeasured
child remains in its parent's self time, and dropped observations are reported.

Each scope retains 256 recent CALLS by default, at most 128 scopes. Each uses two
fixed-size Float64Array windows, with constant-time insertion. Quantiles are computed
only on inspection, not every tick. They preserve the renderer's existing empirical
floor-index convention. A system p95 is per call, not per frame or an aggregate p95.
Total calls/time/failures are lifetime counters since reset; windows are bounded.

## Use the existing API

The docs editor already passes `profiling:true` to `BrowserRuntime.create`. Its
existing diagnostics tab now includes self p95 for system/scene/audio scopes; no
second HUD or shell was introduced. In its existing browser bridge:

```js
const report = globalThis.__GAME_ENGINE__.profile();
console.table(report.systems.scopes.map(s => ({
  name: s.id, calls: s.calls, samples: s.samples,
  selfP95Ms: s.self.p95Ms, inclusiveP95Ms: s.inclusive.p95Ms,
})));
globalThis.__GAME_ENGINE__.resetProfile(); // clears both system and renderer data
```

Headless execution uses the same boundary collector:

```ts
import {Scene, CpuProfiler} from '@rom4/game-engine';
const profiler = new CpuProfiler({enabled: true});
const world = new Scene({version: 1, entities: []}, profiler);
world.step();
console.log(profiler.inspect());
world.dispose();
```

## Verification performed locally

Node 22.16.0, TypeScript 5.8.3. The root declares TypeScript ^7.0.2; that declared
version was not available in this offline environment. No lockfiles were changed.

- Typecheck and build pass.
- New focused suite: 15/15 pass.
- Full baseline: 148/151 pass; after: 163/166 pass, same three failures.
- Network projection/host and DSL integration suites: 47/47 pass.
- Docs build and `node --check tools/docs/app.mjs` pass.
- Per-tick state, events and execution order match for 180 profiled/unprofiled ticks.
- Fake-clock tests distinguish actual handler cost from command creation, check
  nested self time, recursion, exceptions, reset, ring limits and exact cadence.

Unchanged failures: two clearcoat shader expectation tests, and the M3 FBX geometry
triangle-count expectation. They have not been weakened or hidden.

## Not claimed complete

This is the first execution-profiling slice, NOT refactoring all engine mathematics.
There is no new Yo/Backquote console, unified causal timeline, or per-entity cost
attribution yet. Existing two-way editor and network debug controls are retained.
Standalone procedural generation, worker-side jobs, network serialization, detailed
solver internals and full audio-device execution remain to be connected/measured at
their real boundaries. Client system timings are not server timings.

No GPU screenshot/visual acceptance, FPS improvement, zero overhead, overall source
size reduction, solver optimality, or complete multiplayer soft-body claim is made.
Enabled instrumentation has clock, lookup and sampling costs; disabled boundaries
still have a small branch/dispatch cost. Sampling does not estimate allocations,
exact CPU cycles, GPU work or worker duration from main-thread elapsed time.
