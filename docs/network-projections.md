# Network projections and the existing editor

This is a first executable transport-independent projection layer, with an opt-in
loopback HTTP/SSE authority/debug adapter. It does not replace thegame's live server.
It does not claim complete QUIC/WebTransport, population, audio or world streaming migration.

## Source and ownership

Inspected thegame `4e7a5777276610e344b045fde1eb6772eb07f582`:
`src/game/net/causal/replication.ts`, `playback-clock.ts`, `docs/RENDERING.md`.
The clock is adapted from that implementation. Per-publication reuse, revision/epoch
fencing and independent audiovisual sampling preserve its useful design; hard-coded
vehicle sound/seat/AOI fields were not copied into engine networking.

The simulation owns facts and clocks. A schema explicitly selects numeric facts:

```ts
import {projection, vector3, scalar, Publication, Replica} from '@rom4/game-engine/network';
const visible = projection('vehicle-view/v1', {
  position: vector3(),
  orientation: vector3('angle'),
  wear: scalar('step', 0, 1),
});
const frame = visible.capture(
  {epoch: 1, sequence: 1, tick: 60, time: 1, paused: false},
  [{id: 'car', data: {position: [0, 20, 0], orientation: [0, .3, 0], wear: .02}}],
);
const publication = new Publication(visible, frame);
const bytes = publication.text(); // One encoding for subscribers of this same cohort.
const replica = new Replica(visible, 1);
replica.receive(visible.decode(bytes), performance.now() / 1000);
const view = replica.present(performance.now() / 1000); // Does not advance physics.
```

Unlisted fields never enter capture; each cohort's schema is server-selected, not a
client ability to request private fields. These are absolute snapshots, not deltas.
Each frame includes the complete roster of that projection. Replacement queues are
ONLY for absolute state: commands/events/removals in a future delta protocol require
separate ordered/reliable semantics. The debug SSE transport is ordered/reliable and
has head-of-line behavior. Core synthetic loss/reordering tests do not prove WAN quality.

A frame is fully validated before reception changes state. Wrong epochs, old sequence,
clock regression and invalid final rows cannot partly mutate a view. Entity generation
changes do not interpolate across lifetimes. Full x/y/z survive sampling. No ground
height is independently guessed by a far LOD or flattened onto the XZ plane.

## Render boundary

Network receive/decode happens in a browser worker; it hands off at most one active
and one replaceable pending absolute frame. Render samples its bounded history on RAF.
`SceneReplicaView` changes existing presentation transforms only; it has no physical
bodies and does not rebuild meshes per packet. Meshes are supplied once in the debug
manifest. Missing packets keep the last known pose, not fabricated continued motion.

The adapter currently replicates moving entity position/Euler orientation/scale.
It does NOT yet stream arbitrary new definitions, fracture meshes, structural node
buffers, wound state, sound events or high-rate unwrapped wheel spin. Unknown parts are
counted rather than guessed. Replay covers the selected projection, not every state.

Explicit seek/epoch changes invalidate temporal history. Ordinary packets do not.
The network editor limits its own outstanding GPU frame submissions to two without
synchronously blocking RAF. This is bounded queuing, not a promise that shader/mesh
work always fits a frame. Preparation, validation and GC still cost time.

`PresentationLOD` is a reusable prepared-asset handoff with hysteresis and revision
checks; stale asynchronous asset jobs are rejected. `projectedRadiusPx` includes
height and FOV and is a conservative angular-size estimate for centered bounds, not
an exact arbitrary off-axis screen AABB. The selector owns no transform. A representation
swap must keep common pivot, extent/terrain samples and damage revision. Terrain mesh
stitching/geomorph, shadow LOD and GPU upload budgets are NOT implemented by this helper.
No complete seamless-LOD claim is made.

Population has a separate explicit cell-count projection, retaining vertical bands.
The harness uses 100000 synthetic positions; it does not run 100000 NPC brains, spawn
impostor residents or measure whole-server capacity. Detailed actors and aggregate
cells need an atomic ownership/handoff policy when integrating real population runtime.

## Pause and inspection

```sh
bun install --frozen-lockfile
npm install --prefix tools/docs --ignore-scripts
bun run build
bun run docs:build
NETWORK_DEBUG=1 node tools/docs/server.mjs
```

