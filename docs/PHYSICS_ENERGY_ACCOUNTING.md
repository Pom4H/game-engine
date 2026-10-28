# Mechanical energy proof

The proving-ground energy gate must compare two independent quantities:

1. the mechanical-energy difference observed from rigid-body state;
2. the energy transfer predicted from the physical actions applied during the substep.

It must never define the prediction as `E_after - E_before`.

## State energy

For a rigid body of mass (m), centre velocity (v), angular velocity (omega),
world inertia tensor (I), gravity acceleration (g), and centre position (x):

```text
E = 1/2 m v·v + 1/2 ω·Iω - m g·x
```

Units are joules.

## Constant force / torque kick

During a velocity kick the orientation is fixed:

```text
Δv = F dt / m
Δω = I⁻¹ τ dt
```

Therefore, exactly:

```text
ΔK_linear = F·v₀ dt + 1/2 (F·F)/m dt²
ΔK_rot    = τ·ω₀ dt + 1/2 τ·I⁻¹τ dt²
```

This is used for force-driver and fluid stages.

Limiting cases:

- `F = τ = 0 => ΔK = 0`;
- reversing the initial velocity changes the signed first-order work term;
- the quadratic term remains non-negative and is the exact finite-step kinetic increment.

## Gravity + symplectic-Euler position update

The world uses:

```text
v₁ = v₀ + g dt
x₁ = x₀ + v₁ dt
```

With `U = -m g·x`, the exact mechanical-energy difference produced by this
discretization is:

```text
Δ(K + U) = -1/2 m |g|² dt²
```

This term is a known numerical defect of the chosen integrator, not physical
dissipation. It must converge quadratically per substep as `dt -> 0`.

## Point impulse

For impulse `J` applied at body-local/world lever arm `r`:

```text
L = r × J
Δv = J / m
Δω = I⁻¹ L

ΔK =
  J·v₀ + 1/2 J·J / m
  + L·ω₀ + 1/2 L·I⁻¹L
```

This predicts normal and friction impulse work independently of the resulting
body state.

## Position correction

A rigid pose-only solver correction `Δx` does not alter kinetic state. Its
mechanical-energy change in constant gravity is:

```text
ΔE = ΔU = -m g·Δx
```

It is explicitly tagged as solver correction in cause trace; it is not hidden
inside collision energy.

Nodal position constraints have a different contract: the structural step
reconstructs `v = (x - x_previous) / h`. A nodal correction therefore also changes
kinetic energy by `Σ m v·(Δx/h) + 1/2 m |Δx/h|²`, in addition to its gravity and
geometric elastic-energy change. It must not be classified as a kinetic-neutral
rigid pose correction or inferred only from a constraint multiplier.

## Explicit velocity correction

For authored solver correction `Δv, Δω`:

```text
ΔK_linear = m v₀·Δv + 1/2 m Δv·Δv
ΔK_rot    = (Iω₀)·Δω + 1/2 (IΔω)·Δω
```

This covers the currently explicit rolling-rest and sleep-rest corrections.

## Closure invariant

For every dynamic body and every proof-mode substep:

```text
E_after - E_before
  = W_driver
  + W_fluid
  + ΔE_gravity_integrator
  + ΔE_contact_impulses
  + ΔE_position_corrections
  + ΔE_solver_velocity_corrections
  + residual
```

The release proof requires `residual` to remain within the floating-point
closure tolerance. A new direct mutation of position, velocity, or angular
velocity that is not represented by one of the terms above must make the proof
fail.

This is an attribution invariant. It does not claim that every reduced-order
law is a reality-validated model; those laws still require independent physical
datasets and convergence experiments.

## Small deformable sheets

The TypeScript shell path separates axial membrane energy from bending energy:

```text
U_membrane = Σ 1/2 (EA/L₀) (L - L_rest)²
U_bending  = Σ 1/2 kθ (θ_unwrapped - θ_plastic)²
W_plastic  = Σ F_y |ΔL_plastic| + Σ M_y |Δθ_plastic|
```

The signed dihedral angle is continued across the ±π branch. Sheet bending uses
`D = Et³ / [12(1-ν²)]` and the shared-edge/adjacent-area shell quadrature; frame
bending uses its own physical `EI/span` and section moment. A sheet's elastic
buckling load does not become an irreversible axial compression yield force.
Fractured membrane supports disable their dependent bending constraints before
connectivity is evaluated.

