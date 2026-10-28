# Integration verification — 2026-10-23

2026-10-27: Contact scalar equivalence, swept independent islands, compressive beam buckling and new-member energy accounting: typecheck/build and 36 targeted tests pass. Game integration: [crash stalls report](../../thegame/docs/verification/crash-stalls-20261027.md). Native foreground acceptance was interrupted by Computer Use URL policy; zero-stall/120 Hz/BeamNG parity is unverified.

2026-10-27: Game closures/exhaust and economical shadows integration. Engine typecheck/build pass; 82 targeted Node tests pass, including frozen point-fastener equivalence, momentum/energy of the angular spring, joint-supported sleep/wake, pipe contact/fracture and independent near-shadow reception/culling. Game verification and native artifacts: [mounted assemblies](../../thegame/docs/verification/mounted-settle-20261026.md), [graphics](../../thegame/docs/verification/graphics-cheap-20261026.md). Native RAF still has rare delays; this is not an all-scenes FPS guarantee.

This record covers correctness checks in the isolated migration workspace. It is
not a 60 FPS, frame-stall, GPU image, speech-quality or live-world acceptance result.
Skipped checks remain unverified.

## Bounded dispatch overhead — 2026-10-23

Engine `fad121c91b376c96791d9d038ba4ad654a111fe4` passes `npm run check`:
**1096 pass, 19 skip, 0 fail**, 1115 tests, 61.290141 seconds, including
TypeScript and build. Raw `artifacts/freeze-engine-full-dispatch512.log` SHA-256:
`84f0702ffe05fff0051d8a8b4ebfdd25c75365e082991c7b23c3023d081ffb66`.
The 25-case focused actual-cursor/numerical/host/lifecycle/heartbeat group also
passes. Staging normalization changes neither reviewed source file.

Only two driver expressions change: cursor chunks and credit increments become
512 instead of 32. The hard **4096 units per notification**, one pending item,
alternating ports, exact numeric cursor and complete-only publication remain.
The secondary 1 ms clock target is now checked between 512-unit chunks, so its
overshoot granularity is coarser; no hard wall deadline is claimed. Added tests
observe eight actual 512-credit steps with a frozen clock, one step on deadline
crossing, and terminal cleanup when the second clock read throws. The existing
independent arithmetic bound, exact SH/all-mip bytes and actual heartbeat remain.

The artifact-only paired Node 24.19 experiment observes warm two-proxy means
60.59 → 40.93 ms and synthetic 128-proxy means 851.68 → 637.88 ms, with exact
output digests. This reduces step dispatch/state spills as well as clock reads;
the experiment does not isolate one of them as the entire cause. Its source
fences are partial, the synthetic fixture is not R51's actual distribution, and
Windows CPU counters are quantized. No Chrome/FPS result follows. Full records:
`artifacts/freeze-environment-dispatch-batch-20261023/APPLIED-RESULTS.md`.
The later joint native and travel results are recorded immediately below.

## Joint R12 quality and travel scope

Game `b316df12f6a136d8e038b3446ccada905d487cd4` / Engine
`1c118f22caf8b5e44c7cf4cacd633dcc46014bbc` pass all twelve native R12
fixtures with exact retained R4–R11 PNG/HDR/depth, packed geometry/models,
transparent order and counters. The 306 source/asset hashes, five bundles and
twelve PNG hashes agree after the run. Six actual worker draws retain full
1280×720 / scale 1 / 420 m / TAA / bloom / litter and the original three banks.
Game's independent proof is `artifacts/freeze-r12-quality-independent-proof.json`;
raw report SHA-256
`aff1378e563921341476a373ffa844529088fa88734dc5f3ee510358a802d24e`.
The final full Game run is **2618 pass / 7 skip / 0 fail**, with TypeScript and
production build passing separately. This is not a runtime frame-time bound.

The same frozen R52 build's unprofiled headless car R54 reaches **56.85 FPS /
47.9 ms maximum**, intact. Profiled flight R52 reaches 101.68 FPS / 41.8 ms
maximum, intact. Worker-profiled car R55 reaches 64.62 FPS / 40.5 ms maximum,
but collision and late body-currentness gates fail. Different scene histories
do not prove a paired speedup, freeze-caused crash or desktop performance.
Strict normal-window R53 fails before scoring because its separately launched
window reports hidden before game boot. No visibility/quality/scenario gate is
relaxed. See the [Game follow-up](../../thegame/docs/verification/freeze-followup-20261023.md)
for the immutable build, raw clocks, source proofs and retained failed results.
The real-window 60 FPS/no-freeze goal remains unmet/unverified.

