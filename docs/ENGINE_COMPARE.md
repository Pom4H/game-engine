# Engine GPU comparison: Three.js / Babylon.js / ROM4 JS / ROM4 Rust

The shared reference is [KilledByAPixel/webgl-engine-bench](https://github.com/KilledByAPixel/webgl-engine-bench)
(MIT, pinned at [2785ce1](https://github.com/KilledByAPixel/webgl-engine-bench/tree/2785ce1d4a0afdfff88d4d1f6863de9427f831f5)).

Our comparison calls the **original seeded Sim3D**, using its exact cube spawn,
60 Hz time step, bouncing bounds, positions, rotations and individual RGB tints.
The camera and framebuffer are **1280 × 720**. The checker atlas is replaced
with one opaque white texel for **every renderer** to avoid comparing textured
cubes against our scene's solid-color materials. Lighting/material implementations
differ; strict cross-engine pixel equality would be misleading and is NOT asserted.

| Variant | Real renderer | Object strategy | Animation step |
| --- | --- | --- | --- |
| `three-mesh-webgpu` | Three WebGPU | separate Mesh per cube | source JS Sim3D |
| `three-instanced-webgpu` | Three WebGPU | InstancedMesh | source JS Sim3D |
| `babylon-instances-webgpu` | Babylon WebGPU | individual instance objects | source JS Sim3D |
| `babylon-thin-webgpu` | Babylon WebGPU | thin instances | source JS Sim3D |
| `rom4-js` | production ROM4 WebGPURenderer | individual render-only entities | source JS Sim3D |
| `rom4-rust` | SAME ROM4 WebGPURenderer | same entities | Rust/WASM port of Sim3D.update |

Rust/WASM is **not** another GPU renderer. It only replaces the numerical update
of the common simulation. The original JS Sim3D.spawn writes its seeded data
straight into **persistent WASM-backed Float32Arrays**, so no per-frame data copy
or second world state exists. We validate f32 parity against original JS at
1, 128, 2000 and 10000 cubes for 120 ticks.

The ROM4 renderer is the production shader/light/shadow pipeline, so render
costs include work not necessarily present in the reference Lambert scenes.
The lack of a massive dynamic instancing fast path in ROM4 is a real
optimization opportunity. Compare per-object paths with per-object paths;
optimized instancing rows represent separate throughput ceilings.

## Measurements and constraints

CI job: [engine-compare.yml](../.github/workflows/engine-compare.yml).
Runs **only on self-hosted Windows X64**, with installed Chrome and hardware WebGPU.
SwiftShader/lavapipe/software adapters are rejected. Apple and hosted CI are not
used. All variants are benchmarked on the same runner and browser session, in
interleaved order, with 3 repeats each.

For each adapter: 2000-cube screenshot at exactly simulation tick 120; independent
WebGPU draw/triangle-count verification at 2000 and 1000 objects; fixed
1000/2000/5000 cube timed runs; numerical state parity for the two ROM4 paths.
The source harness measures real frame interval, CPU spent inside render(), and
CPU spent in simulation separately. A lost context, missing GPU, missing
triangles, missing measurements, or parity failure causes CI failure.

**GPU timestamp durations remain null**: the source reference harness does not
provide comparable GPU timestamps. Frame interval or CPU time cannot be
reported as GPU time. Comparing pure Rust vs native JS GPU-renderer implementations
requires a separately implemented Rust GPU backend.

Artifacts: `artifacts/engine-compare/results.json`, `parity.json`,
and screenshots for all six variants, uploaded by GitHub Actions.

## Local reproduction (Windows GPU)

```powershell
bun install --frozen-lockfile
bun run build
rustup target add wasm32-unknown-unknown
cargo test --manifest-path kernels/bench-motion/Cargo.toml
cargo build --release --target wasm32-unknown-unknown --manifest-path kernels/bench-motion/Cargo.toml

git clone https://github.com/KilledByAPixel/webgl-engine-bench.git artifacts/engine-compare/upstream
git -C artifacts/engine-compare/upstream checkout --detach 2785ce1d4a0afdfff88d4d1f6863de9427f831f5
npm ci --prefix artifacts/engine-compare/upstream
node tools/engine-compare/prepare.mjs
node tools/engine-compare/parity.mjs
cd artifacts/engine-compare/upstream
node tools/rom4-run.mjs --full
```

For a second independent comparison covering real-world materials, geometry,
shadows, Sponza, skinning, compute and GPU timestamps, see
[endel/webgpu-webgl-benchmarks](https://github.com/endel/webgpu-webgl-benchmarks).
This benchmark specifically tests moving cubes and renderer/JS/WASM overhead.
