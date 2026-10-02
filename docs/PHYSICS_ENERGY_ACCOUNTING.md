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

A solver correction `Δx` does not alter kinetic state. Its mechanical-energy
change in constant gravity is:

```text
ΔE = ΔU = -m g·Δx
```

It is explicitly tagged as solver correction in cause trace; it is not hidden
inside collision energy.

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
