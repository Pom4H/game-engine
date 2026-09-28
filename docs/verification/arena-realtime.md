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
