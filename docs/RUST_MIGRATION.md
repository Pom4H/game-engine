# Rust/WASM migration — actual status

Base: `codex/vehicle-physics-checkpoint-20261029`, commit
`2c3abdda7d34bcc1d60414a2cd129ec83a166dc6`. This deliberately does **not**
start from the older `main` and does not delete or replace existing systems.

**The whole engine has NOT been rewritten. No production backend is switched
by this change, and no performance improvement has been measured yet.**

## Implemented candidate ports

`kernels/engine-runtime` is a dependency-free Rust crate, emitting a native
library and `rom4_engine_runtime.wasm`. `@rom4/game-engine/rust` exposes its
explicitly-owned, persistent buffer API.

| Responsibility | Native candidate | What remains in the engine |
|---|---|---|
| Signed discrete-shell angle and its analytical position gradient | `geometry::dihedral`, batch of hinges | Constraint assembly, constitutive laws, contact iterations and shell lifecycle |
| Implicit wheel contact, 17 bounded iterations | `wheel::solve`, batch of independent solves | Chassis coupling, force application, suspension, wear and scheduling |
| Cage-to-mesh deformation | `geometry::skin` | Binding construction and physical node owner |
| Local permanent dents / elastic-plastic panel displacement | `geometry::dents` | Contact-energy accounting, dent histories, panel dynamics and material decisions |
| Area-weighted normals and f32 vertex staging | `geometry::normals`, `geometry::pack` | GPU upload, render resources, materials, passes and draw scheduling |

The existing Rust XPBD, sparse factorization, rigid contact and acoustic-wave
kernels remain separate prior implementations. This patch does not falsely
count their TypeScript lifecycle/assembly owners as migrated.

## Performance contract

One `batch.execute(mask)` invokes a complete requested batch. There are no
per-vertex/per-hinge JavaScript callbacks. Rust owns preallocated buffers;
`execute` has no heap growth or allocation. Input validation happens before any
output is written, including topology that JavaScript may have modified.

Physics and geometry calculations remain `f64`. The final optional GPU staging
stream is `f32`. No `fast-math`, relaxed-SIMD arithmetic, coefficient retuning,
lower solver iteration count or reduced physical detail is introduced.

The scalar and SIMD binaries are separate measured candidates. SIMD is not a
claim of speedup: gather-heavy small batches and the host boundary can make a
native call slower than JavaScript. There is no automatic backend promotion.

The new ABI is bounded to 128 live batches and 128 MiB of logical buffer data
per instance. Generational handles reject stale handles and double frees.
Freed linear-memory capacity can be reused; WebAssembly memory itself does not
shrink. Dispose the runtime/instance when its entire scene/worker is gone.

All TypedArrays are **borrowed views**. Reacquire `batch.buffers` after any
creation/disposal in the same runtime. A saved view may be detached by memory
growth, or may alias reused storage after disposal. Make an explicit copy for
snapshots; never keep borrowed views as persistent historical records.

## Use the actual API

```ts
import {createRustKernelRuntime, RustKernelPass as Pass} from '@rom4/game-engine/rust';

// Supply a compiled Module or the bytes of the generated scalar/SIMD asset.
const runtime = await createRustKernelRuntime(wasmBytes);
const batch = runtime.createBatch({wheelCount: 4});
try {
  const input = batch.buffers.wheelInput;
  // dt, radius, inertia, omega, road speed, lateral slip, force limit,
  // drive force, brake force, inverse supported mass, previous longitudinal
  // force, previous lateral force, relaxation, longitudinal/lateral stiffness.
  for (let i = 0; i < 4; i++) input.set([
    1/120, .33, 1.2, 20, 8, .1, 4000, 500, 100, .001, 0, 0, .2, 12, 9.5,
  ], i * 15);
  batch.execute(Pass.Wheels);
  const output = batch.buffers.wheelOutput;
  // 7 values per wheel: force, sideForce, speed, slip, brake, targetForce, targetSide.
} finally {
  runtime.dispose();
}
```

A mesh pass uses `Skin | Dents | Normals | Pack`. Fill persistent rest geometry,
weights, triangle indices and dent rows once, then update only changing inputs.
The example parity/benchmark code uses the **actual M3 cage and skin**. It
includes the transfer of node positions from the current TS physical owner;
it does not disguise that transfer as zero-copy.

