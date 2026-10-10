# Rust structural solver for engine vehicles

## Scope

`StructuralBody` already owns XPBD constraint solving, plasticity,
fracture, thermal rest shape, damping, and the active-to-reduced rigid bake.
The Rust kernel specializes **only its numerical active step**. The production
TypeScript constructor still validates the exact physical model; identical
float and typed-array fields remain authoritative across both backends.

This is an opt-in experiment; existing vehicles use TypeScript by default.
The existing C/Wasm experiment in tools/structural-wasm is retained as a
separate control.

## Use

    rustup target add wasm32-unknown-unknown
    cargo test --manifest-path kernels/world-structure/Cargo.toml
    cargo build --target wasm32-unknown-unknown --release --manifest-path kernels/world-structure/Cargo.toml
    bun run build
    node --test test/structure-rust-wasm.test.mjs
    node tools/world-structure/benchmark.mjs

    import {createWasmStructuralBody} from '@rom4/game-engine';
    const bytes=await fetch('/wasm/world_structure_kernel.wasm').then(r=>r.arrayBuffer());
    const program=await WebAssembly.compile(bytes);
    const body=await createWasmStructuralBody(definition,program);
    body.activateFromRigid(body.centerOfMass(),[0,0,0],[0,0,0]);
    body.step(1/120,[0,-9.81,0]);
    body.detachKernel();  // explicitly copies state back once, releases Wasm

There is one Wasm instance per active structural body, no per-tick buffer
copy, and a single exported Rust solver call per no-projector physical tick.
Static structural contacts can be compiled with the same Rust solver, avoiding
per-iteration JavaScript callbacks and extra node copies:

    const body=await createWasmStructuralBody(definition,program,{
      staticContacts:{boxes:[{id:'wall',center:[1,0,0],half:[.5,1,2]}]}
    });
    body.step(1/120,[0,-9.81,0]);
    console.log(body.nativeContactStats); // contact count, penetration, deepest box

The compiled contact plan uses the existing definition.collisionTriangles:
barycentric triangle samples followed by unique sorted vertex samples, with
the same crossing-face preference and inverse-mass projection as
StructuralStaticContactSolver. It is built before buffer views are attached,
so no WebAssembly memory growth can detach active arrays during a tick.

Arbitrary external contactProjector callbacks remain supported but fall
back to the original TypeScript projection/XPBD step on the same Rust-owned
buffers. The benchmark records this fallback separately; it is not a claim
of contact acceleration.

In particular, this does not change PhysicsWorld rigid collision solver.
The combined PhysicsWorld + M3 test uses *independent* probe rigid bodies
to measure all-tick costs without duplicating the mass of the same vehicle.
It is not a claim of end-to-end M3 collision accuracy or game FPS.

Numerical compatibility gates compare every material rest length, position,
velocity, original state, plastic work, broken constraint, tick, and dormancy
across 240 fixed 1/120-second steps, with impulses and thermal changes.
The strict budget is abs 1e-9 plus rel 1e-10; fracture and bake transitions
must match exactly. Physical coefficients are never retuned for Rust.

## Engine boundary

- Rust owns contiguous SoA buffers in per-instance WebAssembly memory.
- Engine owns render/geometry, mass/handoff, contact policy, lifecycle, and
  immutable validated StructuralDefinition.
- No JS FFI calls inside Rust's 10 XPBD iterations for the fast path.
- The wasm module imports JavaScript Math.hypot, Math.pow and Math.exp to
  retain the reference floating-point contract. Import costs are measured.
- Detach is an explicit one-time copy back to self-owned TypedArrays so the
  body remains usable after Wasm memory is freed.
- No implicit fallbacks or hidden physical coefficient changes.
- Compiled box/triangle structural contact projection runs in Rust between
  the identical XPBD phases, before strain capture and after every sweep.
- Arbitrary user-defined projector callbacks remain on the JS fallback path.

The GitHub Actions artifact contains the compiled wasm and benchmark JSON.
Treat benchmark ratios as workload-specific, not universal.
