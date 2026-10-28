# Order-preserving structural distance SIMD (experimental)

## Status and scope

`simd-distance` is **off by default**. It accelerates one candidate hot path of
`kernels/world-structure`: adjacent, independent XPBD distance constraints.
It is not a replacement physics world, a Lisp compiler, graph-colored global
solver, GPU backend, AVX2/AVX-512 implementation, or a measured FPS improvement.

The initial authoring sandbox had Node/Python/Clang but no Rust compiler/Cargo,
and network DNS prevented installing Rust. Node syntax validation and Python
script syntax validation were run. **Rust tests, Rust-generated assembly,
WASM execution and performance measurements were NOT run there.** Do not treat
this implementation or the expected instructions below as verified performance.
The local audit reports missing tools as `blocked`, with all unrun gates explicit.

## One state, same causal order

The existing `Structure::step` remains the owner of execution. The optional
kernel reads/writes its existing `position` and `lambda` slices. No second state,
copy-back, per-step heap allocation or topology cache is introduced. Contacts,
volume constraints, fracture, plastic work, damping and sleep retain their
existing ordering. Production ABI fields and TypeScript bindings are unchanged.

The batch gate consumes exactly two adjacent distance constraints iff all four
endpoints differ and both constraints are active. A shared node, volume, broken
edge, odd tail, invalid view or degenerate numeric input returns control to the
original scalar solve, without any writes. The gate re-reads the current topology
on every attempt, so mutation through host TypedArrays cannot stale a cached plan.

This is deliberately NOT global graph coloring: reordering coupled constraints
changes finite-iteration Gauss-Seidel convergence. Disjoint adjacent operations
can be evaluated together without changing which state their reads observe.
The gate and AoS gather/scatter have overhead; a chain can be slower. The benchmark
includes that case rather than hiding it behind independent synthetic edges.

## Numeric / ISA contract

- f64 throughout. x86_64 SSE2 processes two constraints; no optional CPU ISA is required.
- WASM uses `f64x2` only when built with `+simd128`. Other targets use scalar fallback.
- No fast math, approximate reciprocal/sqrt, FMA or relaxed SIMD.
- Native length association matches the existing `(x*x+y*y+z*z).sqrt()`.
- In WASM, the fast pair uses packed sqrt instead of host `Math.hypot`.
  This can round differently. **It is not bitwise JS/WASM replay equivalence.**
  Overflow/nonfinite/near-zero lengths fall back to the existing host-norm path.
- Never mix numerical profiles in lockstep without explicit compatibility policy.
  Tiny differences near fracture/contact thresholds can change later events.
  The provided finite-fixture parity tests are necessary, not a universal proof.
- There is no raw handwritten assembly: architecture intrinsics request packed
  instructions, and the audit checks what the Rust compiler actually generated.

## Local verification (no CI dispatch)

From the repository root, with Rust/Cargo and a native linker installed:

```sh
python tools/structure-simd-audit.py
```

For browser-backend validation, also install the `wasm32-unknown-unknown` Rust
standard library target and Node, then run:

```sh
python tools/structure-simd-audit.py --wasm
```

The script never installs software or launches GitHub Actions. By default it
writes ignored build artifacts under `kernels/world-structure/target/simd-audit`:
compiler identity, command/log files, reference and SIMD test results, benchmark
CSV, a named-function assembly excerpt, optional WASM ABI parity, and `report.json`.
Native audit uses `-C target-feature=-fma` and records it. Missing dependencies exit
2; failed assertions/builds/assembly checks exit 1. Only completed gates say passed.

Tests cover independent pairs, all shared-endpoint orientations, pinned nodes,
broken/volume barriers, odd tails, malformed views, overflow/degeneracy, host
topology mutation, 10,000 deterministic random pairs, mass-weighted center, and
120 complete mixed steps with plasticity/fracture/static-contact comparisons.
WASM compares separately compiled reference and SIMD production ABI modules,
including all state fields, discrete broken flags and 120-tick topology mutation.

The native benchmark uses the same Rust source module as the optional solver.
It compares scalar and SIMD-attempt paths, includes guard/gather/scatter overhead,
alternates sample order, excludes initialization and warm-up, checks parity,
counts allocations inside measured sweeps, and reports 19-sample p50/p95 per
constraint for independent edges and a fully dependent chain. It measures
**distance projection only**, not a full timestep, rendering or transfers.

The native assembly gate requires packed `sqrtpd`/`divpd` (or VEX forms) inside
`structure_simd_sweep`, not elsewhere in the binary. The WASM gate requires
`f64x2.sqrt`/`f64x2.div` in the compiled library. Expected opcodes are not evidence
until these gates are actually executed successfully.

## Promotion gate

Keep the feature disabled until the audit passes on the intended native and
WASM runtimes, representative soft-body scenes pass physical quality/replay
checks, and full-step timing shows a gain including the fallback-heavy cases.
Then decide whether the numerical profile may be enabled explicitly; do not
silently replace the reference backend. Remaining work includes solver-wide
profiling, AVX2/NEON candidates, topology-specific plans with explicit validity,
residual/energy gates and lowering typed Lisp physical IR into selected kernels.
