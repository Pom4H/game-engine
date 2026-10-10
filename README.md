# Game Engine Core

> Development model: **one active branch — `main`**. Gameplay is frozen until rendering, networking, audio and physics gates are complete. See [docs/ENGINE_FIRST.md](docs/ENGINE_FIRST.md).

A single TypeScript package for deterministic scenes, WebGPU rendering, rigid and structural physics, procedural vehicles, synthesized audio, and character movement. It has no JavaScript runtime dependencies.

[![Domain complexity map](docs/domain-complexity.svg)](docs/DOMAIN_COMPLEXITY.md)

The architecture is organized around one causal source of truth. See [the domain complexity map](docs/DOMAIN_COMPLEXITY.md), the [causal render contract](docs/CAUSAL_RENDER_CONTRACT.md), and [server authority](docs/SERVER_AUTHORITY.md).

## Build and check

```sh
bun install --frozen-lockfile
bun run build
bun run check
```

The package exports simulation and scene APIs from `src/index.ts`, and `BrowserRuntime` plus `WebGPURenderer` from `src/browser.ts`. Browser rendering requires WebGPU. `BrowserRuntime.create(canvas, scene, {audio: true})` creates the renderer and fixed-step simulation; call `resume()`, `pause()`, `step()`, or `dispose()` as needed. Audio starts after `activateAudio()` from a user gesture.

A scene is validated data (`SceneSpec`). `Scene` can run without a browser for deterministic simulation. `PhysicsWorld` handles rigid contacts. Vehicle geometry comes from `compileVehicle` and the passenger, pickup, and M3 definitions. `AnimationSystem` owns walker and wheel transforms. `WalkWorld` supplies bounded static obstacle and camera queries; `BrowserRuntime.controlWalker(id, {world})` connects keyboard, pointer and touch input to an authored walker.

Source code lives in `src/`; focused tests live in `test/`. Build output in `dist/` is generated and ignored.


## Infinite world streaming

The engine has a transport- and game-independent infinite-world boundary.
VisibilityInterest turns one camera/observer into a bounded, non-overlapping
quadtree of tile demands. Close terrain uses 128 m base tiles; distant terrain
automatically becomes coarser. Altitude increases the apparent horizon, so an
aircraft can see tens or hundreds of kilometres without asking the generator for
millions of near-detail chunks.

InfiniteWorld owns bounded asynchronous generation, residency, cancellation,
installation and eviction. The application owns tile meaning.

Render visibility is deliberately independent from physics and gameplay simulation
interest. Seeing a mountain 100 km away does not activate its collision bodies,
NPCs, economy or other detailed simulation.

See docs/INFINITE_WORLD.md.

## Rust World compiler (ahead of time)

The experimental `worldc` compiler converts `.world` declarative scenes into a
fixed-layout `.wscn` binary with SI units and stable entity IDs. It compiles
**before** execution; scene loading hydrates the existing `SceneSpec` and
preserves the engine's physics/render hot path. The v0.2 authoring prototype adds typed constant folding, dimension-checked
expressions, and compile-time indexed entity expansion on top of the v1 binary
ABI. It remains an intentional subset of TypeScript scene authoring.

```sh
cargo test --manifest-path compiler/Cargo.toml
cargo run --manifest-path compiler/Cargo.toml -- compile examples/worlds/collision.world
```

Read [compiler/README.md](compiler/README.md) for the language, binary ABI,
and `sceneFromURL` integration. Opt-in `performance {tick_budget:5ms;
sample_every:5; history:120}` profiles CPU system costs and budget exceedances.
Run `bun run world:profile` to produce a causal CPU performance JSON report.
The precompiled direct scheduler is the built-in fast path. Custom modules use
the original KernelProgram, and `scene.setSystemDispatch('kernel')` can force it
for parity and runtime comparisons. `decodeWorldBinary()` is exported by both the
core and browser packages.

## Rust/WASM real-time acoustic kernel

