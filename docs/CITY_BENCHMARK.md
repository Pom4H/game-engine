# City Benchmark: one city, two contact implementations

This benchmark reuses the existing procedural City from `tools/promo/city.mjs`.
Its deterministic recipe expands 18 extra districts and 48 real rigid-body cars.
The same complete `SceneSpec`, stable seed, static scenery, material laws,
ground/contact surfaces, weather and fixed route are used by BOTH backends.
The engine remains the single source of truth for physics, light and audio.

## Route and workload

A 180-frame journey at fixed 60 Hz has three contiguous sections: sidewalk,
traffic and skyline overlook. The camera influences only rendering; it never
changes a car's velocity or collision law. Four indexed camera views allow
pixel/image regressions. Traffic cars are real dynamic `RigidBody` objects,
not GPU particles or fake animation.

Rust is NOT an independent game engine here. The `world-rigid` WASM kernel
is plugged into the original `Scene.physics` object and replaces its supported
collision/contact hot path only. Broadphase, friction policy, weather,
fracture/deformation, scheduling, rendering, assets and state ownership remain
the same TypeScript engine for both comparisons. A native batch may fall back
to ordered JS when a material/ground law requires it. Every run reports
`rigidContactDiagnostics`, including native calls and fallbacks, so a run
that never executes Rust cannot masquerade as a Rust speedup.

## CPU benchmark

```powershell
bun run build
cargo test --manifest-path kernels/world-rigid/Cargo.toml
cargo build --release --target wasm32-unknown-unknown --manifest-path kernels/world-rigid/Cargo.toml
node --test test/city-benchmark.test.mjs test/rigid-wasm.test.mjs
node tools/city-benchmark/physics-benchmark.mjs
```

Reports: `artifacts/city-benchmark/physics-js-rust.json`.

The benchmark hard-gates per-tick parity of every dynamic body's position,
rotation, velocity, angular velocity, sleep status, crush and contact law;
a separate scene fingerprint is stored as diagnostics. After warming the
same simulation it alternates JS/Rust/Rust/JS on fresh worlds and reports
real CPU time per full `Scene.step`, not a microbenchmark of isolated
WASM calls. An FPS improvement is never inferred from CPU timings.

The GitHub Actions workflow uses ONLY the project's Windows self-hosted GPU
runner. GPU timestamps and frame pacing will be captured separately from
real Chrome WebGPU render loops along the same camera route.
