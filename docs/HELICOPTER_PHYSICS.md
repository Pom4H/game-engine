# Helicopter physics stress test

The helicopter is not a special engine mode. It is an ordinary `Vehicle` composition:

```
RigidBody
├─ chassis
├─ main rotor
├─ tail rotor
├─ horizontal stabilizer
└─ vertical stabilizer
```

The same `PhysicsWorld` integrates cars, winged aircraft and helicopters.

## Rotor cause

`RotorSpec` is a first-class force component. The actuator disk derives thrust from:

- air density;
- disk area;
- physical rotor RPM;
- blade solidity and lift slope;
- collective pitch;
- relative axial/transverse air flow;
- available shaft/autorotation power.

Main-rotor reaction torque is applied to the same rigid body. The tail rotor is just another
rotor mounted away from the center of mass, so yaw authority emerges from its force arm.

Cyclic does not directly rotate the helicopter. It tilts the rotor thrust vector; the resulting
force and moment go through the normal rigid-body integrator.

## Current numerical gates

CI verifies:

- thrust exists at zero translational speed;
- RPM converges to the authored governor speed;
- hover thrust is close to vehicle weight;
- main reaction torque and tail-rotor trim approximately balance;
- pedal input changes yaw torque in both directions;
- cyclic produces physical pitch/roll forces and moments;
- a trimmed helicopter can hover without position hold;
- lower air density reduces lift at equal controls/RPM;
- translational lift follows relative airflow and wind;
- descending flow retains more rotor energy after engine cut (autorotation);
- rotor overload uses the existing condition/failure path and keeps attached mass;
- rotor presentation reads the same physical `spinRad`, never a second animation clock;
- the helicopter runs as an ordinary public project module.

## Rotor dynamics now covered

The rotor remains an ordinary `Vehicle` component, but its state now includes:

- first-order flap and lead-lag response, so cyclic cannot teleport the thrust vector;
- ground-effect gain derived from actual rotor-to-surface clearance rays;
- a bounded VRS/settling-with-power inflow loss in steep low-speed descent;
- retreating-blade stall from advance ratio and collective, including an asymmetric hub moment;
- named shared shafts/gearboxes whose aggregate powered draw cannot exceed the authored budget;
- rotor clearance rays that can shed aerodynamic blades after a strike;
- deterministic blade-pass acoustic synthesis driven by RPM, blade count, loading, VRS and stall.

The strike model currently removes a blade from the rotor's aerodynamic state but deliberately does
not spawn a free rigid-body blade fragment or mutate the parent rigid body's mass/inertia. That is
the remaining separation step; it needs an explicit mass-transfer operation rather than silently
breaking the single-body invariant.

Advancing-blade compressibility is also still separate from the retreating-stall approximation and
should be added from local tip Mach rather than hidden inside a tuning constant.

Every change still passes the car/soft-body/contact/audio/network regression gates.