The option named `projectiveDistances` selects the bounded direct structural
solver (at most 256 material nodes). Its current membrane/volume step is a
Gauss--Newton step with the radial tangent
`T = M + h² Σ (EA/L₀) ∇L ∇Lᵀ + h² Σ kV ∇V ∇Vᵀ + h² Σ kθ ∇θ ∇θᵀ`.
Small sheets refactor each nonlinear pass with a banded graph ordering. Larger
unibodies use a cold minimum-degree symbolic sparse pattern and one tangent per
substep, with ten backtracked quasi-Newton passes. Volume terms enter this same
operator and objective; they do not apply separate bare-mass corrections.
Shell bending enters the same gradient, tangent and true angular energy as
membrane stretch; it does not perform a separate inverse-gradient solve for
each hinge. Energy-only angle reads skip unused gradients. Rejected line-search
trials and diagnostic reads never update signed-angle branch history; history
commits only at accepted physical positions or explicit shape restore/bake.
The material tangent uses a fixed linearization pose (per pass for sheets, per
substep for larger bodies). A finite contact or nonlinear GN step can rotate the
material after that factorization: contact/GN responses transport forces into
the factor frame and solutions back through the proper mass-weighted material
rotation, and project rigid modes at the current pose. This avoids treating an
old-frame rigid rotation as internal strain while retaining the same factor.
Current response caches use the factor generation and an exact bitwise pose
snapshot. Changing only the accumulated external reaction, completing an empty
projection phase, or rejecting a trial cannot invalidate this operator. Public
step/reaction versions retain their original semantics. Frozen and current
COM/inertia frames have separate owned caches, so alternating bilateral and
contact rows does not discard either frame. One-ULP position edits, changed
gradients, mass, fracture, dt and backend generations still invalidate the
appropriate response. A 24-step nonlinear contact regression compares every
material buffer bitwise with the former version-key policy and checks native
resource cleanup.
Ordinary bilateral stencils still share their fixed-pose responses. Mass
retirement invalidates that factor; constitutive/phase boundaries validate raw
mass and fracture buffers. Backtracking evaluates the actual incremental elastic objective;
the fixed pass budget is not a proof that every nonlinear contact has converged.
The former isotropic distance majorizer incorrectly gave unstressed flat sheets
large transverse stiffness and is not used as physical contact compliance.

Position Schur responses use `T⁻¹`. Velocity impulses and kinetic energy use the
physical lumped mass `M`, with equal/opposite impulses at the same material
stencil. Those two operators are intentionally distinct. Tests reserve actual
geometric membrane and bending energy, together with mount energy and plastic
work; multiplier estimates or kinetic energy alone are insufficient ledgers.
Backward-Euler integration, finite nonlinear iterations and inelastic contact can
lose mechanical energy, so a passive budget does not by itself validate dent
shape or impact restitution. Contact-driven local deflection is checked
separately from the energy and rigid-motion invariants.

The large-body linearization conserves angular momentum at its linearization
pose, with finite nonlinear timestep error after subsequent position changes.
The stiff 75-node free-spin regression measures relative angular errors over
0.25 s of 0.1479%, 0.07530%, and 0.03799% at 1/60, 1/120, and 1/240 s respectively.
It also checks rigid translation, free fall and covariance under a whole-scene
rotation; this is a convergence bound, not a claim of exact finite-step angular
conservation for all nonlinear contact sequences.

Material angular actuators combine the reference pair, child pair and moving
hinge-axis derivatives in one scalar row, retaining cross terms between their
vector gradients. Damping uses the physical velocity-mass row, while positional
compliance uses the structural tangent. State-dependent external rows still
retain finite-iteration nonlinear error: accumulated reaction corrections do
not imply an exactly converged nonlinear stationarity equation after ten passes.
Passive energy budgets, supplied handle-work bounds, rigid covariance and
timestep convergence are separate regression requirements; none alone proves
an exact angular/energy identity for every damaged configuration.

