# Network foundation

This branch extracts the transport-independent network core from the older stacked
network/game integration work.

It intentionally contains no gameplay protocol, no Car/Ball or Thegame messages, no
population policy, no renderer ownership and no client physics.

## Contracts

- `Projection` is an explicit numeric whitelist. Unlisted state never enters a frame.
- `Publication` encodes one immutable frame once for a subscriber cohort.
- `LatestStateOutbox` is a one-slot replaceable queue for absolute state only.
- `Replica` owns bounded absolute-snapshot history and interpolation/replay.
- `PlaybackClock` maps arrival time to presentation time without turning wall time into
  simulation time or extrapolating after the latest cause.
- `AuthoritySession` exposes bounded pause/resume/step/dump commands at authoritative
  tick boundaries with explicit authorization and epoch fencing.

Reliable commands/events are deliberately not modeled as replaceable state. A future
transport layer must expose that distinction instead of hiding it behind one queue.

## Engine-first gate

This PR proves generic network invariants only. Gameplay remains frozen.

Acceptance requires deterministic tests for schema validation, stale/epoch fencing,
bounded history/queues, replay sampling under loss/reordering and authorized authority
stepping. QUIC/WebTransport, congestion/backpressure and WAN impairment belong to the
next network layer and must remain generic as well.