On Windows PowerShell: `$env:NETWORK_DEBUG='1'; node tools/docs/server.mjs`.
Open the existing `/docs/` editor, select Wings, then **Серверный стенд**.
The physics runs in a separate Node worker. The client retains its same renderer,
controls and AST editor, but the visible world becomes a non-physical replica.

- Server pause acknowledges a precise authoritative tick. Step requires that paused
  tick and epoch. Resuming clears wall-clock catch-up debt.
- The renderer/camera/editor continue while the authority is paused.
- Paint/optical/camera edits remain local. Physical authored edits require a server
  pause and compare-and-set tick. Structural changes explicitly start a new epoch;
  this is not live arbitrary topology surgery or a save migration.
- **Повтор сервера** downloads selected server-recorded frames, decoded in a worker
  and admitted four at a time. Scrubbing pins an independent presentation sample.
  The authoritative world is not rewound/resimulated by replay. **В эфир** returns live.
- **Дамп состояния** exports a bounded domain inspection including transforms,
  velocities, vehicle part diagnostics, history metrics and process.memoryUsage.
  It is explicitly `restorable:false`; no complete checkpoint/fork is claimed.
- V8 heap capture is separate, disabled by default. Enable `NETWORK_HEAP=1` locally,
  pause, then **Heap на сервере**. It blocks the paused authority isolate and writes
  `artifacts/network-private/authority.heapsnapshot`, never a download or CI artifact.
  The file can contain secrets and is not a solver checkpoint. It contains only the
  worker isolate's heap, not GPU VRAM or every process. Heap analysis remains a manual
  diagnostic operation; tests deliberately do not create or publish heap snapshots.

The host is loopback-only, rejects foreign Host/Origin/cross-site requests and needs a
random per-host token for commands. Authority commands default deny in the core.
Compiled programs, not arbitrary TS/source functions, go to the debug server.
This is a trusted local development endpoint, NOT a production authentication layer,
a hostile-mod sandbox, internet-exposed heap inspector or multiplayer editor policy.

## Budgets and verification

Default motion projection: 1024 entities, 2 MB encoded packet. History: 600 frames
and a 32 MB estimated flat-payload budget on debug server/client. Estimate excludes
JS object/Map overhead and is not actual heap residency. Slow SSE clients retain one
unsent absolute state, max eight viewers, max eight outstanding control requests.
The isolate is capped at 512 MB old generation. Rendering/imported source retain the
existing editor limits. Replay and dumps serialize in the authority worker, not RAF.

```sh
node --test test/network-projection.test.mjs test/network-host.mjs test/dsl-playground.mjs
node tools/network-harness.mjs
node tools/docs/network-qa.mjs
```

The browser harness uses real Chrome/WebGPU, actual loopback SSE and the production
editor. It asserts pause/step/replay and server-computed airborne height with ZERO
client physics steps. The publication benchmark compares repeated work with shared
capture/encoding of the SAME bytes, not against thegame (which already has batching).
No bandwidth saving, FPS, universal no-stutter or full population migration is implied.

## Rendering bottleneck found by the network fixture

The first native run exposed a 256px six-face environment cubemap bake in the
render loop whenever a following camera crossed a 0.5 m origin cell. In that run
environment work occupied almost all CPU frame time (p95 about 72.5 ms). The network
functional checks passing did not mean smooth rendering.

`EnvironmentBaker` moves this SAME evaluator into a renderer-owned worker: one active
job, one replaceable pending input, one complete ready result. All nine mips publish
at the next render boundary; no partial face or mip reaches shading. A changed scene,
content revision or explicit seek cancels obsolete work. The previous complete map
stays usable while the latest origin bakes. Resolution, all proxy contributions,
mip sizes and half-float output are unchanged; a golden byte hash was independently
captured from the prior evaluator. This is asynchronous update latency, not a lower
resolution approximation or a per-frame snapshot of current radiance.

The initial map on scene installation still builds synchronously. The measured-HDR
path is unchanged. Texture upload (4,194,288 bytes per completed map), light-probe
preparation, initial geometry and garbage collection still cost time. Worker failures
are reported and keep the previous map rather than secretly restoring a per-frame
synchronous bake. Jobs terminate on renderer disposal. No universal no-freeze or
instantaneous reflection-update guarantee is made.
