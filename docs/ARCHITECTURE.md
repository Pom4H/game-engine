# Architecture

The authoring boundary is a serializable `SceneSpec`; runtime state belongs to
`Scene`. `validateScene` validates before construction and `Scene.add` validates
individual entities before insertion. GPU handles and executable modules are not
part of SceneSpec.

## Execution and module contract

`Scene.step` runs `EngineKernel` with a detached data context and a command reducer.
The default composition is in `src/scene/modules.ts`:

```
input:    weather → unified surface/environment state
plan:     application modules
simulate: animation → physics
commit:   surface contacts → contact events → fracture → cleanup → clock
publish:  application observers
```

Modules declare ID, phase, cadence, resource reads/writes and optional `after`
dependencies. Built-ins use the same mechanism: weather runs at 10 Hz,
surface/environment evolution at 30 Hz, while local animation/rigid contacts remain
60 Hz. The kernel passes each due module its accumulated physical delta, so lowering
cadence changes compute frequency without slowing physical time. The scheduler
validates the graph, rejects same-phase ambiguous hazards, topologically orders
modules and caches due-rate plans. Stable IDs only
break ties between independent modules. Dependencies do not force a slower module
to run on an off-cadence tick.

Simulation tiers are operational rather than descriptive. `detailed` runs the full
local stack, `active` keeps animation/physics but skips high-detail surface-contact
geometry, `aggregate` keeps coarse environment evolution without rigid-body
integration, and `dormant` advances only low-frequency world/cleanup state and time.
`Scene.step(dt, tier)` selects the tier; the default remains `detailed`.

Each batch consumes a detached, recursively frozen DTO snapshot. Normal Map and
Set mutators are disabled. Command-producing batches call the reducer before the
next batch receives a new snapshot. The default modules emit system commands. `SceneSystemRuntime` maps those commands
to concrete built-in implementations, so scheduling/resource dependencies and
system implementation are separate concerns. `Scene` remains the aggregate owner
of entity state and exposes subsystem state without embedding the scheduler switch.
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
resource names are `environment`, `surface-state`, `entities`, `animation`,
`contacts`, `surface-contacts`, `events`, and `time`; use an explicit
`after: ['engine:physics']` for a conflicting simulate
module. The kernel API without a reducer still returns commands to its caller,
but cannot make those commands visible to later modules in that run.

## Physical and environmental state

Material identity is data, not a renderer or physics switch. Each `PhysicalMaterial`
publishes mechanical, thermal, optical, acoustic and surface properties. Fracture,
thermal response, default PBR projection and contact acoustics consume those
properties directly. Material names may select specialized microstructure shading,
but they must not own physical laws.

The backend has sphere/rotated-OBB contact, angular rigid-body motion with approximate
box/sphere inertia, friction, restitution, spatial hashing and horizontal support
manifolds. Horizontal surfaces invoke the same material failure law as other
contacts. Dynamic fragments share the authored parent mass and inherit linear and
angular momentum; random scatter has a bounded energy allocation and zero net
momentum. Polygon-prism render geometry still uses approximate collision inertia.

`SurfaceEnvironmentSystem` owns bounded physical state grids on exposed surfaces.
Snow, water, ice and slush are phases of one surface state rather than separate
engine systems. Wetness, moss, dirt, wear, roughness, acoustic damping and darkening
are projections of that same evolving record rather than a second renderer-owned
surface state. The same state is the extension point for mud, dust and additional
material/environment consequences. Supported contact work updates
only cells under the footprint; unsupported motion contributes no work. Bound
wheels claim their contact bodies and publish one localized `SurfaceContactWork`
record derived from normal load, contact radius, rolling speed, lateral velocity
and slip. That same work drives local heat, track melt, dirt, spray and subsequent
friction; claimed wheels are excluded from the coarse body-footprint fallback so
the cause is never counted twice. Physics, rendering and audio consume the same
state instead of maintaining parallel weather interpretations. The current
contact-work/thermal model is an approximation, not a calibrated tyre or soil model.

## Animation and surface contact ownership