The production staggered FDTD acoustic wave solver has an optional Rust/WASM backend.
Its physical state resides directly in persistent WASM f64 buffers: no per-tick state
marshalling, one numerical call per step, original CFL/geometry semantics, and
pressure-slice staging for WebGPU r32float uploads. TypeScript remains the default
until the measured workload warrants enabling WASM. See
[kernels/world-wave/README.md](kernels/world-wave/README.md) for build, use,
parity gates and benchmark evidence.

## Rust/WASM structural XPBD (opt in)

Validated `StructuralBody` can specialize its active XPBD numerical loop with a
Rust WebAssembly kernel, preserving node arrays, strain/plasticity/fracture and
rigid bake. Existing JS path is still the default; user-defined contact
projectors fall back to the JS solver on the same Wasm memory. End-to-end tests
and whole-physics-tick measurements are in
[kernels/world-structure/README.md](kernels/world-structure/README.md).

## Optional Rust/WASM rigid collision kernel

`PhysicsWorld.setRigidContactKernel(await createWasmRigidContactKernel(wasm))`
accelerates (when measured faster) rigid sphere/box narrowphase and sequential
point impulse resolution for moving bodies, including rotated OBB car chassis.
Broadphase, contact order, force drivers, material decision callbacks, static
floor manifolds and causal traces remain engine-owned. It is **opt in** because
per-pair JS↔WASM scratch transfers can be slower than pure JS on sparse scenes.
See [kernels/world-rigid/README.md](kernels/world-rigid/README.md) and its
numerical parity and full-world tick benchmarks in GitHub Actions.

## Emergent execution contract

Acceleration is not a replacement for the engine's causal world model.
The opt-in Rust rigid backend now supports ordered per-body contact batches,
with strict fallback for fracture/deformation callbacks, causal traces,
static road manifolds and oversized candidate sets. See
[docs/EMERGENT_EXECUTION.md](docs/EMERGENT_EXECUTION.md) for the complete
weather → surface → forces/contacts → fracture/deformation →
commit/events → audio/render/network contract and its CI parity gates.

A certified inert-contact subset of the built-in Scene material law can also
use the Rust batch without disabling material/fracture/audio systems; the
contract must be updated whenever contact material logic changes.

## World Interaction IR (causal cross-domain contract)

Opt-in `Scene.enableWorldInteractions()` captures immutable, bounded interactions
from the authoritative weather, rigid contact, material/fragmentation event and
surface-work commits. Interaction parents link actual contacts to emitted audio
and fracture events. No interaction can drive a second physical world or mutate
the render/audio/network projections. `projectSceneRenderFrame(...,
{includeInteractions:true})` optionally includes one content-addressed `graph`
resource; `eventsFromWorldInteractions` reuses exactly the committed audio events.
See [docs/WORLD_INTERACTION_IR.md](docs/WORLD_INTERACTION_IR.md).

## Rust World v3: type-checked causal connections

World source files can declare a bounded dimension-checked coupling DAG
connecting physics, sound, material, thermal, water, acoustic and NPC signal
ports. The WSCN v3 extension is pure static metadata with no per-tick DSL
interpreter. Only actual committed impact/fracture effects are linked at
runtime; unimplemented links stay declarative. See
[docs/WORLD_COUPLINGS.md](docs/WORLD_COUPLINGS.md).

## Agent Office: toy-brick observability

`bun run office:demo` opens a WebGPU toy-brick office with deterministic causal replay; `bun run office:live` accepts real observed facts through the loopback API. Codex app-server notifications can be normalized with `CodexActivityAdapter` without exposing prompts or reasoning. See [docs/AGENT_OFFICE.md](docs/AGENT_OFFICE.md).

## Self-hosted GPU render without GitHub Actions

On our Windows/Linux GPU worker, run `node tools/agent-office/render-on-worker.mjs` in an up-to-date checkout. The command renders and verifies the real Agent Campus 1080p/24fps H.264 file using hardware WebGPU; `--publish` optionally uploads it to a private prerelease. See [Agent Campus](docs/AGENT_CAMPUS.md).