The optional embedded Rust/WASM sparse module accelerates only factorization
and triangular solves of this same operator. The JavaScript path remains the
reference and fallback. Creation, factor and solve errors replay the original
matrix/RHS through that reference path and record a fallback reason. Explicit
world removal/reset releases each native owner; finalization is a safety net.
Small owners reuse a factor only when the material pose is bitwise identical;
one-ULP movement, mass/fracture changes, timestep or backend changes invalidate
it. No strain or material tolerance substitutes for matrix validity. Its
regression compares every material buffer bitwise with always refactoring.
`StructuralBody.stats` and the vehicle inspection expose the backend actually in
use, while `structuralSparseWasmDiagnostics()` reports handles, bytes, calls and
fallbacks. Native execution does not imply that a heavy collision meets a
120 Hz CPU budget; that requires a separate scenario/UI timing measurement.

A nearly collinear small-sheet hinge can make a Jacobian so large that forming
`M + JᵀJ` rounds away the physical mass before Cholesky (the captured released
bonnet case had entries around `5e16` and nodal masses around `0.78 kg`). If the
ordinary factor fails, small sheets replay the original weighted Jacobian rows
through Givens square-root updates starting at `sqrt(M)`. This preserves the
same sections and masses without diagonal regularization, gradient clipping or
velocity limits. Public diagnostics distinguish this rare factorization and
count normal-matrix recoveries. Its regression checks ordinary-operator parity,
a nearly collinear hinge, finite positive response and applied force/torque;
the physical released-panel scenario separately checks settling and retained mass.

## Unilateral contact and finite rigid motion

Each material contact feature owns a nonnegative total position reaction for
the current physical prediction. Updates apply signed delta-lambda; separated,
filtered, fractured or retired features release their previous reaction. A
changed normal removes its old generalized force before registering the new
Jacobian. Neither a lost closest face nor a newly softer fractured tangent may
retain an obsolete external load. Velocity impulses continue to use physical
mass rather than this position Schur operator.

A position contact splits its current tangent response into mass-orthogonal
rigid and internal fields. Translation and the internal response retain their
linear increments; the angular rigid field retracts through the rotation
exponential. The scalar material gap is solved along that finite response, and
the accumulated reaction records the actual chosen multiplier. GN line-search
trials use the same finite rigid retraction with the actual nonlinear objective.
All actual position changes are registered once; their finite-minus-linear
difference must not be interpreted as an additional lumped-mass contact force.

This corrects a concrete high-speed failure: a stiff four-mass tetra's linear
off-centre contact update could invent tens of kJ of elastic strain from an
800 J incoming motion. The contact/retraction regression checks independent
geometric EA/L energy, four node orders, 120/240/480 Hz and subsequent fracture;
the finite candidate stays below the incoming energy and does not cross the
physical plane. Its ten-pass multi-contact residual relative to the intentional
6 mm skin can reach 0.1593 mm, leaving at least 5.8407 mm actual clearance in
that fixture. The isolated scalar-row gap is checked to 1 nm.

Finite rotation with velocity reconstructed from the position chord does not
claim exact finite-step angular impulse. The tetra's maximum spurious angular
momentum about the frictionless plane normal measures approximately 0.1060,
0.01585 and 1.50e-8 kg m²/s at 120, 240 and 480 Hz, while tangential linear
momentum stays within 1e-14 kg m/s. This is a measured discretization limitation,
not a velocity correction or a proof of a fully variational rotational solver.
A whole-vehicle energy audit must also inspect local contact/handoff jumps;
remaining below the initial crash energy alone does not establish passivity.

Reduced vehicle envelopes must conservatively contain every retained material
point with the same structural contact skin. A raised/inset floor proxy or a
ride-height clamp can let dormant material enter the road while its rigid proxy
still appears supported; activation would then turn that hidden overlap into a
large hard positional correction. The Game containment regression checks active,
reduced and reawakened crushed/tilted shapes without changing point positions,
velocities or mass, and verifies that rigid road support needs no new nodal
floor correction on activation. This is a representation/contact invariant,
independent of visual ride height or camera placement.

