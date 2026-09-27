# Vehicle domain framework

The engine consumes `Primitive` geometry and ordinary part transforms. Vehicles own
body shape, wheel construction, mounts and semantic part names. One compiler belongs
to an authoring session, not to every wheel and not to every rendered frame.

## API

```ts
import {
  VehicleCompiler, vehiclePart, PICKUP_CANOPY_VEHICLE_DEFINITION,
} from '@rom4/game-engine/vehicles';

const compiler = new VehicleCompiler();
const definition = PICKUP_CANOPY_VEHICLE_DEFINITION;
const original = compiler.compile(definition);
const variant = compiler.compile({
  ...definition,
  id: 'pickup-eight-spoke',
  wheel: {...definition.wheel, spokes: 8},
});

const rim = vehiclePart(variant, 'wheels.front.left.rim');
console.assert(original.body === variant.body);
console.log(compiler.diagnostics); // bodyBuilds: 1, wheelBuilds: 4 (two per variant)
```

`compileVehicle(definition)` remains the stateless, compatible entry point. Keep a
`VehicleCompiler` for sliders/editor changes; call `clear()` to release its retained
references. Each compiler retains only its current body/glass and one wheel mesh pair
per side. Existing compiled results remain usable after edits or `clear()`.

`@rom4/game-engine/vehicles/wheels` exposes `RoadWheelCompiler` independently. Neither
new entry point imports renderer/physics/audio implementations or packed M3 assets.
The old root entry point remains an all-in-one compatibility facade.

The wheel contract uses SI metres, finite positive radius/width, rim ratio strictly
between zero and one, 3–256 integer spokes, and finite nonnegative dish/split. Left
and right rims have distinct handedness; front/rear axles share their side's geometry.

## Ownership and dependencies

| Authoring cause | Rebuilds | Reuses |
|---|---|---|
| Spokes, split, dish, wheel width/rim ratio | Left/right wheel pairs | Body and glass, including existing wheel apertures |
| Body profile, pickup canopy | Body and glass | Wheel meshes if the wheel package is unchanged |
| Wheel radius | Body, glass, wheels and mount transforms | Nothing whose geometry depends on that radius |
| ID/reference metadata | Definition snapshot and cheap part descriptors | All meshes |
| Same values in newly allocated input objects | Cheap part descriptors | All meshes |

Body/glass invalidation is intentionally conservative: they are one surface stage for
now. Wheel geometry is also still a complete tire/rim pair per side. A rim edit does
**not** yet avoid regenerating the tire inside that pair. No claim is made that every
leaf already has an independent compiler.

The compiler snapshots the small definition and freezes its owned output geometry
without walking every scalar or serializing renderer cache keys. The Scene owns
render-key construction for its own geometry copies.
It never freezes caller inputs. Modifying an input object is detected by value keys;
it cannot relabel or mutate a previous result. Runtime deformation works on scene-owned
copies, not on these shared authoring meshes.

`vehiclePart` provides typed addresses such as `wheels.front.left.rim` while preserving
the existing flat engine IDs. It is an authoring/inspection helper, not a graph walk
inserted into the renderer's hot loop.

## Harness

```sh
bun run check
bun run harness:vehicles
```

The harness compares the new compiler with a test-only reproduction of the previous
assembly loop using the unchanged body and wheel generators. It checks exact Float64
geometry hashes, full output equality, wheel-edit locality, immutable snapshots and
bounded cache ownership for both M3 and pickup definitions. The tests also cover
radius changes, body changes, malformed edits and semantic path validation.

Output: `artifacts/vehicle-domain/report.json` and `report.md`. The GitHub workflow
runs typechecking, the full regression suite and the harness on an isolated CPU runner.
It publishes the report as an artifact and in the job summary. An independent job
runs the untouched PR base to distinguish existing regressions from framework changes;
full-suite failures are reported as failures, not ignored to make a green badge.

Timings are CPU **authoring compilation**, reported as medians with all eleven samples
after four untimed warmups per path. Paired runs alternate execution order to reduce
order bias. A cold compile means an empty compiler cache, not a fresh process.
Timings are not flaky CI pass/fail thresholds. Deterministic structural checks are
the regression gates. Unique source arrays are counted before Scene cloning; these
are not claims about heap allocation, GPU residency or FPS. Emitted ESM import
footprint is not a bundled size.

## Scope

This is the first domain boundary, using the existing generators and engine contracts.
It does not add a second scheduler, generic plugin registry, npm dependency, tire wear,
new physics, spline backend or prettier renderer. Further leaf separation needs its own
measurable benefit and invariant test; naming a field is not proof of an R&D improvement.