The later artifact-only visibility locality/filter-map microexperiment is
rejected: paired prepare/project timing changes sign or regresses in the
R54/R55 count proxies. Its exact 36-frame four-variant order/revision/counter
and throw/retry oracle is not a measured real-world speedup. No visibility
source is changed; raw variants, counts and limits remain in
`artifacts/freeze-visibility-audit-20261023/`. Game's setter shortcut is also
unshipped (less than 0.015 ms whole-update saving). The paint-scar source audit
identifies whole-body rebuild coupling, but no unsafe key omission or visual
damage freeze is applied. See the linked Game follow-up for these separate
source/measurement scopes.

## Bounded environment worker — 2026-10-23

Engine `828c46a54e6f87f246fddac650e865198f9c4d45` passes `bun run check`:
**1094 pass, 19 skip, 0 fail**, 1113 tests, 61.549719 seconds, including project
typecheck and production build. Raw log
`artifacts/freeze-engine-full-cooperative-r2.log` has SHA-256
`9af8a7f5d87f3a9919488359362e868962b194ad3085ef1f552b66a2bcbb2e17`.
The entry's staged line endings were normalized after the run; its code is
unchanged. The numerical source, driver and final tests retain their reviewed
content. This result supersedes the earlier main-only full Engine count below.

The background map bake uses an explicit numerical phase cursor. Proxy copy,
512-sample SH integration, cold direction tables, tile filtering and every pixel
candidate spend finite work credits; each notification allows at most 4096
operations, checking its secondary time target between 32-operation chunks.
The existing single MessageChannel alternates ports so a handler cannot keep
refilling its own receiving queue. One cursor and one pending notification
remain. Only complete SH and all nine original mip levels publish. The public
synchronous bake, host active/latest/reset/idle behavior and graphics settings
are unchanged.

Thirteen new tests plus the ten existing environment-owner tests verify full
frozen SH/F16 bytes, credit 1 and 4096, maximum canonical proxies, mixed NaN
branch behavior, actual worker errors/termination, request reentry, cancellation,
and both port directions. Root's strengthened heartbeat assertion exposed an
earlier false positive: missing heartbeat index -1 had passed an ordering test.
The first full check retains **1093 pass / 19 skip / 1 fail** in
`freeze-engine-full-cooperative-r1.log`. The corrected independent local
heartbeat test reproduces the old actual entry's failure and passes after port
alternation. It establishes that particular event-loop opportunity, not universal
scheduler fairness or a wall-time deadline.

The first two generator variants are rejected and retained. In the final small
Node/V8 paired diagnostic, two-proxy warm driver elapsed times are 60.62/59.58 ms
against synchronous 58.40/57.70 ms. Cold driver is slower: 152.93/169.61 ms against
113.14/100.99 ms. Thread CPU counters are quantized. These two-round fixtures do
not establish Chrome FPS or the distribution of actual world probes. Large
typed-array allocations/zeroing, GC, transfer/upload and OS scheduling remain
atomic boundaries without a latency guarantee. No claim attributes R50's RAF
gaps to this bake. Complete raw results, rejected sources and exact source hashes:
`artifacts/freeze-cooperative-environment-bake-20261023/RESULTS-R4.md`.

The isolated x-sweep physics and floor-admission proposals remain unshipped;
neither is part of this correctness result.

## Current main and retained APIs

Engine merge `d7577faf3e4f8f3ea9798628994bea55e2598dbb` has parents
`5b33e4aa816eac6658974587cad5022c9b54b71e` and fetched main
`ba9ffd0a08fcc2a9e411936948da23a76315433e`. The incoming change adds bounded
causal reappraisal. The merge changes ten acting, documentation, fixture, test and
benchmark files; it does not change rendering, Scene, physics or the Game save.

All thirteen authored actions remain: listen, ask, explain, decline, acknowledge,
clarify, withdraw, greet, think, celebrate, comfort, startle and tired. The six local
NPC gestures retain their authored offsets and motor paths while facial expression
uses main's mixed positive/negative, fear and anger channels. The public cue schema
remains version 1. Existing NPC reducer and public speech exports remain available.
Frozen pre-merge fixtures verify all thirteen neutral cues and motor samples.

