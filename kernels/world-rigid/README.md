# World rigid Rust/WASM collision backend (opt-in)

This extends the Rust World execution path from structural XPBD to **rigid–rigid**
collisions, including two moving rotated car chassis (OBB–OBB), spheres and
sphere/box pairs. Geometry, wake/sleep, material fracture decisions, force drivers,
fluid coupling, broadphase order and causal trace ownership remain with
`PhysicsWorld`.

This is deliberately opt-in until the full-world, contact-heavy benchmark
demonstrates an advantage. The module is called synchronously in the sequential
contact loop; each candidate has a fixed 2×32-f64 scratch record plus a
small output record, not a per-body Rust allocation or a second world state.
Therefore the C++/WASM "zero-copy whole-world" claim would be false: the
authoritative bodies remain in JavaScript, and the fixed scratch is refreshed
for each narrowphase candidate. The renderer and public collision shape
contracts are unchanged.

## Use

    rustup target add wasm32-unknown-unknown
    cargo test --manifest-path kernels/world-rigid/Cargo.toml
    cargo build --release --target wasm32-unknown-unknown --manifest-path kernels/world-rigid/Cargo.toml
    bun run build
    node --test test/rigid-wasm.test.mjs
    node tools/world-rigid/benchmark.mjs

    import {PhysicsWorld,createWasmRigidContactKernel} from '@rom4/game-engine';
    const bytes=await fetch('/world_rigid_kernel.wasm').then(r=>r.arrayBuffer());
    const kernel=await createWasmRigidContactKernel(bytes);
    const world=new PhysicsWorld();
    world.setRigidContactKernel(kernel);
    // add moving car chassis, drive world.step(...) as usual
    // world.setRigidContactKernel(null); kernel.dispose() at teardown

JS evaluates contact-specific material decisions with its original callback.
An actual fracture, penetration or energy-loss decision continues through the
original TypeScript resolution routine. When causal tracing is enabled,
collision calculations use the complete existing TS path so detailed energy
provenance is unaffected. Static horizontal surfaces/ground manifolds also
remain the existing solver.

The Rust narrowphase keeps the original box SAT axis order and sphere-box
inside-face rules. The impulse kernel corrects position and applies normal
and friction impulses at the actual world contact point, with angular impulse
using world-space inverse inertia.

CI compares complete `PhysicsWorld` states, per-step contact records, angular
momentum and determinism against the original engine over real-time collision
scenarios (head-on moving chassis, offset impacts, rotated OBB, sphere/box,
material fracture, causal trace). A benchmark measures *full step cost* at
different numbers and densities, separately from the Rust math kernels.
No coefficient tuning is permitted to make the two paths agree.

The optional Rust implementation is not a replacement for the broadphase,
the ground manifold solver or user-supplied collision plugins. It is also
not a native GPU compute solver: CPU→WASM scratch exchange still costs work.
