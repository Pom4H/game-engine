# Structural JS / Wasm experiment

This measures the production `StructuralBody` active XPBD step against an
experimental C-to-Wasm port. It does not switch the runtime backend or add a
runtime dependency. Compiler outputs live under ignored `artifacts/structural-wasm/`.

## Run

Install Clang and lld (Ubuntu: `sudo apt-get install clang lld`), then:

```sh
bun install --frozen-lockfile
bun run build
node --expose-gc tools/structural-wasm/run.mjs
```

`CLANG` selects the compiler. `--verify-only` runs numerical checks without
timing; `--quick` uses fewer warmup ticks and timing rounds. CI runs the full
experiment on a hosted CPU runner and uploads the actual Wasm, build metadata,
generated JS control, and result JSON. No GPU is needed to measure this CPU step.

## Question and governing relation

Can the same structural state transition execute faster in Wasm while preserving
the observable state and fracture timeline?

For each distance or tetrahedral volume constraint, XPBD uses

`deltaLambda = (-C - alpha * lambda) / (sum(inverseMass * |gradient C|²) + alpha)`

where `alpha = compliance / dt²`. Distance `C` is in metres and its compliance
in m/N; volume `C` is in m³ and its compliance in m⁶/J. Both ports use the same
f64 buffers, material parameters, rest state, constraint order, ten iterations,
1/120 s step, plastic return mapping, internal damping, and sleep criterion.
No material coefficients or physical assertions are tuned to backend results.

Initialization, activation, inputs, thermal setup, validation and bake are shared
production JS. The C kernel performs integration, strain prediction, constraint
sweeps, velocity recovery, plasticity/fracture, damping and sleep detection.
It does not support external contact-projector callbacks and rejects them.

The independent checks cover constant-momentum unforced motion, non-increasing
energy of an unforced damped pair, analytical semi-implicit Euler free fall,
and one-time bake handoff. Each candidate is also compared after every tick:
positions, velocities, rest state, constraint multipliers, predicted strain,
plastic work, broken links, step count and lifecycle mode.

## Four backends

| Backend | Purpose |
| --- | --- |
| `js` | Unmodified production `StructuralBody` |
| `wasm-strict` | Same `Math.hypot`, `Math.exp` and `Math.pow` through explicit host imports |
| `js-sqrt-control` | Production initial state with generated step methods changing only norms to `sqrt(x²+y²+z²)` |
| `wasm-sqrt` | Wasm f64.sqrt for norms; host exp/pow |

All initial typed arrays are checked for exact equality. The JS control uses
the production constructor and substitutes its generated method prototype,
so constructor rest-length evaluation is never a confounding difference.
The sqrt controls change floating-point evaluation. They are bounded-fixture
experiments, not a general replacement for the scaled/compensated `Math.hypot`.
Overflow, underflow and accumulated roundoff can differ. A control that exceeds
the unchanged numerical comparison budget is recorded at its first divergence
and excluded from throughput measurements for that definition. Strict Wasm
divergence fails the entire run. A fast rejected control earns no speed claim.

The strict comparison budget is absolute 1e-10 plus relative 1e-11. For sqrt
controls it is absolute 1e-7 (1e-6 for velocity) plus relative 1e-8. These are
numerical compatibility budgets, not physical calibration constants. Broken
links, mode and step count must match exactly.

## Workloads and timing

The real M3 cage uses `passengerStructuralDefinition(M3_PARAMETRIC_PROFILE,
1700, material('steel').mechanical)` with 1, 16 and 64 independent copies.
A 512-node mixed distance/volume lattice tests a larger structure with 1 and 8
copies. Every copy receives the same reproducible balanced sinusoidal nodal
force and initial rigid velocity. The verified replay covers the complete
warmup plus measured horizon. Fracture is permitted only on its verified tick
timeline; measured workloads assert that timeline without changing materials.

The lattice is a solver stress fixture, not a calibrated vehicle or continuum
model. In the baseline replay its first fracture occurs at tick 57: a distance
element's trial strain is about 0.1236 against the catalog's 0.12 failure strain.
This is diagnosed and reproduced, not suppressed to keep workload topology fixed.

Five rounds rotate backend order. Setup and 120 warmup ticks are excluded from
timed calls; each round measures 240 world ticks. Each tick includes all bodies'
step calls, including the Wasm ABI crossing and shared validation. Input writes,
parity checks, bookkeeping, yields, rendering and networking are outside timing.
The Wasm arrays remain in linear memory between calls; there is no per-tick
array upload/download or JS solver fallback.

Report p50/p95/p99/max latency, round medians, setup time, logical buffer bytes,
Wasm memory capacity, observed heap/ArrayBuffer deltas and GC phase statistics.
Heap deltas include temporary and harness allocations. GC events include yields
and bookkeeping; neither measure is an allocation rate or a leak estimate.
Compare logical bytes with logical bytes, not Wasm arena capacity.

## Reading the result

Ratios describe these active structural workloads on the recorded CPU/Node/V8,
not whole-game FPS, native C++ performance or universal language overhead.
The C port also removes JS vector-array temporaries in volume calculations;
its advantage includes data representation and compiler optimization.
Use the JS sqrt control to separate norm-evaluation cost from backend effects.
The strict port deliberately retains host-math crossings; it is a conservative
candidate, not an optimally self-contained Wasm implementation.

Results identify solver, C kernel, harness, adapter and Wasm hashes, fixture
hashes, build flags, environment and the first rejected control divergence.
CI's `sourceCommit` is the actual checked-out commit. Local runs identify their
solver baseline separately and use source hashes for unpublished experiment code.