`LegacyNpcMind` and `migrateNpcMind` restore old nested `ActingMind` version 1 into
version 2 without changing the outer `NpcMind` version 1. Identity, goals, original
memories, relationships, needs, decisions, attention, thoughts, pending gestures and
serials are preserved in owned output. Old aggregate affect becomes a baseline at
the stored simulation time; old observations do not become newly rewarded or
reappraisable evidence. Current snapshots are validated and copied too.

`advanceActingMind` samples one canonical emotion state and derives matching affect
at the same time. NPC idle ticks and need updates no longer advance only affect.
Prospective events may change subjective appraisal and ordinary elapsed need growth;
they cannot satisfy a need, resolve/block a decision or enqueue a response gesture.
Those consequences require an actual authority receipt. Both compatibility defects
have retained failing-before/passing-after witnesses.

The causal window is bounded to 32 observations, with up to 24 current and 24
baseline relationship entries. Validation/reappraisal still allocates and replays
bounded history; this is not a zero-allocation NPC tick or a measured GC improvement.
See [Acting contracts and focused verification](ACTING.md).

## Complete correctness checks

| Checked source | Passed | Skipped | Failed | Total | Recorded duration |
| --- | ---: | ---: | ---: | ---: | ---: |
| Engine `d7577faf` | 1081 | 19 | 0 | 1100 | 81.5116659 s |
| Game `75a77684e43cb672159385a7fc8bc787ec8e83ad` | 2531 | 7 | 0 | 2538 / 397 files | 790.94 s |

The Engine log starts with the full check script: TypeScript project typecheck,
production TypeScript build and `node --test test/*.test.mjs` (`bun run check`).
Raw log: [freeze-engine-full-final-main-r1.log](../artifacts/freeze-engine-full-final-main-r1.log),
SHA-256 `b60b96b9904eb0ddeb7b5f4704188a2f19f67c476ae077ebc7e254cc4f6aa042`.
It includes the new nested migration, synchronized clock, prospective-receipt and
thirteen-gesture regressions, together with existing NPC and speech checks.

The Game log records Bun 1.4.3 with two parallel test workers and 9,319,112
assertions. Raw sibling log:
[freeze-game-full-final-main-glass-r1.log](../../thegame/artifacts/freeze-game-full-final-main-glass-r1.log),
SHA-256 `69f18037f14a2422438e3741efdd1f57b53ee0381345e28ebfaff4287495292d`.
Its seven PostgreSQL prerequisite-dependent checks are skipped. These numerical
checks do not establish native graphics equality or transport frame pacing.

## World and Office ownership

The Game uses its own NPC #113 mind/schema; it does not import Engine `NpcMind` and
is not migrated through `migrateNpcMind`. Game seed 29, world revision 13 and the
canonical authority/world clock remain owned by the existing Game runtime. The
merge adds no SQLite migration, replacement city, second physics simulation or
automatic population enrollment. Existing Office layout, collision, accounts,
businesses, workforce and saved vehicles remain in their established owners.

The full-suite result is not a new saved-world load proof or evidence that every
resident JSON byte is unchanged. Existing backup, protected-row/identity/wallet,
Office and preservation evidence remains separately scoped in the
[Game integration record](../../thegame/docs/verification/engine-main-worldlife-20261021.md).

## 2026-10-25 — vehicle constitutive acoustic source

`StructuralBody.dissipation` observes measured plastic work and released member energy at fracture, centroid, area and substep duration. The physical solve is unchanged by the observer. Dormant/elastic steps emit zero work. `panelWorkExcitation` derives excitation from the shared plate material and radiation impedances. Game tyre snapshots now carry actual per-axis friction power; Engine/Office causal validation accepts the exact eight-value wheel tuple and signed lockup. Canonical protocol is 18.

Engine build, project typecheck and Office typecheck passed. Stress/solid-contact/compound/Rust-default parity targeted tests: 32 passed, zero failed. Canonical connection/world-view integration: 74 passed, one mouse-input test failed; the suite is not fully green. Full Game verification, six real-keyboard circuit crossings, observed cold-start delays, later zero-long-frame driving spans, source traces, audible-output WAV and known paired-crush limitations are in sibling `thegame/docs/VERIFICATION.md` and `artifacts/vehicle-proving-ground/causal-*`.