Algorithm references: the total-multiplier/delta-multiplier distinction follows
[Macklin et al., XPBD (2016)](https://mmacklin.com/xpbd.pdf). The proper
material-frame fit uses the symmetric quaternion eigenproblem from
[Horn, Absolute Orientation (1987)](https://people.csail.mit.edu/bkph/papers/Absolute_Orientation_Scanned.pdf).
The rigid/internal retraction, contact-gap root and measured finite-step limits
above are this implementation's numerical choices and regressions, rather than
a claim that either reference validates the whole vehicle model.

## Welded material surfaces and paired contact

Extruding each source triangle independently creates artificial sidewalls at
an internal welded seam. Treating both sides as physical can demand opposite
positive separations of the same material edge: the captured tetra fixture
required both `J dx >= 0.7077 mm` and `-J dx >= 0.7077 mm`. No material stiffness,
iteration count or velocity damping can satisfy those simultaneous rows.

Collision geometry therefore retains cold geometric weld IDs independently
from mass-chart IDs. SAT still tests every triangle-prism side/cross axis for
separation. An edge/vertex axis may become the penetration normal only if its
support feature is exposed in the local welded union; a neighbor extending
farther along that outward direction hides the artificial seam wall. SAT then
considers its next eligible axis. A separating axis inside the speculative
margin still keeps the returned depth nonpositive, even if the eligible normal
comes from another axis with positive overlap; speculative proximity cannot
become a hard penetration row. Face interiors, exposed boundaries and convex
folded-edge cones remain physical. Retired faces reopen their edges, and old
snapshots retain their original adjacency. A mixed OBB/shell pair additionally
retains the OBB's exposed face axes: the other surface's welded support point
does not turn a real box face into an artificial prism sidewall. The captured
150 km/h crash exposed this distinction. Rejecting the parent box face with
1.472 mm overlap selected a different axis with 805.747 mm overlap, forcing a
thin lamp through a large ejection and inventing elastic energy. The mixed-face
regression freezes the actual 107/109 geometry, rotates/translates it, reverses
operands, and checks that the real face remains available. Triangle/triangle
and cross-edge axes retain both support-cone checks; exempting all triangle
face axes was rejected because it failed the coupled impact energy oracle.

This follows the same internal-edge ownership concern handled by
[Bullet's internal-edge contact utility](https://github.com/bulletphysics/bullet3/blob/master/src/BulletCollision/CollisionDispatch/btInternalEdgeUtility.cpp),
with this implementation using a support-cone eligibility test rather than
copying its normal-clamping algorithm.

Fine geometric vertices can carry cold affine stencils into a smaller material
chart. Actual contact barycentrics blend those same stencils, retaining point,
velocity, effective-mass and impulse-moment duality at the mapped material
point. Weld IDs remain separate from these possibly eighteen-node mappings;
contact grouping must not mistake a shared mass-chart ID list for one geometric
face. Mappings are immutable cold metadata and are replaced when topology
changes.

Static collision must name that same physical surface. Auxiliary chart nodes
are integration/control samples and can lie in empty space: in the captured
crash, a bumper chart node held at road skin was 239 mm from its actual surface.
Canonical embedded attachments therefore supply immutable physical vertex and
edge-midpoint stencils to the static solver. Current and previous points use
the same signed affine weights, as do the contact mass, Schur response and
impulse gradient. Incident physical face normals supply finite sheet thickness;
the declared radius only bounds that extent for broad rejection. Retired
support invalidates a row and releases its old reaction rather than binding
zero-mass or nearest parked chart nodes. Existing authored nodal collision
paths remain separate and unchanged.

The choice of physical collision samples is distinct from the mass nodes.
[BeamNG's node documentation](https://www.docs.beamng.com/modding/vehicle/sections/nodes/)
likewise exposes separate node collision controls and explains why hub nodes
can omit world collision. Its
[triangle documentation](https://docs.beamng.com/modding/vehicle/sections/triangles/)
describes a different node/triangle collision scheme; it does not validate or
describe this implementation's embedded-surface static algorithm.

Two dynamic nodal owners use one combined scalar contact reaction and receive
equal/opposite increments through explicit contact-only anchors. Independent
per-owner finite gap roots would change those two reactions and violate linear
momentum, so they are not used. Ordinary bilateral mounting operations retain
their previous linear material projection. The production Compound tetra
regression covers three offsets and 120/240/480 Hz at the same physical duration:
it checks feasibility of welded rows, independent geometric elastic energy,
total mass and linear momentum, and reports angular momentum separately. Finite
rotational integration and noncoincident mapped surface anchors remain measured
angular-accuracy limitations; passivity alone does not establish exact torque
conservation for every changing contact manifold.
