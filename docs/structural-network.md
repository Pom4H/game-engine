# Structural replication transferred from thegame

## What was reused

Source inspected: `Pom4H/thegame` at `702bc303569a1802e80689948205a1847c03dde4`:
`src/game/vehicle-deformation.ts`, `src/game/presentation.ts`,
`src/game/net/causal/replication.ts`, `docs/STRUCTURAL_PHYSICS.md`.
The structural documentation on `feat/coupled-softbody-contacts` was also checked.

The useful contract is a server-owned structural graph, compact `_frame` offsets,
`_beamBreak` flags and a shared rest-space skin binding. Render vertices are not
network state. The old adapter's car-specific panels/modules, globals, solver tuning
and reliable-definition packet routing are NOT copied into the engine.

The engine already has `StructuralBody`, `bindStructuralSkin`, `applyStructuralSkin`,
`Projection`, `Publication`, `Replica` and `SceneReplicaView`. This change connects
these existing primitives, without another solver, clock, publisher or transport.

## Contract

`buffer(length, options)` extends existing explicit projection fields to fixed-size
numeric arrays and typed arrays. Integer channels require step sampling. Scalar and
vector3 schema signatures remain unchanged. The original default stride budget is
still 128; larger layouts must opt in, with an absolute limit of 32768 scalars.

`StructuralProjection` combines the SAME `sceneMotion.fields` with node offsets and
32-bit packed break masks. All channels belong to one entity generation and one
snapshot stamp. Node offsets interpolate; breakage does not. Capture uses reusable
scratch buffers; the existing immutable snapshot capture owns the published copy.
`Publication` encodes that snapshot once per cohort, not once per subscriber.

The rest template is installed separately, once. `templateId` is a versioned
application contract: change it whenever rest coordinates, node order or constraints
change, even if their counts remain equal. It is not an automatic content hash.
Replace the binding at a coordinated epoch/generation change; an old binding hides
rather than applying a new generation to an unrelated cage. Arbitrary topology
streaming/asset negotiation is not implemented here.

Node positions and rest coordinates must be in the same space. Local cage nodes use
the object's pose. A world-space structural solver uses identity pose. Never apply
rigid translation/rotation in both places.

```ts
import {StructuralProjection, Publication, Replica} from '@rom4/game-engine/network';
import {applyStructuralSkin} from '@rom4/game-engine';
// rest is a stable Float64Array copied from the template, not a live solver buffer.
const channel = new StructuralProjection('ball-shell/v1', rest, constraintCount);
const frame = channel.capture(stamp, [{
  id: 'ball', generation: 0,
  position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1],
  nodes: body.position, broken: body.broken,
}]);
const bytes = new Publication(channel.schema, frame).text(); // existing JSON codec
const replica = new Replica(channel.schema, stamp.epoch);
replica.receive(channel.schema.decode(bytes), arrivalSeconds);
const shape = channel.bind('ball', stamp.epoch, 0);
const sampled = replica.present(nowSeconds);
// Existing SceneReplicaView can apply the pose prefix from this exact same sample.
if (channel.apply(sampled, shape)) {
  // Existing skin binding and caller-owned output; no physics on packet arrival.
  applyStructuralSkin(binding, channel.rest, shape.nodes, output);
}
```

Bindings and output buffers are created once, outside playback loops. When using
`SceneReplicaView`, propagate `shape.visible` to the bound visual, so an unknown
structural generation is not drawn using its predecessor's mesh. Break flags are
available to presentation, but this helper does not generate detached mesh islands.

This is a presentation projection, **not a restorable solver checkpoint**. It does
not carry nodal velocity, plastic rest lengths, force buffers or integrator history.
Recorded frames can be scrubbed without advancing physics; that is not rollback or
client prediction. The existing editor's default authority endpoint remains
motion-only until explicitly supplied a structural channel and matching manifest.

## Verification

Base: game-engine `f292c28c36c8e9f5c12e9340aa95e513833647ea`.
Local Node 22.16.0 / TypeScript 5.8.3; the repository's declared TS ^7.0.2 was not
available offline. No dependency or lockfile changes.

- Typecheck/build pass; 12 new tests pass.
- Full suite before: 163/166; after: 175/178. Same three existing failures:
  two clearcoat shader expectations and M3 triangle count 11922 vs expected 9798.
- Existing network-host/DSL integration tests: 32/32 pass.
- The loopback SSE fixture runs the existing structural solver against a static
  floor, publishes 61 snapshots after 240 substeps and feeds two independent replicas.
  The maximum relative edge strain is 0.06427146396816397: this is real non-rigid
  deformation, not just translating a rigid mesh. Max node reconstruction error is
  1.1102230246251565e-16; skin output error is 0 for this finite fixture. Maximum
  packet size is 716 bytes including the schema. One encoding per publication.
- Tests cover partial-packet rejection, packed bit 31/32/64, integer validation,
  malformed input, explicit budgets, loss/reordering, seek, epoch/generation fencing,
  buffer reuse and skin binding at two render densities.

Run after building:

```sh
node --test test/network-structure.test.mjs
node tools/structural-network-harness.mjs
```

No browser/GPU visual acceptance, WAN latency guarantee, full-state rollback,
pressurized football model, car/ball multiplayer gameplay or FPS improvement is
claimed. The fixture is a deformable tetrahedral graph, not a completed game mode.