## 2026-10-25 — phased deformable pair contacts and shared energy accounting

SolidWorld now coordinates prediction, structural iterations and finalisation for nearby active phased deformables. Unilateral contacts apply equal/opposite inverse-nodal-mass position impulses to their material bindings before velocity reconstruction. This path skips the former whole-body split translation. First-touch refinement remains before the original velocity impulse. Generic non-phased contacts keep their integration path. Queued continuous forces now act over all motion substeps and are consumed after the world step.

StructuralBody exposes the same predictor/projector/finaliser used by its complete step. Contacting cores can share a carried mechanical-energy budget, reserve kinetic/member elastic energy, subtract damping and allocate irreversible work proportionally to constitutive demand. Removing/reducing an owner releases its group membership. Default Rust-mode numerical parity remains covered; the Game stress-return path is TypeScript.

Build and canonical Game/Office typechecks pass. Targeted node --test test/structure-stress.test.mjs test/structure-rust-wasm.test.mjs test/compound-physics.test.mjs test/structural-solid-contact.test.mjs: **17 passed, 0 failed**. New tests check exact phased/full-step equivalence, combined momentum and energy for two colliding members, and full-duration force across motion substeps.

Canonical Game: **44 passed / 7 files**, plus **5 passed / driving-track.test.ts**. There are 27 recorded frontal/side cases at 15/35/70 km/h across M3/sedan/coupe and six offline controlled M3 circuit crossings. The new circuit has varied turns and a 180-degree R12 hairpin; the keyboard rack ceiling was removed. Detailed inputs, results and remaining limitations are in ../thegame/docs/VERIFICATION.md. No full-suite success is inferred.

The no-freeze browser acceptance is **not complete**. Offline Bun fixture max CPU was 92.78 ms; separately bundled Node/V8 max was 39.18 ms. Neither includes browser rendering/GPU execution. Chrome QA was inactive/minimized and throttled RAF near 1000 ms; those intervals are not claimed as gameplay performance. Active-tab driving/fullscreen/audibility verification awaits the user selecting the already-open proving-ground tab. Native screenshots and the retained throttled-run trace are under artifacts/vehicle-proving-ground/coupled-*. The project remains running with the current canonical source digest checked by tools/start-game-office.ps1 -Check.


Allocation follow-up: rest-volume and volume strain-rate queries use scalar arithmetic/reused gradients, eliminating their per-tetrahedron temporary vectors. Kernel build/parity/contact suite remains **17/17** and final Game owner/static-wall tests **9/9**. Both runtime before/after matrices preserve the 27 residual maximum offsets exactly. Latest fixture CPU maxima: Bun **45.19 ms** (max case p99 **7.97 ms**), Node/V8 **41.52 ms** (max case p99 **17.31 ms**). Earlier maxima remain in the before-allocation reports; no claim is made that a single timing comparison isolates every source of variance. Browser frame/GPU acceptance is still pending. Final canonical source digest matches a3a3491624f6d92115325334d7e38afb296528c6ffd7a3d10ea84177c6d9b924.


## 2026-10-26 — structural contact cost during the passenger suspension check

A real active Chrome track run exposed continuing NPC/player contact peaks (95.9 ms RAF / 54.8 ms physics span). The earlier dry-driving window is not evidence that crash frame pacing was solved. Added conservative per-sample swept world-AABB rejection before oriented structural static-box contact tests. Bounds include the rotated 6 mm contact skin and are refreshed each projection; nearby test order is unchanged. An ignored pre-change solver oracle matched 192,000 coordinates over 1000 seeded scenes and four projections each, with 14,628 projected coordinates and zero differences: artifacts/structural-contact-culling-parity.log. The permanent regression covers rotated skin corners and a moved SolidBox.

CPU profiling the same parked-across-NPC-lane 100 s production track fixture showed most active time in solveDistance/solveVolume. Stress distance lengths now use a direct squared norm in the ordinary exponent range, with scaled hypot retained at extreme exponents. Volume projection first uses a conservative squared bound to skip the seven scaled norms only when the original displacement limiter is certainly inactive; the original clamp remains near its boundary. No stiffness, mass, yield/fracture threshold, iteration count or activity/sleep threshold changed. Scalar distance evaluation may differ by floating-point roundoff.

