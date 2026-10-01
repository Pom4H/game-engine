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

## Deliberately not faked yet

These need additional physical causes rather than tuning constants:

- blade flapping / lead-lag dynamics;
- ground effect;
- vortex-ring state and settling-with-power;
- retreating-blade stall / advancing-blade compressibility;
- shared engine/gearbox power allocation between rotors;
- rotor strikes and blade separation;
- rotor-specific acoustic synthesis.

The point of the helicopter fixture is to make those omissions measurable. A future change that
improves helicopter behavior must still pass the car/soft-body/contact/audio/network regression
gates.
