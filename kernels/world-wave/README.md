# World wave: Rust/WASM numerical kernel

The first runtime physical kernel accelerated by Rust/WASM in the engine.
It implements the existing staggered-grid AcousticWaveField solver.
The original TypeScript kernel remains the default. It does not speed up
rigid-body collisions, and it makes no whole-engine FPS claim.

## Build and verify

    rustup target add wasm32-unknown-unknown
    cargo test --manifest-path kernels/world-wave/Cargo.toml
    cargo build --release --target wasm32-unknown-unknown --manifest-path kernels/world-wave/Cargo.toml
    bun run build
    node --test test/wave-wasm.test.mjs
    node tools/world-wave/benchmark.mjs

## Engine use

    import {createWasmAcousticWaveField,uploadAcousticPressurePlane} from '@rom4/game-engine';
    const bytes=await fetch('/kernels/world_wave_kernel.wasm').then(r=>r.arrayBuffer());
    const compiled=await WebAssembly.compile(bytes);
    const field=await createWasmAcousticWaveField({
      size:[64,16,64],cellSizeM:.5,waveSpeedMps:343,densityKgM3:1.225
    },compiled);
    field.injectBlast({position:[8,3,8],acousticEnergyJ:2,radiusM:.75});
    field.step(field.maxStableDt*.5);
    const texture=device.createTexture({
      size:[64,64,1],format:'r32float',
      usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST
    });
    uploadAcousticPressurePlane(field,device.queue,texture,8);
    field.dispose();

Each field owns one Wasm instance, with stable Float64Array/Uint8Array views
into Rust-owned linear memory. Scene geometry updates directly mutate these
arrays. A physical step crosses the ABI once and allocates no state arrays.

The Rust solver computes the same X/Y/Z staggered velocity faces and pressure
cells in the same order. Damping's exponential factor remains computed by JS
Math.exp to preserve the baseline numerical contract. The original CFL guard,
pressure/solid state, injectBlast and collision-derived boundary projection all
work with either backend.

A horizontal r32float XZ slice (X columns, Z rows, chosen Y) is prepared in
persistent Rust f32 staging memory, padded to a 256-byte row pitch. WebGPU
GPUQueue.writeTexture can accept the typed view directly; it still transfers
bytes from CPU to GPU. This is **not GPU memory zero-copy**. The scene renderer
does not yet render acoustic slices automatically. An application may bind the
texture in its shader; mock queue upload is checked by CI.

The ABI has exports for new/free/step, f64 pressure and staggered velocity
buffers, solid occupancy, pressure plane staging pointer and pitch.
Only Wasm32 raw pointers are ever exposed, never host-native pointers.
Maximum supported Wasm field is two million cells; use JS for larger fields.

## Testing and performance evidence

The cross-language test compares every pressure and velocity cell for 160
ticks, including changes in solid geometry at tick 70. It checks that Wasm
memory backing arrays do not change during stepping and that the GPU staging
buffer is aligned and used by one writeTexture call. Independent Rust tests
cover finite propagation, solid reflection and GPU plane layout.

CI also measures production TS and Rust/Wasm numerical steps for 3 grid
sizes with warmup and 5 timing rounds. The report and compiled module are
uploaded as GitHub Actions artifacts. Reported speedups are local to that
CPU/Node workload and **must not be extrapolated to FPS or total engine**.

This adapter is an opt-in runtime specialization. It does not change the
World compiler WSCN v1 format, which continues to produce native SceneSpec.
