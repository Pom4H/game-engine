# Car-ball integration verification

Source start: `e716c954eee6538caff562eea66f7df6cd8b1870` in PR #26.
Included feature sources: console/recording `4d3bb2e3b9c71b141d2b42ef9d1c4199b0c73e3f`
and structural projection `9b0fb68d20f63d50de324034faa33c381637d969`.
Conflict resolution preserves #26's core timing statistics and exposes only one
fixed-width buffer API. Neither main nor the production site is updated.

## Local sandbox

Node 22.16.0 / TypeScript 5.8.3, using existing locally available Node types.
The declared TS 7.0.2 / Bun 1.4.2 are left unchanged, not claimed locally verified.

- Typecheck, engine build and portable editor build pass.
- New car-ball / real two-client HTTP-SSE tests: 10/10 pass.
- Combined buffer and pre-existing projection tests: 21/21 pass.
- Integrated structural projection tests from #28: 12/12 pass.
- Integrated console / recording / native-trace unit tests: 24/24 pass.
- Existing HTTP/SSE editor + DSL tests: 32/32 pass.
- Full suite: 215/218 pass. The same three prior failures remain: two clearcoat
  assertions and the imported M3 triangle-count assertion. No old expectations
  are weakened. Baseline e716 was 169/172.

The physical fixture has 67 mass nodes and no rigid ball proxy. Car controls feed
one existing rigid integration, with two substeps per 120 Hz tick. In the isolated
100-substep ball/box test, max linear momentum error was 7.958078640513122e-13 kg m/s.
This is a finite test, not a general solver error bound or energy-conservation proof.

The live loopback test produced 99 common absolute publications at tick 402 for two
clients, maximum opposite-node span change 0.6011354804674052 m, and a 5563-byte final
JSON publication in that run. Scheduling and packet sizes may vary. It checks
ownership, stale/malformed input, generation/epoch, replay and shared snapshots;
it does not model WAN congestion. The presentation test verifies zero client
physics bodies/steps and unchanged live solver buffers during repeated seeks.

Dynamic mesh tests use a GPU mock to verify one vertex-buffer update and unchanged
index/color buffers. This does not establish native GPU or visual correctness.

Sandbox Chromium navigation was blocked by a managed policy. No sandbox browser
render is claimed. The following tests ran on GitHub Actions after local validation.

## Project toolchain and native browser acceptance

Integration run `36351257655` tested exact source tree
`fa1f8c689879e6b2daf07de07c420bb5eb46bee2` using Node 24.21.0, Bun 1.4.2 and
TypeScript 7.0.2. Typecheck, engine build, editor build and 99/99 focused tests passed.
A separate untouched-base worktree reproduced precisely the same three full-suite
failures: 169/172 before, 215/218 after. The workflow's publication step was denied
workflow-file permission; the already tested commit `4e383a0` was then published by
the authorized GitHub connector. Installer and transport payload files are absent
from the final tree. No permissions or branch protections were weakened.

Native Windows run `36351658625`, commit
`432ff1ab5f128883d24d10866e36a0847b9810d0`, passed BOTH the original editor/console
browser acceptance and the two-player arena browser acceptance. The overall workflow
remains red because the unchanged full regression suite still has those three failures.

The arena test ran two actual Chrome 153 pages with the real WebGPU renderer, actual
keyboard/mouse commands, HTTP input and SSE state from the authoritative Node worker:

- Distinct owned player seats and zero client physics bodies/steps throughout.
- 109 common authoritative frames compared exactly, including deformed ball nodes.
- Driving and boost caused a real soft-body impact; maximum opposite-node span
  change in that browser run was 0.48134885582238374 m.
- Both visible meshes were compared at the same recorded time, 2.908333333333333 s;
  vertex arrays matched exactly. Each tab is foregrounded and its real rendered
  scene time is awaited, since an inactive Chrome tab can suspend RAF.
- The existing console recorded 12 CPU frames and two real canvas images. Available
  asynchronous GPU samples matched their corresponding CPU frame numbers.
- Filmstrip scrubbing did not change the simulation or the replay playhead.
- No uncaught browser exceptions or renderer errors in either client.

Screenshots: `artifacts/arena/arena-kickoff.png`, `arena-soft-impact.png`,
`arena-player-two.png`, `arena-recording.png` and `arena-mobile.png`.
The mobile image uses Chrome viewport/touch emulation, NOT a physical phone test.
The run's original evidence artifact is `10942233321` (`dsl-playground-evidence`).
A compact, selected-field copy of its browser report is stored beside this report.

This is functional native acceptance, not a speedup benchmark or a blanket smoothness
claim. The trace includes first-map CPU initialization spikes (~192 ms and ~155 ms
on the two clients). This first synchronous environment preparation is not hidden by
quoting only warmed-up GPU timings. Recording, decoding and uploads also have costs.

## Deliberate remaining limits

The game is an independently tuned prototype: rigid car chassis, soft elastic-volume
ball, horizontal wheel support, nodal soft/box contacts, reliable TCP/SSE and delayed
passive presentation. No full deformable cars, wall-driving, gas-pressure model,
client prediction/reconciliation, rollback, production matchmaking/authentication,
WAN quality or numerical Rocket League equivalence is claimed. All existing editor,
vehicle, console and network features are retained in the one integration branch.
