# Arena datagrams and arbitrary-orientation wheel support

Base: `34e8fb2c0f491f2ef4ed19612628c373647b7f1c`, same `codex/adaptive-core` branch.
Native transport contract inspected in thegame `src/game/net/causal/native.ts` and
`src/server/causal-realtime.ts`: use the same native QUIC provider at the IO boundary,
not another copy of its game-specific publisher, clock, world or payload schema.

Local sandbox: Node22.16.0 / TypeScript5.8.3. Typecheck, build, docs build and syntax
checks passed. Full suite 228/231, versus base 215/218: exactly the same three failed
clearcoat22/28 and vehicle-interaction112 expectations. All 13 new tests passed.

The 180-tick binary fixture produced 774-byte snapshots, versus a maximum 5939-byte
JSON frame for the same state. At 60Hz the fixed application state payload is46440B/s,
not total network traffic. Maximum node-component reconstruction error was
0.0005000051067689526m. Integer fields/time/epoch were checked exactly; floating fields
were checked against their representation error bound. Single-packet atomicity,
corruption/range rejection, loss/reordering, antipodal quaternion sampling, 28-byte
input fields and bounded expiring outboxes are tested. No UDP delivery is inferred
from these pure codec tests.

The surface fixture verifies four-wheel support, jump reloading, surface-normal jump
impulse and propulsion on floor, side wall, end wall and ceiling. Roof-only contact
does not reload. A driven car climbs the actual visible collision ramps: 39 wall-
supported and111 ceiling-supported ticks in a300-tick fixture. Independent local
pitch/yaw/roll and arbitrary world-axis rotation across the Euler singularity are
checked. Boost pickup and4s/10s respawn use simulation time, not render frames.

Native QUIC/WebGPU verification is intentionally separate and must be read from the
Actions run/artifact for the pushed commit, not assumed from this local report.
The updated existing DSL pipeline installs the isolated native boundary and runs
`ARENA_TRANSPORT=webtransport node tools/docs/arena-qa.mjs`: two real clients, native
UDP counters in both directions, identical common datagrams and deformed replay
vertices, and the same console recorder. TLS keys are ignored and never archived.

Limits: static box/plane wheel support and arcade adhesion, not generic moving mesh
support or soft-ball flip reset. Rigid car chassis, elastic-volume soft ball; no gas
model, full solver rollback, prediction/reconciliation, hostile public deployment,
measured WAN latency guarantee or general no-stutter/FPS claim. Existing projection,
worker, renderer, shell and explicit SSE diagnostic route remain shared.

## Native verification and boundary fixes

The initial native run `36381890293` at `035b7cc` passed the existing editor but
reported zero QUIC handshakes. Provider 0.3.0 exposes the requested port rather than
the OS-selected ephemeral port when zero is supplied. Commit `68cb403` supplies a
real selected UDP port; private keys and certificate verification remain unchanged.

Run `36382483835` then established two QUIC sessions and bidirectional datagrams but
lost one client around restart. A deterministic worker regression reproduced the
race: an already-admitted old input can follow a restart in the worker queue. The
authority now drops obsolete epochs without consuming the new sequence or closing
the peer. The test failed before the fix and passed afterward. The HTTP adapter
retains its established 400 response for stale input; the unreliable path drops it.
No ownership check or stale-sequence assertion is weakened.

Run `36382919936`, commit `ca93c9872fafd85160d0ba165ce4a5be6428f5bb`, passed BOTH
native editor/console acceptance and actual two-browser WebTransport/WebGPU arena
acceptance. Original artifact: `10953541805` (`dsl-playground-evidence`).

- Two authenticated QUIC sessions remained active after restart.
- Native counters: 775 input and 719 output datagrams; no reported drops, rate limits
  or backpressure timeouts in this short loopback run. Native queue bytes were zero
  at the final sample. This is not a WAN loss or latency benchmark.
- 223 common decoded snapshots matched exactly across clients, including car pose
  and all soft nodes. Both meshes matched at replay time 2.7666666666666666 seconds.
- A real keyboard/mouse-driven impact produced 0.9667255756101265 m maximum change
  in the measured opposite-node span. This measures this elastic fixture, not a
  calibrated pneumatic ball.
- Both clients retained zero physics bodies/steps and no renderer errors or uncaught
  exceptions. The shared recorder captured 12 CPU frames and two real canvas images;
  available GPU samples matched their corresponding CPU frame numbers.

Subsequent local verification includes the two new host/epoch tests: 15 added tests
in total; full suite 230/233, with the SAME three inherited failures. The existing
HTTP/SSE arena regression also passes after restoring HTTP status mapping at the
adapter boundary. It is not a fallback for the UDP arena.

The final source is tested again by the same read-only native workflow after the
HTTP compatibility change. Read that final run's result separately; the native
numbers above belong specifically to ca93c98. No complete green-CI, production
release, zero-overhead or competitive-FPS latency claim is made.
