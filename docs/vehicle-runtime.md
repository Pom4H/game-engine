# Vehicle: executable parts, one physical body

This is a first **reduced-order** vehicle runtime, stacked on the vehicle-domain
geometry API. It does not replace the existing structural solvers or import a second
simulation. `PhysicsWorld` owns time, adaptive substeps, gravity and pose integration.
`Vehicle` contributes a world-space force/torque sum at each physical substep.

```ts
import {PhysicsWorld} from '@rom4/game-engine';
import {Vehicle,vehicle,wheel,wing} from '@rom4/game-engine/vehicles/runtime';

const suspension = {restM: .5, travelM: .25, springNPerM: 35000, damperNsPerM: 3200};
const wheels = [-1.4,1.4].flatMap(x => [-.8,.8].map(z => wheel(`wheel.${x}.${z}`, {
  at: [x,0,z], massKg: 20, radiusM: .346, widthM: .30, suspension,
  driveTorqueNm: x < 0 ? 2400 : 0, drivePowerW: 140000,
  brakeTorqueNm: 2000, steerRad: x > 0 ? .5 : 0,
  condition: {wearEnergyJ: 2e7, heatCapacityJPerK: 20000},
})));
const wings = [-1,1].map(side => wing(`wing.${side}`, {
  at: [0,0,side*2.8], massKg: 25, spanM: 4, chordM: 1.6,
  incidenceRad: .2, zeroLiftRad: 0,
}));
const blueprint = vehicle('car-with-wings', {
  chassis: {massKg: 1500, sizeM: [4.8,.65,1.9], dragAreaM2: .75},
  parts: [...wheels, ...wings],
});
const world = new PhysicsWorld();
const instance = new Vehicle(world,blueprint,{position:[0,.75,0],velocity:[60,0,0]});
world.step(1/120); // exactly one mass, one clock, forces applied at their actual points
const tire = instance.part('wheel.-1.4.-0.8'); // borrowed readonly live view
console.log(tire.effectiveRadiusM,tire.slipPowerW,tire.wear,tire.treadDepthM);
instance.dispose();
```

Removing `...wings` changes the construction, not a car/plane enum. The extra wing
mass is counted. Their finite-wing polar responds to local relative velocity,
including angular point velocity and wind, then feeds the SAME rigid integrator.
Lift is perpendicular to local flow; drag does nonpositive work against that flow.
Low speed, zero air density or spanwise flow cannot manufacture lift.
Attached wheels provide no airborne thrust. A wheeled body with enough authored
lifting area can therefore take off and glide without changing runtime class.

A spoiler is the same `wing()` primitive with `control: 'spoiler'` and an authored
hinge direction through `controlGainRad`. The runtime does not inject "downforce".
The surface rotates into the local relative airflow and the ordinary aerodynamic
solver produces its lift/drag. A moving car in still air and a stationary car in the
opposite wind therefore produce the same spoiler force; co-moving air produces none.

## Cause graph / proof mode

Physics provenance is opt-in and does not allocate records in normal runs:

```ts
const trace = world.traceCauses({runId: 'winged-car-ci'});

// Existing and later attached drivers declare stable components/laws automatically.
// Every force/torque produced while tracing must close against those contributions.
world.step(1 / 120);

await writeFile('trace.jsonl', trace.toJSONL());
console.log(trace.proof);
world.stopCauseTrace(trace);
```

A custom force driver gets the same small API. It declares causes once, then writes a
matching contribution whenever it changes its public wrench:

```ts
const thrust = physicsCause('thruster', 'constant-thrust.v1', 'other', ['force', 'torque']);

const driver = {
  maxStepSeconds: 1 / 120,
  force: [4, 0, 0],
  torque: [0, 0, 0],

  declareCauses(manifest) {
    manifest.component({componentId: 'thruster', bodyId: body.id, kind: 'other', parentComponentId: body.id});
    manifest.law(body.id, thrust);
  },

  evaluate(_dt, causes) {
    causes?.contribute(thrust, {kind: 'internal', id: 'demo.thruster'}, {
      forceN: this.force,
      torqueNm: this.torque,
    });
  },
};
```

Proof mode is intentionally strict: once a body first evaluates, its component/law
manifest is sealed. If the driver's resulting wrench differs from the sum of recorded
contributions by more than numerical tolerance, the substep throws instead of
producing an incomplete trace. `PhysicsWorld.integrate` is recorded as the state
writer. JSONL uses `cause-trace` schema version `1.0`; component IDs are scoped by
`body_id`, so multiple identical assemblies may keep local IDs such as
`front.left` and `wing.left`.

The CI liftoff proof starts tracing immediately before wing deflection. It requires all
manifest records to precede the first traced substep, verifies exact wrench closure,
then checks that the first airborne frames remove `wheel-contact.v1` contributions
without adding any new law. The only recorded state writer remains
`PhysicsWorld.integrate`.

## Ownership and reuse

