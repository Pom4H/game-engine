# Vehicle runtime — measured 2026-09-27

Implementation SHA: `854d03a61b1bc14f1e2053d47c5d184544d3eded`.
Stacked PR: [#23](https://github.com/Pom4H/game-engine/pull/23), based on #22.

- [Executed CI run 36316908941](https://github.com/Pom4H/game-engine/actions/runs/36316908941)
- [Typecheck, 17 new tests, harness, full regressions](https://github.com/Pom4H/game-engine/actions/runs/36316908941/job/108613222104)
- [Raw report.json, report.md, regressions.log, source/dist](https://github.com/Pom4H/game-engine/actions/runs/36316908941/artifacts/10931311115)
- Exact unchanged runtime baseline: `89b16ce8a7c27ff62095137dd4db8abb1e9a9dca`, [run 36315592883](https://github.com/Pom4H/game-engine/actions/runs/36315592883), [artifact 10931005198](https://github.com/Pom4H/game-engine/actions/runs/36315592883/artifacts/10931005198).

Downloaded CI source matches the locally tested source in every changed file except the insignificant final newline in world.ts. The existing collider routines are unchanged. The comparison below uses the same compiled runtime and fixture in one process, not timings taken from unrelated machines.

## Actual powered takeoff

Both fixtures start from rest. Rear wheel torque is limited by shaft power. After 15 s, the input changes wing deflection by .20 rad. The fixture does not write position or velocity to make the vehicle fly. Forces are consumed by the normal PhysicsWorld integrator; added part mass is included once.

| Fixture | Total mass | First zero wheel support after wing command | Max COM height above world ground |
|---|---:|---:|---:|
| Four wheels, no wings | 1580 kg | never in the 20 s trace | 0.725 m |
| Four wheels, two wings | 1630 kg | 15.141667 s | 1.665 m |

At recorded time 15.208333 s: forward velocity 56.098 m/s, vertical velocity 0.716 m/s, wheel support 0 N, aggregate lift 16946.219 N. Each wing is 4 m span by 1.6 m chord (12.8 m2 total), at lateral offset +/-2.8 m. These are deliberately large lifting surfaces, not decorative spoilers.

This is a full-scale SI demonstration using existing M3 envelope dimensions, not calibrated BMW dynamics and not miniature 1:64 mechanics. Wheels supply no airborne thrust; the result is a temporary takeoff/glide, not sustained powered flight or a complete flight-control model. Default support is the static horizontal world.ground plane.

## Lifetime and damage

A separate deliberately accelerated wear fixture uses a 30000 J per-wheel lifetime capacity to expose the feedback within two seconds. Rear-left accumulated slip work is 309.8 J, resulting wear 1.03%, remaining tread 7.918 mm. This is NOT a prediction of real tyre lifetime. A stationary wheel has no slip-work wear.

Tests also verify overload-induced permanent spring set, no repeated plastic work under identical held compression, reversal-driven fatigue without static-load aging, and wing overload loss of lift. Failed wings remain attached mass with drag; detached debris is not implemented.

Wear uses authored dissipated-work capacity. Fatigue uses a constant-memory turning-range approximation, not full rainflow. Temperature is an adiabatic diagnostic. Full thegame #82/#89 coupled soft-body integration and automatic rendering/audio consumers remain follow-up work. No claim of BeamNG superiority follows from this experiment.

## Cost of reusing derivatives

Environment: Node **v22.23.2**, Linux x64, **Intel Xeon 6973P-C**, GitHub-hosted runner; Bun 1.4.2 and repository-pinned TypeScript 7.0.2 build. Four untimed warmups for each variant, eleven paired samples with alternating execution order. Each sample executes 1200 world steps at 1/120 s. Both variants use identical physical equations, wheel iterations, contacts and substeps. Reference deliberately recomputes the same body basis per part and part coefficients each step.

| Metric | Recomputed | Reused |
|---|---:|---:|
| Median wall time, 1200 world steps | 8.040714 ms | 7.563046 ms |
| Body orientation builds (including construction) | 7201 | 1201 |
| Derived builds per unchanged wing | 1200 | 1 |
| Support queries | 4800 | 4800 |
| Aerodynamic evaluations | 2400 | 2400 |
| Wheel solves | 4800 | 4800 |
| World substeps | 1200 | 1200 |

Ratio: **1.06316x**, or about **5.94% less CPU time in this workload**. The cached mean cost is 6.30 microseconds per simulated world step, not display frame time. Tiny same-process benchmark, no confidence interval or whole-game/FPS/capacity claim. Local AMD EPYC9V74/Node22.16 repeat also showed about 6%, but is not pooled into these CI numbers.

Wear changes wheel coefficients frequently, so wheel-derived caches are NOT claimed to eliminate all per-wheel work. Constant wing coefficients and the common orientation frame account for the deterministic reduction. No mesh generation runs in this physical loop; renderer/GPU/audio/network are not measured.

Every one of eleven pairs has the same finite Float64 final-state hash and physical work counters. Final-state hash (including positions, velocities, forces and lifetime state):
`5e401e6b9f59a8279cf54ead1cf7884d70e2e32ade9fca91ea63c0ac8e027219`.
A separate regression also compares state under changing throttle, steering and braking.

## Test status

Typecheck/build passed; **17 new runtime tests passed**.
Full candidate suite: **111 pass / 3 fail / 0 skip**, 114 total.
Exact unchanged baseline suite: **94 pass / 3 fail / 0 skip**, 97 total.
The same named failures occur in both:

- coat roughness blurs local radiance rather than suppressing it;
- coat applies the same normal-variance floor as base roughness;
- M3 render assembly preserves original FBX parts while keeping semantic engine materials.

Old tests and renderer were not weakened or retuned. Overall CI remains red, and the PR is draft. No automatic main merge.

## Reproduce

```sh
bun install --frozen-lockfile
bun run build
node --test test/vehicle-runtime.test.mjs
bun run harness:vehicle-runtime
```

Runtime API and approximation boundaries: [vehicle-runtime.md](../vehicle-runtime.md).
