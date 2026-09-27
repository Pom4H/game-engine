# Animation model boundary — 2026-09-27

## Baseline and scope

Verified against `acf1119da671180a4100baae691b635bbd0838c6` on `codex/adaptive-core`, obtained from the measured-source artifact of Actions run `36341456782`. The working branch already contains the live DSL playground, two-way HUD and network projections; checking only `main` missed those features.

This patch completes one model/application boundary, not the entire engine refactor or the planned slide-out console.

## Changes

- `animation/locomotion.ts` keeps authored data, gait sampling, two-bone IK and rig transform mathematics. It no longer imports `Scene` or `RuntimeEntity`.
- The existing `AnimationSystem` moved to `animation/system.ts`. Its borrowed `AnimationTarget` structural contract contains only the pose and body fields it consumes. Existing scene entities satisfy it without wrappers, conversion or additional copies.
- Numeric formulas and animation application behavior are unchanged. Time, terrain and previous pose remain explicit inputs. This does not claim that the existing sampling path is allocation-free.
- Scene schema validation no longer constructs and populates an animation runtime merely to validate authoring data. Duplicate actor IDs across both actor kinds and required wheel radii are checked directly; existing range, ownership and binding checks remain.
- Removed the unused deprecated `Scene.winter` alias; surface state has the existing `scene.surfaces` entry. No compatibility re-export of `AnimationSystem` is retained in the numeric model. The package-root `AnimationSystem` export remains.
- Added five boundary/regression tests and updated the existing animation test's import. No runtime dependencies or generic manager were introduced.

Source-only diff: **+118 / -105 lines, net +13**. The erased structural contract makes the dependency boundary explicit; this is not a claim of reduced total engine LOC, lower frame times or improved visual quality.

## Local verification

Environment: Node **22.16.0**, TypeScript **5.8.3** available in the execution container. The root package declares TypeScript `^7.0.2`; the declared compiler version was **not** verified here. These are local test results, not a claim of green GitHub test CI.

```sh
tsc -p tsconfig.json --noEmit
tsc -p tsconfig.build.json
node --test test/model-boundary.test.mjs test/animation.test.mjs test/walker-motion.test.mjs test/core.test.mjs
node --test test/*.test.mjs
```

Both TypeScript commands passed. Focused suites: **44/44 passed**.

| Full suite | Tests | Passed | Failed |
| --- | ---: | ---: | ---: |
| Before this patch | 146 | 143 | 3 |
| After this patch | 151 | 148 | 3 |

The same three failures existed on the baseline and remain, with no test expectations weakened:

1. `coat roughness blurs local radiance rather than suppressing it` — shader expectation.
2. `coat applies the same normal-variance floor as base roughness` — shader expectation.
3. `M3 render assembly preserves original FBX parts while keeping semantic engine materials` — triangle count: expected 9798, actual 11922.

## Numerical comparison

Compared the baseline and refactored modules under the same Node/V8 environment: 360 ticks for each heading `0`, `0.73`, `Math.PI`, `-Math.PI/2`, collecting both gait poses and bound head/leg transforms. Walker input was `{id:'baseline',root:[10,.2,-3],heading,speed:.86,period:1.3}`, time `tick/60`, terrain `p => ({height:.23+(p[0]-10)*.025,snowDepth:.05})`, carrying the previous pose within each heading. Added three two-bone IK cases with targets `[0,0,0]`, `[.1,-.6,.2]`, `[3,-4,1]`, root `[0,0,0]`, lengths `.425`/`.42`, pole `[1,0,0]`.

**2883 output records matched exactly.** The SHA-256 of their JSON representation was identical before and after:

```text
cda9ef220222bf3932d0aaaf0f5b6d080e19a7da60cd571ee24f0c280b272732
```

This finite comparison is a regression check, not a proof of cross-platform determinism or full physical correctness.

## Not claimed

No WebGPU visual acceptance run, frame-time benchmark, full physics/audio/material extraction, worker-pool rewrite, or slide-out console implementation was completed in this patch. The existing analyzer's regex-derived graph includes type-only imports and its cycle count is traversal-dependent; it is not a runtime-overhead metric or the acceptance gate for this boundary.