* `vehicle()` compiles an immutable source snapshot: total mass, COM, diagonal
  inertia approximation, COM-relative part offsets, area, aspect ratio, finite-wing
  slope, induced drag and wheel inertia. Source author objects are not frozen.
* Every instance owns its wheel state and `PartCondition`; blueprints are shareable.
* One f64 orientation basis per body/substep serves every part. Per-part effective
  coefficients are rebuilt only when condition revision or wing control changes.
* One contact solve supplies body reaction, wheel rotation, slip work and telemetry.
  Work increments wear; the next evaluation derives BOTH grip and rolling radius
  from it. `treadDepthM` and `effectiveRadiusM` expose the same derived state. A part
  view reports the coefficients used by the latest force evaluation; accumulated
  work is end-of-substep state (one-step explicit material feedback).
* `part()` returns the same borrowed readonly view, not a new mesh, snapshot or
  simulation. Physics coefficients, HUD and audio consumers can share it. Explicit
  `structuredClone(view)` is required for history. This is not a JS security boundary.
* No mesh generation in the physical loop. No per-wheel scheduler or AudioWorklet.
  The existing rendering/audio consumers are NOT automatically wired to these new
  views yet; this pass exposes the causal contract, not a fake completed integration.

`PhysicsWorld.drive(body,driver)` is the narrow generic extension point. It checks
body ownership, allows one force owner per dynamic body and honours the driver's
maximum step without advancing extra time. Removing a body or clearing the world
releases its driver. The no-driver path retains the previous solver behaviour.

## Damage and lifetime actually implemented

Tyre wear is accumulated **dissipated slip work**, with an explicitly authored energy
capacity. It changes grip, tread depth and contact radius. Idle time is not wear.
Temperature rise is an **adiabatic diagnostic**, not a cooling/thermal-grip solver.

Suspension uses a compression-only elastoplastic spring return mapping. Geometric
compression beyond yield changes its permanent rest offset. Subsequent support
forces use that offset; a held compression does not spend plastic work every tick.
The bump stop is a simple progressive spring, not a full linkage.

Optional part fatigue is a constant-memory reversal-range approximation. It counts
half ranges at turning points with an authored power-law damage rule. Static load
is not fatigue, and repeating identical samples does not add cycles. This is NOT
full rainflow counting, experimentally validated fatigue, or a universal material law.
An optional breaking-load limit fails the surface. Failed wings lose lift but retain
drag and attached mass; **detached debris/changed mass are not simulated here**.

## Explicit limits

Default wheel support is the current `world.ground` **horizontal static plane**.
This does not yet supply suspension raycasts against arbitrary moving/rotated
colliders, terrain deformation, linkage kinematics, centre differentials or detailed
engine/clutch simulation. Wheel drive is specified torque capped by shaft power.
Chassis collision remains the existing box envelope; wings do not add collision
volumes. Attached wheel unsprung masses are lumped into the one rigid body. The mass
tensor uses diagonal terms, not principal-axis diagonalisation of arbitrary asymmetry.

The coupled node/beam contact path in thegame #82/#89 is NOT integrated into this
Vehicle in this pass. Existing game-engine StructuralBody, panel/deformation systems
are left intact. No double integration or decorative fake mesh crumpling is added.
No BeamNG-superiority, realistic miniature-scale dynamics, sound or prettier-render
claim follows from these tests.

## Source provenance

* Aerodynamic polar and local airflow rules: thegame
  `4e7a5777276610e344b045fde1eb6772eb07f582`, `src/game/flight/aerodynamics.ts`.
  Re-expressed against the engine's Euler basis/force accumulator, with a reusable
  derived condition. Failed surfaces retain drag rather than disappearing.
* Bounded scalar tyre/contact solve: same thegame revision,
  `src/game/wheel-contact.ts`. Its vehicle-sized inertia floor of .1 kg m2 is reduced
  to 1e-12; the iteration/order is unchanged. This is not source-state parity with
  the whole thegame vehicle controller (which is not imported).
* M3 dimensions in the fixture come from existing procedural parameters. Masses,
  wing sizes and lifetime capacities are demonstration calibration, not measured BMW.

## Evidence

`bun run harness:vehicle-runtime` records a powered runway trace with/without wings,
friction work and wear, and eleven paired cached/reference full-world runs after
four warmups per path. It checks exact f64 state hashes and physical work counters.
`reuseDerived:false` is only an explicit benchmark reference, not a second physics
model. It recomputes the same transforms/coefficients; contacts, iterations and
substeps are unchanged. Timings include PhysicsWorld but not renderer/network/audio.
Small timing gains are not a universal speedup or a FPS promise.

`node --test test/vehicle-runtime.test.mjs` covers lift, drag work, wind, stall,
asymmetric moments, powered takeoff, ballistic-vs-winged glide, wind-driven spoilers,
overload, permanent set, work-driven wear,
fatigue sampling, state isolation, live views, driver ownership and cached parity.
The workflow preserves source/dist, raw samples and full test logs with the exact SHA.
The three inherited full-suite failures remain red and are not weakened.
