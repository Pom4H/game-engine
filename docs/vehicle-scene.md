# Vehicle in Scene: one damage field, multiple consumers

`spawnVehicle` connects the Vehicle runtime to the existing Scene, renderer and
energy-budgeted PlasticDeformationSystem. It does not add a physics world or solver.

```ts
import {spawnVehicle} from '@rom4/game-engine/vehicles/scene';

// blueprint: vehicle(id, {chassis, parts: [...wheels, ...wings]})
// geometry: existing VehicleCompiler output (body, glass, tyres, rims)
const instance = spawnVehicle(scene, blueprint, geometry, {
  modelOriginM: [0, .75, 0], // chassis origin in this authored geometry
  position: [0, .75, 0],
  damage: {skinThicknessM: .0008, radiusM: .45, maxDentM: .4},
});
instance.vehicle.setControls({throttle: 1});
scene.step(1 / 60); // physics, damage and final-pose visual projection
instance.dispose();
```

A wing's optional `mountAt` specifies its chassis-local attachment, separately from
its aerodynamic centre `at`. Both shift to COM coordinates when constructing a
runtime. A damaged attachment moves/rotates the lifting surface, changing local
flow, incidence and the resulting body wrench. A dent can decrease OR increase
lift depending on orientation; it is not another arbitrary health multiplier.

## Shared derived state

`DeformationField { revision, sample(rest, out) }` is a narrow read-only shape
contract. The physical owner advances it. The existing plastic field and mesh
vertices now use the same deformation kernel. No renderer-specific damage state
is fabricated. This interface can later consume a nodal solver's published shape;
that adapter/coupled solver is NOT implemented in this change.

Each physical attachment samples its material patch seven times per shape revision,
not every substep or per consumer. Its finite-difference frame is rigidized by
Gram-Schmidt: denting a mount does not stretch an intact wing's area. Collapsed or
inverted patches disable support/lift while retaining finite last-known orientation.
Failed samples do not commit a revision or poison the cache.

The same local chord/normal/position serves aerodynamics and wing mesh generation.
Unchanged wings reuse their mesh while the vehicle moves. Tyre wear changes the
rubber's radial scale using effectiveRadiusM; the rim never shrinks. Wheel rotation
and mount direction use the same physical state. No wheel mesh regeneration in
this wear projection (rubber scaling remains an approximation of bead geometry).

Part views expose frozen getter vectors, not writable simulation arrays. Reads
neither allocate a new snapshot nor advance wear/fatigue. The reported frame and
force belong to the latest force evaluation; damage/condition feedback is explicit
at the next physical substep, not an extra hidden solve during rendering.

## Scene ownership

Scene owns the one rigid chassis including lumped attached masses. Vehicle adopts
that body after validating ownership and dimensions; it does not register another.
Geometry entities use `collision: 'none'` to avoid implicit static glass colliders.
This flag cannot be mixed with body/environmental physics declarations.

`Scene.project` registers final-state projections outside the physical integrator.
It does not register one kernel per car. Mover IDs include the projection's visuals.
Removing the root disposes its force driver/projection and exact owned entities;
replacements with reused IDs survive. Removing one skin visual does not destroy the
physical damage field. Scene/BrowserRuntime disposal/reset release old projections.

## Reproduction and acceptance

```sh
bun run check
bun run harness:vehicle-scene
# On a machine with Chrome and WebGPU (CHROME_PATH may be needed):
node tools/vehicle-scene-render.mjs
```

The harness uses real collider damage, then compares cached/recomputed fields under
the same Scene workloads. It keeps f64 state hashes, skin and wing hashes, work
counts and all 11 alternating paired timing samples after four warmups. Construction
is outside timing. Physical work/collisions are not reduced to obtain a speedup.
Snapshots are captured from Scene entities after simulation, then rendered by the
existing WebGPU harness. CPU/GPU rendering time is not part of the Scene benchmark.

## Limits

This connects the EXISTING reduced plastic-contact layer, not the fully coupled
node/beam/triangle solver from thegame #82/#89. Mass/COM/inertia remain the existing
lumped approximation during mount deformation. The mount is a geometry projection,
not an elastic joint or detachable multibody link. Wings still do not add collision
volumes; support remains the horizontal plane. The plastic field retains its
existing bounded dent history. No claim of BeamNG superiority, complete fatigue,
thermal/carcass simulation, arbitrary terrain, or automatic vehicle engine audio.

The prototype wheel-role mapping in the scene adapter consumes the current legacy
flat geometry IDs at this boundary only. It is not a second domain ontology.
