# Integration verification — 2026-10-23

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