Engine build and node --test test/structure-stress.test.mjs test/structure-rust-wasm.test.mjs test/structural-solid-contact.test.mjs test/compound-physics.test.mjs: **18 pass** (including all six Rust/native-contact parity tests). Game targeted suite is recorded in the sibling Game verification document.

Final live-browser scope: the optimised active player/NPC contact window had RAF p99 20.4 ms and window max 20.9 ms, but full-run post-parking maximum remained 97.8 ms with three >50 ms intervals. No-freeze acceptance remains open. Full raw before/after DOM inspector samples are in sibling thegame/artifacts/vehicle-proving-ground/suspension-browser-optimized-contact.json. Game final targeted suite: 117 pass, typecheck pass.
## 2026-10-26 — resident material streams for current nodal body poses

Extended `prepareTriangleStream` with optional borrowed static RGBA/UV/variation-seed attributes (seven Float32 values per expanded vertex). Cold bounded packing validates and copies them into owned stream state; current positions/normals retain the existing double-bank staging/cohort commit path. Public mesh/frame snapshots expose the correct static attributes without retaining the input. Disposal releases the added owned attribute buffer. The original no-attributes page bound remains unchanged; a largest-capacity attributed page adds 1,680,000 CPU bytes. No physics kernel/material/iteration changes were made in this follow-up.

`bun x tsc -p tsconfig.build.json` passed. `node --test test/triangle-stream.test.mjs`: **14 passed**, including attribute parity, input mutation after preparation, same-resource hot updates, invalid capacity, atomic page transactions, scene/query bounds, cache lifetime and cleanup. Log: `artifacts/live-body-stream-final-tests.log`. Sibling Game production integration uses these resident streams for actual node-derived body poses; its verification document records browser and contact evidence separately.



## 2026-10-28 — predictive door stops and readable dry asphalt

RotationalSpring now solves unilateral closed/open stops independently of the handle torque limit, including a pre-prediction velocity solve. Penetration recovery is bounded to 1.5 rad/s and reactions remain equal/opposite on the same owners. The existing implicit drive/damping remains; it cannot pull a door through a jamb. The Game integration adds localized jamb contacts and removes duplicate live-skin deformation / disconnected body islands; see the sibling Game verification log.

Dry asphalt uses a broad weathering field plus smaller mineral grains/normals with an analytic pixel-footprint fade. Game supplies a grey display-RGB track base and more clear-sky fill. No physical asphalt friction, solver rate, or global speed limit was changed.

Checks: bun run typecheck and bun run build passed. node --test test/rotational-spring.test.mjs test/point-fastener-cache.test.mjs test/rounded-query-fastener.test.mjs: 11 passed / 0 failed, including inward slams and powered end stops at 60/120/240 Hz. Actual Chrome Game QA showed readable tyre marks and bounded damaged geometry; this does not establish FPS or a full Engine-suite result.


## 2026-10-28 — articulated tyre volumes and explicit contact ownership

StructuralSolidContactSolver accepts a node-centred convex support function and an ownership-enable predicate, keeping the existing sphere broad bound and swept oriented box / finite-plane contact path. Game uses an oriented cylinder support only after a reduced suspension corner becomes articulated; intact tyres do not receive a second support constraint. Compound contacts preserve each shape's structureNode identity into velocity and phased position constraints, and dynamic manifolds group by node owner so a hanging tyre is not pruned into the chassis manifold. Node-selected contacts do not use the whole-body escape normal.

Checks: bun run typecheck and bun run build passed. node --test test/structural-contact-volume.test.mjs test/rotational-spring.test.mjs test/point-fastener-cache.test.mjs test/rounded-query-fastener.test.mjs: 14 passed / 0 failed. New cases cover axial/radial/tilted tyre support, swept sidewall collision with a thin wall, and no duplicate structural support for a reduced corner. Sibling Game tests additionally cover off-centre dynamic contact P/L preservation and exact hub ownership. These are CPU physics checks; they do not establish GPU FPS or full-shell collision fidelity.


## 2026-10-28 — physical closure material attachments

