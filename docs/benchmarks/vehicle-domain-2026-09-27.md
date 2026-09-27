# Vehicle domain experiment — 2026-09-27

## Evidence

Measured implementation: `0f027e26b4b0c5cabc6f3c97760b5eb186d231eb`.
GitHub tested merge: `e6358804205406867efb71c96b4b1a023fab2458`, incorporating main `53161ac73a9fc615062dab1a6a22759a0c13e525`.

- [Workflow run 36313294609](https://github.com/Pom4H/game-engine/actions/runs/36313294609)
- [Domain tests, measurement output and full regression job](https://github.com/Pom4H/game-engine/actions/runs/36313294609/job/108603202000)
- [Untouched historical main control, 90ef4a3](https://github.com/Pom4H/game-engine/actions/runs/36313294609/job/108603202094)
- [Raw report.json, report.md and regression.log artifact](https://github.com/Pom4H/game-engine/actions/runs/36313294609/artifacts/10929871279)

Environment: GitHub-hosted Ubuntu 24.04.5 x64, Node v24.21.0, Bun 1.4.2, TypeScript 7.0.2. Median of 11 timed samples per path after four untimed warmups. Old/new measurements alternate execution order. Explicit GC runs outside the timed interval. Raw samples remain in the artifact and the `VEHICLE_DOMAIN_REPORT` log record.

The old path reproduces the previous assembly loop using the same unchanged shape generators. The new path uses domain-owned body/glass and wheel caches. These are CPU **authoring compilation** measurements, not GPU rendering, frame rate, heap profiling or model-quality scores. A fresh compile means an empty compiler cache, not a fresh process.

## Results

| Operation | Model | Old median, ms | New median, ms | Interpretation |
|---|---|---:|---:|---|
| Change wheel spokes | M3 | 15.876718 | 4.335427 | 3.6621x faster |
| Change wheel spokes | Pickup | 6.090826 | 3.897560 | 1.5627x faster |
| Fresh compilation | M3 | 20.087662 | 21.787059 | 8.46% slower in this run |
| Fresh compilation | Pickup | 5.950036 | 4.350394 | 1.3677x faster |
| Recompile identical values | M3 | — | 0.196678 | No geometry rebuilt |
| Recompile identical values | Pickup | — | 0.137163 | No geometry rebuilt |

Do not present this as universal acceleration. M3 fresh compilation did not improve in this run, and those samples have substantial spread. The reproducible structural benefit is avoiding unrelated work during edits. Cross-machine timing confidence and FPS gains have not been established.

| Structural metric | M3 | Pickup |
|---|---|---|
| Generated triangles before / after | 6030 / 6030 | 4262 / 4262 |
| Initial wheel-generator calls | 4 → 2 | 4 → 2 |
| Body rebuilds for a wheel-spoke edit | 1 → 0 | 1 → 0 |
| Unique authoring mesh objects | 10 → 6 | 10 → 6 |
| Unique geometry scalar entries | 126078 → 78198 | 89502 → 48678 |

Front and rear wheels share their side's immutable geometry. Source-array sharing is measured before Scene copying; it is not a claim that GPU memory fell by the same amount. Body/glass are still one conservative invalidation stage; tire/rim are still generated as a pair.

Float64 geometry SHA-256 is identical to the old assembly, including vertex positions, normals, indices, transforms, roles and materials:

- M3: `fac14427b16d2364ad351f7b102929b80bde4f51d95c904e6a6f4294c7c26f2f`
- Pickup: `7fc638704431bfb8744398d81457812b4a892dea7954a29acc6cc444465d7c63`

Emitted, unbundled runtime ESM import graph: the compatibility root entry loads 57 modules / 673994 source bytes; `/vehicles` loads 9 / 70790; `/vehicles/wheels` loads 3 / 8227. This measures the chosen entry point, not whole-package shrinkage, gzip size or proven LLM context requirements.

## Validation status

Typecheck/build succeeded. All **15 new domain tests passed**, including exact geometry, value-key invalidation, edit locality, left/right handedness, bounded cache lifetime, immutable snapshots, invalid inputs and narrow imports.

The full PR suite is **94 passed, 3 failed (97 total)**. The historical unmodified main control at `90ef4a321b1cb2f9cea706b63b4a3168fcecfa34` is **79 passed, 3 failed (82 total)**. Its SHA comes from the PR event metadata and is older than the main parent of the tested merge; both exact SHAs are recorded above rather than claiming they are identical baselines.

The same named pre-existing failures occur in both runs:

1. `test/clearcoat.test.mjs:22` — coat roughness blurs local radiance rather than suppressing it.
2. `test/clearcoat.test.mjs:28` — coat applies the same normal-variance floor as base roughness.
3. `test/vehicle-interaction.test.mjs:112` — M3 render assembly preserves original FBX parts while keeping semantic engine materials.

The workflow remains red; these failures were not skipped or weakened to manufacture a green result. Rendering code and original tests were not changed by this PR.

## Rejected first implementation

[Run 36312645382](https://github.com/Pom4H/game-engine/actions/runs/36312645382) caught a pickup regression: wheel-spoke edits took 8.905 → 19.149 ms. That version used the general recursive `freezePrimitive`, including renderer-key serialization of generated meshes. The revised compiler freezes its known flat numeric arrays directly and leaves renderer-key construction to the Scene. A test rejects accidental serialization and verifies immutability of every geometry channel.

The initial run used seven unpaired samples, whereas the final harness uses eleven paired samples with warmups; do not treat their absolute medians as a controlled cross-run speedup. The final old/new comparisons above are measured within the same run.

## Reproduce

```sh
bun install --frozen-lockfile
bun run build
node --test test/vehicle-domain.test.mjs
bun run harness:vehicles
```

This experiment establishes a useful vehicle/wheel domain boundary with measured edit-locality and compilation benefits. It does not yet establish faster LLM research, independent compilation of every semantic leaf, spline surfaces, tire wear, new physics or improved visual fidelity.
