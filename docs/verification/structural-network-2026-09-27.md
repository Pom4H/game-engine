# Structural numeric channels — first transfer, not the complete arena

Base: `f292c28c36c8e9f5c12e9340aa95e513833647ea`, PR #26.
Sources were unpacked locally from the measured-source archive of Actions run
36344892922. This was not a successful `git clone`; direct GitHub DNS was unavailable.

## Reused approach

Inspected thegame `src/game/net/causal/replication.ts` (blob
`da869b5134ccd4871217d8983cff456ab4b49a19`): one authoritative publication,
shared encoding, definition revisions and independent presentation sampling.
Also inspected PR #82 at `a8cd42d7c91e73995ab79b2bdb09c23da8d58655`,
`src/docs/crash/fixture.ts` and `worker-client.ts`: one physical owner, bounded
recorded frames and replay that does not re-run that owner's solver.
Those are the transferred principles, not a claim that thegame already contains
this exact networked football implementation.

The engine already has Projection, Publication, Replica and structural skin binding.
No second solver, network transport, interpolation history or replay engine was added.
The missing numeric-array field now uses their existing flattened representation:

```ts
import {projection, vector, vector3} from '@rom4/game-engine/network';

// Build once for the installed topology. body is an existing StructuralBody.
const visible = projection('ball-cage/world-space/v1', {
  center: vector3(),
  nodes: vector(body.position.length),
});
const frame = visible.capture(stamp, [{
  id: 'ball', generation: 0,
  data: {center: body.centerOfMass(), nodes: body.position},
}]);
```

Only listed fields are copied. Positions and nodes are sampled at the same frame
and interpolation alpha. The received Float64Array can feed applyStructuralSkin.
This example sends world-space nodes; do not also apply the center as a mesh
translation. Different coordinate conventions require an explicitly different schema.

Vector width is fixed per schema, 2..8192 components. Total record stride is at most
8192. The existing maxBytes cap now also limits flat numeric payload BEFORE copying
records on capture/read, in addition to encoded UTF-8 size. This is not a JS heap cap.
Frame copies and JSON encoding remain; no zero-copy, bandwidth or FPS improvement is
claimed. Existing scalar/vector3 wire signatures are unchanged.

A changed node ordering/rest topology needs a new installed definition and generation
(or schema/epoch reset); equal vector lengths alone do not establish compatibility.
Existing generation fences suppress interpolation across lifetimes. This patch does
not install new topology, stream fracture meshes or restore hidden solver state.

## Local verification

Node 22.16.0, TypeScript 5.8.3 with locally available Node types. The package-declared
TypeScript ^7.0.2 / Bun 1.4.2 toolchain was not exercised locally.

- Typecheck and build pass.
- Network projection + new structural regression: 21/21 pass.
- Existing HTTP/SSE host + DSL integration: 32/32 pass.
- Untouched baseline full suite: 163/166 pass, 3 fail.
- Modified full suite: 169/172 pass, the SAME 3 fail: two clearcoat shader assertions
  and the M3 geometry triangle-count assertion. These tests were not changed.

The new structural fixture uses the REAL StructuralBody and static contact solver:
7 mass nodes, 15 skin vertices, 120 authority ticks, 64 active physical steps followed
by sleep, 31 encoded publications, 69 contact corrections and 0.08911822771002054 m
maximum change in an opposite-node span. Two independent replicas each sample 241
presentation times; both skins agree with the interpolated authoritative node history
within 1e-9 m. Replay leaves the live body's buffers and step count unchanged.
Duplicate/stale packets, invalid terminal components, generation discontinuities,
array lengths, typed-array ownership, step/angle sampling and budgets are tested.

The new two-replica structural test transports encoded strings IN MEMORY, not through
a browser or a WAN. The separate pre-existing HTTP/SSE regression still tests the
transform-only debug adapter. Neither test proves multiplayer latency or visual FPS.

## Not completed

SceneReplicaView and the debug host still publish transforms, not structural buffers.
The fixture is a coarse elastic contact regression, not a pneumatic football model.
No playable football arena, player controls, car/ball momentum coupling, client input
prediction/reconciliation, automatic mesh uploads, real-browser visual acceptance or
whole-physics rollback is claimed. Those are still integration work.