PointFastener can sample an actual deforming material attachment on its B owner as well as A. The same fixed nodal stencil supplies position, velocity, inverse response and reaction. Missing material marks an attachment unavailable rather than pinning to a remapped rendering node. Static endpoint joints now participate in their dynamic island; static ignore pairs are respected in contact/refinement generation. Engine delegates refinement activation to the owner for every positive closing approach instead of imposing a global 0.9/1.2 m/s threshold. RotationalSpring optionally accepts actual material torque points/current lever and a panel-oriented radial direction; existing default rigid callers retain their original frame path.

Checks: bun run typecheck and bun run build passed. node --test test/point-fastener-material-anchor.test.mjs test/point-fastener-cache.test.mjs test/rotational-spring.test.mjs test/rounded-query-fastener.test.mjs test/structural-contact-volume.test.mjs: 17 passed / 0 failed. New checks cover deforming B attachment sampling, absent material support, and a real mass-zero joint supporting gravity without colliding with its ignored support body.

Sibling Game material-panel/load-path and glass tests passed: physical dent before mount failure; the same graph survives separation; positive remaining lumped masses, first-moment/P/L conservation and passive energy handoff under a strict uniform boost; glass reads the actual door frame. A separate rear 40 km/h crash assembly test still fails its requirement for zero boot angular velocity / assembly sleep after 10 seconds. This remaining severe damaged-assembly settling issue is not claimed fixed by the Engine unit results.

## 2026-10-28 — coupled material fasteners and quiet component handoff

Material PointFastener constraints now project their finite spring compliance between compatible active graphs during each shared structural iteration. Their late velocity solve supplies passive damping instead of a second stiff spring bias; converged spring/damper reactions still determine physical overload and fracture diagnostics. Fixed mass-zero support anchors use the same projection path. Contact refinement precedes a fixed-point activation of the connected material component, so the first impact does not fall back to an uncoupled stiff velocity spring.

Quiet material-joint components reduce together. Each graph retains its internal-motion quiet criterion; no velocity or activity threshold was raised. The common handoff prevents one quiet leaf reducing and then being immediately reactivated by its still-active parent. The Game adapter supplies the current live nodal full inertia at part reduction. Generic rigid callers retain the diagonal inertia path unless they supply a full tensor.

RotationalSpring uses the actual skewed material-couple Jacobian for its effective angular mass. Its check straps now use their existing finite limitStiffness and implicit critically damped response, rather than prescribing angle-error/dt penetration recovery indefinitely. The former recovery could inject energy while trying to straighten a permanently folded flange. The actual rear40 Game case now retains both boot hinges, reduces once, and reaches exact zero rigid velocities with the connected assembly asleep after 10 seconds. A later handle command wakes the same physical owners; that damaged lid can remain blocked by its loaded deformed jamb rather than attain pristine travel.

Checks: Engine build passed; rotational-spring and material-fastener tests 8 passed, including skewed-flange damping passivity, powered stops, inward slams at 60/120/240 Hz, static supports and connected sleep/wake. Canonical Game typecheck passed. Focused material-panel, mounted-settle, part-air and physical-glass tests: 16 passed / 3652 assertions. Yielding coupled graphs keep the measured kinetic + plastic + mount-spring ledger within the stated 2% numerical tolerance at all three fixed rates. Exact material impulse and mass-transfer P/L are tested separately. Full nonlinear XPBD graph integration is not claimed to preserve angular momentum exactly over long trajectories. These are scoped CPU numerical checks, not calibration against real crash data or proof of browser frame pacing. Final whole-crash fragment lifecycle and browser checks are recorded separately in the sibling Game verification log.

### Full reduced inertia tensor and current rigid momentum

SolidBody accepts an owned immutable full local inverse inertia tensor through setInverseInertiaTensor. It validates finite symmetric positive-definite data before replacing state, caches R*I^-1*R^T for impulses/effective mass, and retains the existing diagonal path when no tensor is supplied. The forward tensor is derived once for angularMomentum(); broad-phase torque sweep uses a conservative row-sum spectral bound. Active nodal owners continue to account their actual particles.

Final root Engine checks: bun run typecheck and bun run build passed. node --test test/compound-inertia-tensor.test.mjs test/compound-physics.test.mjs test/point-fastener-material-anchor.test.mjs test/point-fastener-cache.test.mjs test/rotational-spring.test.mjs test/rounded-support-refinement.test.mjs test/rounded-query-fastener.test.mjs test/structural-contact-volume.test.mjs test/structure-stress.test.mjs test/structure-rust-wasm.test.mjs test/material-uniforms.test.mjs: 41 passed / 0 failed. Logs: artifacts/vehicle-closure-final-typecheck.log, vehicle-closure-final-build.log and vehicle-closure-final-tests.log. Tensor tests check rotated off-diagonal impulse/momentum/work/effective mass, owned input, cache replacement, invalid atomic updates and diagonal compatibility. These focused checks do not establish full Engine-suite or native GPU/FPS success.

