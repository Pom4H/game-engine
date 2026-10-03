# Wave fields: blast pressure -> structural failure

The engine now has one reduced-order acoustic field for pressure propagation through
a medium. It is a physical cause carrier, not a damage system.

## State and units

AcousticWaveField uses a staggered 3D grid:

- pressure p [Pa] at cell centres;
- medium velocity v [m/s] at cell faces;
- density rho [kg/m3];
- wave speed c [m/s];
- cell size dx [m].

The update is the first-order linear-acoustics system

    dv/dt = -grad(p) / rho
    dp/dt = -rho c^2 div(v)

with a standard staggered finite-difference discretization. Each pressure cell and
each adjacent face is visited a constant number of times. For
N = nx * ny * nz, one step is O(N).

The explicit 3D CFL invariant is

    c * dt / dx <= 1 / sqrt(3)

and the engine rejects a step that violates it.

## Walls

A solid acoustic cell forces the normal velocity at an adjacent face to zero.
That is a hard-wall / no-through-flow boundary. A pressure front therefore
reflects from the wall instead of numerically leaking through it. Openings are
simply fluid cells and naturally transmit the wave.

## Explosion source

injectBlast() accepts acousticEnergyJ deliberately. It does not pretend that all
chemical/explosive energy becomes an acoustic wave and does not encode a TNT
equivalence.

The initial compact compression profile is normalized by

    E_compression = integral( p^2 / (2 rho c^2) dV )

so an isolated source starts with the requested acoustic compression energy.
Near-field detonation chemistry, combustion products and nonlinear shock
thermodynamics remain separate higher-fidelity models.

## Coupling to destruction

Pressure itself never decides that something is broken.

For a surface patch with outward normal n and area A:

    F = -p A n
    J = F dt

so Pa * m2 * s = N s.

pressurePatchLoad() exposes that load. applyPressureLoad() sends the resulting
impulse into an existing StructuralBody-compatible sink. StructuralBody remains
the owner of strain, plasticity, constraint failure and topology state.

The causal chain is therefore:

    blast source
      -> acoustic pressure / medium velocity
      -> surface pressure impulse
      -> StructuralBody
      -> elastic/plastic strain
      -> existing constraint failure
      -> render/audio projection

There is no ExplosionDamage number and no second fracture threshold.

## Fidelity boundary

This field is appropriate for propagation, occlusion/reflection, arrival time and
loading outside the unresolved detonation core. Close to the source, a nonlinear
compressible-flow or empirical blast model may later provide boundary/source
conditions to the same pressure-load contract without changing structural
ownership.


## Geometry -> boundary conditions

`syncSceneAcousticBoundaries()` rebuilds hard boundaries directly from the
authoritative scene state.

Ownership is deliberately identical to collision ownership:

- if an entity owns a `RigidBody`, its current collision shape is the source;
- box collision uses the current `collisionHalf` and `collisionOffsetLocal`, so
  permanent crush changes the acoustic obstacle;
- body-less entities use their physical `mesh` as a triangle shell;
- `renderMesh` is never consulted;
- micro-debris is below this field's spatial tier and is not voxelized.

This means a door changing rotation, a wall being removed, or a collision envelope
being permanently crushed changes subsequent propagation after the next boundary
sync. Fracture does not need an acoustic callback: topology already changes the
authoritative scene, and the next projection observes that state.

Box/body occupancy is conservative against the grid cell volume. Triangle meshes
use triangle-vs-AABB SAT, so thin physical surfaces still occupy acoustic cells
instead of leaking merely because no cell centre lies exactly on the surface.

The projection is intentionally rebuildable. It owns no second scene truth.