Projection is not simulation: repeatedly asking for render geometry must not
advance damage. Dents/normals/packing therefore require `Skin` in the same call;
each projection starts from the immutable skin rest input. This does not remove
the existing reduced system's capped dent-history behavior.

**Do not batch sequentially dependent wheel/chassis contacts from one vehicle
without preserving the current contact order and state updates.** The wheel
API ports the numeric solve, not the simulation scheduler.

## Verification and measurements

On an environment with the repository's Bun setup, Rust and its Wasm target:

```sh
rustup target add wasm32-unknown-unknown
bun install --frozen-lockfile
bun run rust:verify
bun run rust:bench
node tools/engine-runtime/verify.mjs --simd
```

Set `ROM4_RUST_WASM=artifacts/rust-engine/rom4-engine.simd.wasm` to benchmark
SIMD. Evidence is written under `artifacts/rust-engine/` with compiler version,
Wasm SHA-256, platform, CPU, raw paired samples, medians and p95 timings.

`rust:verify` runs Rust unit tests, builds Wasm, builds the TypeScript project,
and runs the host-adapter and **strict** Wasm/reference parity tests. A missing
Wasm binary is an error in this path (`ROM4_REQUIRE_RUST=1`), not a skipped pass.
The ordinary all-JS test suite may visibly skip parity tests until Wasm is built.

The manual-only workflow `rust-engine-migration.yml` uses one job with the same
`[self-hosted, Windows, X64]` labels as the existing structural verifier. It
creates no worker, no matrix, and does not perform CPU rendering. A newly added
workflow may need registration on the repository's default branch before the
GitHub dispatch UI offers it; the commands above work directly on the checkout.

These benchmarks cover independent wheel batches and M3 skin projection.
They are **not** whole-engine FPS, a complete physics tick, GPU rendering, the
wall150 crash workload, or an end-to-end vehicle handling proof.

### Verification performed while authoring this change

* The new TypeScript bridge passed strict standalone typechecking.
* All **8 host-adapter tests passed** using Node 22.16.0 and mock native exports.
  They test ABI rejection, count/range validation, stable views, memory-growth
  refresh, disposal, constructor failure cleanup and lifetime errors.
* JavaScript tools/tests passed `node --check`.
* Rust compilation, the 14 Rust unit tests, native/reference parity tests,
  scalar/SIMD benchmarks and full-project typechecking were **not run** in the
  authoring sandbox: it has no Rust toolchain, the complete checkout could not
  be cloned there, and external toolchain downloads failed.
* No GPU/FPS improvement is claimed. Existing engine behavior is unchanged.

## Full-engine migration gates

`bun run rust:audit` inventories every TypeScript module and writes its content
hash and migration status to `migration-audit.json`. It distinguishes partial
ports from candidate ports and host bridges; it does not turn line counts into
an invented parity percentage. `node tools/engine-runtime/audit.mjs
--require-complete` fails until every responsibility is explicitly resolved.

The remaining work is substantial:

| Gate | Required result before retiring the TS owner |
|---|---|
| Structural/contact/vehicle owner | Latest checkpoint's projective shells, bending/plasticity, material/contact assembly, finite rigid retraction, compound contacts, shared energy accounting, suspension and M3 crash fixtures in one Rust-owned state; full-tick CPU and wall150 measurements |
| Scene/execution/lifecycle | Fixed-step scheduling, commands, ownership, sleeping/activation, content/world IR, deterministic events and replay; no duplicate JS world |
| Environment and audio | Weather, soil/water/snow/thermal coupling, source synthesis and audio buffers, acoustic integration with unchanged causal order |
| Renderer | WebGPU resource lifetime, scene projections, culling, transforms, material/shader inputs and all existing passes; GPU image/video regression on the existing worker |
| World/network/storage | Streaming/cancellation, stable IDs, transport formats, authoritative snapshots, persistence and replay compatibility |
| Characters/NPC/tools | Acting, face/mouth/locomotion, resident systems, authoring interfaces and application integration with their existing regressions |

For each gate: port the owner, compare state/energy/events and captures, measure
the complete workload including transfers, then enable the native path. The
current TypeScript implementation stays as a reference until that gate passes.