Game integration follow-up: an intact reduced suspension at its real maximum stroke now contributes a finite-tyre support anchor to the active chassis structural contact projections. The existing subframe translation plus moment-preserving body couple owns that reaction. It tests already-cached finite static planes independently of whichever dynamic body won the suspension query; normal suspension travel and loose/detached hubs do not receive duplicate support. No Engine kernel API, travel limit or rendered hub offset changed in this follow-up. Four scoped Game tests / 56 assertions verify nonzero tyre support on flat/tilted planes at 60/120/240 Hz, external ground impulse and moment, unchanged mass, and no projection for unloaded, stale, filtered, disabled, out-of-bounds or articulated cases. Six actual finished-mesh crash cases additionally passed the original 10 mm tyre guard: worst rubber penetration 0.0436 mm and all metal rims at least 15.625 mm above the road. These are CPU geometry/contact checks; final browser evidence belongs to the sibling Game record.

### Immutable material-prism pose cache (2026-10-28)

The world-triangle geometry path now lazily reuses a canonical local prism, with immutable world snapshots and exact nine-coordinate/thickness/support-ID invalidation. Repeated deformation uses direct predecessor construction rather than paying for local+world builds. Custom point transforms, nonrigid poses and world-resolution collapse keep the direct path. No collision surface, solver pass or source attribute was removed.

Engine typecheck/build passed; the nine-file scoped node --test command in docs/verification/world-triangle-cache-20261028.md passed52 tests/0 failures, including four new predecessor query/reentry/immutability/real-impact parity cases and the existing structural energy tests. Logs: artifacts/world-triangle-local-cache-tests.log. Seven alternating component pairs give median time ratios0.832 rotation/0.583 translation/0.915 continuously deforming inputs; shared-host variation means these are component CPU samples, not whole-physics or native GPU/FPS evidence. Exact freeze calls per steady face are35→30/20/31 respectively. Artifacts and numerical tolerances are documented in the linked note. Production source ownership is limited to the worldTriangle/boxes slice in compound.ts; other concurrent structural/native changes require their own final integration.

### Final coupled-material integration (2026-10-28)

Root reran Engine typecheck/build and the exact eleven files `structure-bending.test.mjs`, `finite-vector-length.test.mjs`, `structural-direct-fallback.test.mjs`, `structural-sparse-wasm.test.mjs`, `material-angle-gradient.test.mjs`, `point-fastener-material-anchor.test.mjs`, `rotational-spring.test.mjs`, `compound-inertia-tensor.test.mjs`, `compound-pose-sleep.test.mjs`, `structure-rust-wasm.test.mjs`, `world-triangle-local-cache.test.mjs`:47passed,0failed, no skipped/cancelled tests. Log `artifacts/vehicle-final-engine-tests.log`. This includes signed-angle rollback, material Schur reactions, near-collinear square-root fallback, pure native sparse parity, full inertia, actual pose-travel sleep and unchanged legacy ABI checks. See PHYSICS_ENERGY_ACCOUNTING.md for nonlinear/timestep and energy-accounting limits; sibling Game verification owns actual vehicle/render/60s/browser acceptance and the remaining heavy-collision CPU deficit.

Whole-world follow-up: `SpatialHash` now uses exact occupied-cell traversal when the query rectangle would cost more than the occupied buckets, restoring numericX/Z and original per-bucket insertion order before existing dedup/filter/scratch/cache logic. No query radius or collision limit is imposed. The real triggering Game defect was a tunnel wheel-stop projecting toward an overhead plane, fixed separately in Game; the spatial fallback does not excuse an invalid physical radius. Root typecheck/build and `spatial-large-query`, `spatial-owned-fill`, `spatial-cached-bounds`, `spatial-broadphase`, `compound-physics`, `world-triangle-local-cache` pass35tests/0failures. Log `artifacts/vehicle-final-spatial-tests.log`. Huge finite queries, groups, oversized items, tied ray candidates and normal-query parity are included.
