# Architecture

The authoring boundary is a serializable `SceneSpec`; runtime state belongs to
`Scene`. `validateScene` validates before construction and `Scene.add` validates
individual entities before insertion. GPU handles and executable modules are not
part of SceneSpec.

## Execution and module contract

`Scene.step` runs `EngineKernel` with a detached data context and a command reducer.
The default composition is in `src/scene/modules.ts`:

```
input:    weather → winter surfaces
plan:     application modules
simulate: physics
commit:   contact events → fracture → cleanup → clock
publish:  application observers
```

Modules declare ID, phase, cadence, resource reads/writes and optional `after`
dependencies. The scheduler validates the graph, rejects same-phase ambiguous
hazards, topologically orders modules and caches due-rate plans. Stable IDs only
break ties between independent modules. Dependencies do not force a slower module
to run on an off-cadence tick.

Each batch consumes a detached, recursively frozen DTO snapshot. Normal Map and
Set mutators are disabled. Command-producing batches call the reducer before the
next batch receives a new snapshot. The default modules invoke Scene's internal
services through commands; Scene remains the owner of physics and entity state.
There are no concurrent workers or arbitrary plugin isolation guarantees.

```ts
scene.use({
  id: 'game:drive', phase: 'plan', rateHz: 30,
  reads: [], writes: ['entities'],
  run: () => [{type: 'velocity', id: 'actor', value: [2, 0, 0]}],
});
```

Public scene commands are `spawn`, `remove`, `velocity` and `resource`. A publish
observer can read committed resource values from `context.resources`. Built-in
resource names are `environment`, `winter`, `entities`, `contacts`, `events`, and
`time`; use an explicit `after: ['engine:physics']` for a conflicting simulate
module. The kernel API without a reducer still returns commands to its caller,
but cannot make those commands visible to later modules in that run.

## Physical and environmental state

The backend has sphere/AABB contact, angular rigid-body motion with approximate
box/sphere inertia, friction, restitution, spatial hashing and horizontal support
manifolds. Horizontal surfaces invoke the same material failure law as other
contacts. Dynamic fragments share the authored parent mass and inherit linear and
angular momentum; random scatter has a bounded energy allocation and zero net
momentum. Polygon-prism render geometry still uses approximate collision inertia.

Winter fields use bounded grids on the existing horizontal, axis-aligned surfaces.
Supported sliding work updates cells under the body footprint; unsupported motion
does not. Each cell integrates snow, water, ice, slush and heat. The renderer and
horizontal friction query those cells. The work/thermal model is an approximation,
not a calibrated tire model. Aggregate surface values remain available for older
consumers and diagnostics.

## Renderer ownership

`WebGPURenderer` currently consumes concrete Scene state: entities, camera,
environment and winter. It renders opaque/transparent procedural geometry, lights
and snow. Each frame reconciles cache ownership against current entity IDs and
primitive keys. Removed object uniforms and field textures are destroyed; meshes
remain only while a live entity references their primitive key. `dispose` releases
all remaining resources. Inspection counts handles, not driver memory bytes.

## Determinism and automation

Fixed-step execution and seeded fracture generation make equal runs reproducible
within the same runtime. Cross-runtime floating-point values can differ slightly.
`FixedClock` retains bounded timer debt for realtime use; offline capture advances
explicit simulation ticks. Scene snapshots are diagnostic DTOs, not complete
checkpoints for restoring the physics/winter/event state.

The browser exposes `window.__GAME_ENGINE__` with snapshot, pause, resume, step,
seek, setCamera, render, flush and inspect. The CLI and comparison recorder use
Chrome DevTools Protocol. The recorder calls production Scene/kernel/renderer
code and persists event and measurement logs; see `tools/comparison/README.md`.