`SceneSpec.animation` stores walker rigs and kinematic vehicle-part bindings;
`SceneSpec.surfaceContacts` stores deformable-snow surfaces and wheel contacts.
These are validated, serializable descriptions, not per-frame callbacks. Scene
construction restores them, including after a URL roundtrip or browser reset.
The engine never needs the winter demo, its actor IDs, asset paths or street layout.

`AnimationSystem` owns gait timing, world-space stance anchors, ground queries,
two-bone IK, part transforms and wheel rolling. It publishes immutable poses and
foot contacts. Kinematic physics bodies receive target velocities and are
integrated once by physics; dynamic bodies cannot also be animation-driven.
Model geometry, clothing, rig bindings and route parameters remain authored data.
The current route animation is not a vehicle dynamics or character-navigation
controller, and the clothing generator is not a dynamic cloth solver.

After physics, `SurfaceContactSystem` samples the actual surface footprint and
water/snow state. It owns boot compression, retained footprint records, adaptive
snow meshes and bounded ballistic wheel spray. The same foot-contact timestamp
drives the persistent depression and the snow-crunch sound. Surface geometry is
updated in engine-owned tiles with explicit detail/record/particle budgets.
Generated entities are tracked by object ownership rather than an ID-prefix
claim over authored objects. Removing source entities releases dependent state.

The browser audio layer consumes native foot-contact events and local wheel
wetness. Offline audio uses those same contact records with camera telemetry for
spatialization. Camera paths, editing, captions and music remain movie tooling.
See `tools/promo/README.md` for the full winter-scene boundary and limitations.

## Renderer ownership

`WebGPURenderer` currently consumes concrete Scene state: entities, camera,
environment and unified surface state. It renders opaque/transparent procedural geometry, lights
and snow. Each frame reconciles cache ownership against current entity IDs and
primitive keys. Removed object uniforms and field textures are destroyed; meshes
remain only while a live entity references their primitive key. `dispose` releases
all remaining resources. Inspection counts handles, not driver memory bytes.

Material texture descriptors contain only asset URLs, world scale and strengths.
The renderer owns asynchronous loading, mipmapped GPU textures, triplanar
sampling, bump detail and cancellation on disposal. `prepareMaterials(scene)`
allows deterministic capture to wait for assets; normal rendering also discovers
newly spawned textured materials. Removed assets are released after reconciliation.

The lighting path uses a bounded world-space light grid (256 sources, 16 per
cell), directional shadows, contact occlusion, planar and screen-space
reflections, HDR/MSAA and filtered bloom. These are reusable renderer systems;
the scene supplies only materials, light placement and settings. Off-screen
reflection and lighting remain approximate; there is no ray-traced global
illumination or proof of real-time performance in an offline movie.

## Determinism and automation

Fixed-step execution and seeded fracture generation make equal runs reproducible
within the same runtime. Cross-runtime floating-point values can differ slightly.
`FixedClock` retains bounded timer debt for realtime use; offline capture advances
explicit simulation ticks. Scene snapshots are diagnostic DTOs, not complete
checkpoints for restoring the physics/surface/event state.

The browser exposes `window.__GAME_ENGINE__` with snapshot, pause, resume, step,
seek, setCamera, render, flush and inspect. The CLI and comparison recorder use
Chrome DevTools Protocol. The recorder calls production Scene/kernel/renderer
code and persists event and measurement logs; see `tools/comparison/README.md`.

## Target dependency direction

The architectural rule is consequence-driven:

```
SceneSpec + gameplay intent
        ↓
EngineKernel (schedule/resource graph)
        ↓
SceneSystemRuntime (system implementations)
        ↓
material + geometry + environment + contact work
        ↓
SurfaceEnvironmentSystem / Physics / Animation
        ↓
friction + deformation + events + audio signals + render state
        ↓
WebGPU renderer / browser / CLI / CI
```

No renderer branch is allowed to become the authoritative owner of a physical
fact. Snow, wetness, dirt, moss or wear may change shading, but their physical
meaning is produced upstream. Conversely userland authors semantic materials and
environmental intent, not WGSL branches or low-level contact response.
