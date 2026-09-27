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
render is claimed. `tools/docs/arena-qa.mjs` is the separate native two-page WebGPU
acceptance test; it writes screenshots and a browser report. Native acceptance
must be reported from its actual run, not inferred from these CPU tests.

## Deliberate remaining limits

The game is an independently tuned prototype: rigid car chassis, soft elastic-volume
ball, horizontal wheel support, nodal soft/box contacts, reliable TCP/SSE and delayed
passive presentation. No full deformable cars, wall-driving, gas-pressure model,
client prediction/reconciliation, rollback, production matchmaking/authentication,
WAN quality or numerical Rocket League equivalence is claimed. All existing editor,
vehicle, console and network features are retained in the one integration branch.
