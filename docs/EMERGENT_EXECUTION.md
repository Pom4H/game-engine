# Emergent World execution: what must survive acceleration

The engine is a **coupled physical world**, not a collection of animation
effects. A faster numerical kernel may replace an implementation of a law,
but it may not change what causes, owns or observes persistent state.

## Authoritative causal path

```text
World source (.world) / SceneSpec / World IR
                  |
             Scene/kernel scheduler (domain depth + phases)
                  |
 weather/history --> surface phases (snow/water/ice/temperature)
                  |               |
      vehicles/agents/controls     |    fluids / soil / wind / air
                  \               |           /
                   \              v          /
                    PhysicsWorld + contacts
                     |       |           |
              fracture     plastic       wheel / surface contact work
                 |        deformation    |
                 +-----------+-----------+
                             |
                      commit events + world state
                        /       |         \
                 audio/waves  Render IR   network authority
                              GPU/probes   causal storage
```

Physical contact is an **interface between domains**, not the exclusive
owner of mechanics, sound, weather, visuals, gameplay or network state.

- `Scene` schedules all built-in systems and plugins through
  `src/scene/modules.ts`; accelerator selection must never short-circuit the
  scheduler or its input/simulate/commit phase ordering.
- `PhysicsWorld` owns the body state and the actual contact chronology.
  External force drivers (wheels, engine, aero), fluids, terrain, environmental
  friction and wind contribute to that state through the engine-owned APIs.
- `evaluateFracture` and `deformation.absorbContact` observe contacts before
  impulses are committed. Their decision can change *material, geometry,
  fragmentation and emitted events*. It cannot be guessed beforehand.
- `SurfaceEnvironmentSystem` tracks heat, snow, water, ice, compaction,
  friction, wetness, debris and persistent surface fields. Its state reaches
  wheels and causal surface observations; renderer detail does not redefine it.
- Audio may synthesize from the actual impact/fracture event stream or use the
  shared physical wave/acoustic boundary. No duplicated collision/audio
  simulation is introduced.
- `CausalRenderObservation` exports physical and visual geometry separately.
  Render IR, GPU/WebGPU, Meshwork and neural/NPU projections cannot mutate
  authoritative physics or create "fake" persistent surface data.
- Network commits, content-addressed storage and deterministic replay remain
  separate from executor choice.

## Rust/WASM rigid batching (opt-in)

The Rust batch is explicitly **one current A body against its ordered
distinct B broadphase candidates**. The TypeScript engine still rebuilds its
spatial index, obtains B from the existing `SpatialHash.near`, deduplicates
physical pairs, and invokes Rust once per A. Rust processes all B sequentially
using its internally updated A state, returns the exact contact order and
mutates each engine-owned body array **after** its A batch completes.

This is safe because the solver sees the same B candidates and intermediate A
changes as the TypeScript loop; subsequent A queries happen **after** the Rust
batch commits. The batch contains only rigid normal/tangent impulse resolution.
It does not batch the entire simulation tick.

Batching is forbidden whenever one of these holds:

1. **A contact callback is present.** Custom fracture/deformation/material
   laws can affect other parts of the world or future contacts, so each contact
   must be observed before the next one is calculated. The previous synchronous
   Rust per-pair path is used instead.
2. **Causal tracing is enabled.** The engine's complete TypeScript energy and
   attribution path is used, with no missing impulse provenance.
3. **A finite horizontal static surface is a possible candidate.** The
   manifold solver owns ground/road contacts, friction, sleep and causal
   bookkeeping; that A uses the existing sequential collision path.
4. **The candidate set exceeds 256.** This A falls back to per-pair processing.
   The fixed Wasm buffer is bounded; no mid-tick growth/detachment is allowed.

An entity with `renderOnly` geometry never creates a collider. A runtime
`Scene` currently always supplies the material contact callback: its
contacts **remain sequential**. Do not make scenes use the pure-rigid batch
by deleting the callback or pre-applying material decisions. The batch is
for callers who intentionally use `PhysicsWorld` without a material policy.

## Inspection and validation

`PhysicsWorld.rigidContactDiagnostics` exposes:

```ts
{
  backend, calls, candidates, contacts, serialPairs,
  policyFallbacks, traceFallbacks,
  staticSurfaceFallbacks, capacityFallbacks
}
```

These counters report *what actually executed*, not claimed speedups.
Reset is explicit via `PhysicsWorld.clear()`. They are diagnostic and
do not feed back into physics or into the scheduler.

The CI gates must cover all layers:

- Native Rust unit tests and JS/Rust replay with multiple moving boxes,
  spheres, angular impulses, sequential dependent pair contacts and sleepers.
- A material/fragmentation scene with snow, rain/water, wind and fluid;
  compare physical state, event identity, surface temperature/wetness, sound,
  causal Render IR, acoustic boundaries and simulation-system execution.
- The same trace and energy-closure oracle without using the native contact
  solver while tracing.
- A full-physics-tick benchmark contrasting original TypeScript, serial Wasm
  and per-A batched Wasm. Include dense and sparse worlds and the material
  callback fallback (the latter intentionally does not batch).

**No cross-domain correctness claim can be inferred from faster microkernels.
No entire-engine FPS claim is made without a complete render/physics run.**
