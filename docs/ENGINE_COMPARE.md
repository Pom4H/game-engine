# One source scene: Three.js / Babylon.js / ROM4 JS / ROM4 Rust

Upstream, pinned: [KilledByAPixel/webgl-engine-bench](https://github.com/KilledByAPixel/webgl-engine-bench), commit `2785ce1d4a0afdfff88d4d1f6863de9427f831f5`, MIT.

We reuse the original **seeded Sim3D moving-cube workload**, its PRNG, boundaries, 60Hz tick, 1280x720 camera and FPS harness. The checker atlas is replaced with the same opaque white texel for all renderers, yielding solid-tinted unit cubes. Geometry, transforms and object count are matched. Lighting/material internals differ between engines; exact pixel equality across *different* engines is not claimed.

| Adapter | GPU | Object representation | Motion |
| --- | --- | --- | --- |
| `three-mesh-webgpu` | Three.js WebGPU | one Mesh per cube | upstream JS |
| `three-instanced-webgpu` | Three.js WebGPU | instanced fast path | upstream JS |
| `babylon-instances-webgpu` | Babylon.js WebGPU | per-object instances | upstream JS |
| `babylon-thin-webgpu` | Babylon.js WebGPU | thin-instance fast path | upstream JS |
| `rom4-js` | production ROM4 WebGPURenderer | render-only Scene entities | upstream JS |
| `rom4-rust` | **same production ROM4 WebGPURenderer** | same entities | Rust/WASM Sim3D update |

**Do not confuse the Rust motion kernel with a Rust render engine.** Rust is benchmark-only WASM updating the original SoA f32 fields directly in persistent WebAssembly memory, without per-tick JS↔WASM copies. `Sim3D.spawn` remains the common JS seeded source. The source oracle must agree after 120 ticks at 1, 128, 2000 and 10000 objects. Production rigid and structural Rust kernels are tested separately. Our production GPU renderer still uses TypeScript/WebGPU in both modes, and currently lacks comparable massive moving-mesh instancing: compare default draw-call paths separately from optimized fast paths.

## Reproducibility

The CI workflow `.github/workflows/engine-compare.yml` runs exclusively on **self-hosted Windows X64** with installed Chrome and a hardware WebGPU adapter. Software fallback, CPU rendering, hosted Apple and fabricated results are rejected. It pins the upstream Git SHA, runs `npm ci`, Rust tests/wasm build, engine TS build, then runs the original upstream harness with six scene adapters at 1000, 2000 and 5000 cubes with three interleaved repeats. The harness emits render CPU ms, simulation CPU ms and real frame pacing/FPS separately, plus matched screenshots after 120 ticks.

Artifacts: `artifacts/engine-compare/results.json`, `parity.json`, and six 1280x720 PNG screenshots. **GPU milliseconds stay null**: the borrowed fixed-frame harness measures CPU and pacing, not GPU timestamp queries. A broken variant is a failing run, not a zero-ms win.

Independent richer reference: [endel/webgpu-webgl-benchmarks](https://github.com/endel/webgpu-webgl-benchmarks) measures WebGPU/WebGL, instancing, materials, lights, shadows, compute and Sponza across Three and Babylon.
