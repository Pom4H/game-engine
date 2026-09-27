# One structural network projection

Integrated from PR #28 (`9b0fb68d20f63d50de324034faa33c381637d969`) into
`codex/adaptive-core`. The previous experimental `vector(width)` API is removed;
all fixed-size numeric channels use `buffer(width, options)`. This includes the new
car-ball arena. Existing scalar/vector3 wire signatures are unchanged.

```ts
import {StructuralProjection, Publication, Replica} from '@rom4/game-engine/network';
const channel = new StructuralProjection('shell/v1', restNodes, constraintCount);
const frame = channel.capture(stamp, [{
  id: 'ball', generation: 0,
  position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1],
  nodes: body.position, broken: body.broken,
}]);
const text = new Publication(channel.schema, frame).text();
const replica = new Replica(channel.schema, stamp.epoch);
replica.receive(channel.schema.decode(text), arrivalSeconds);
const shape = channel.bind('ball', stamp.epoch, 0);
channel.apply(replica.present(nowSeconds), shape);
```

Use identity pose for world-space nodes; local nodes use the object's pose. Never
apply the same transform in both places. `StructuralProjection` reuses the existing
sceneMotion prefix, bounded Projection codec and Replica interpolation. Node offsets
interpolate, packed break masks are discrete integer channels. A separately installed
versioned rest template supplies topology and skin binding. A new node ordering,
rest shape or topology requires a new template identity and coordinated generation/
epoch; equal lengths do not imply compatibility. Unknown generations hide the view.

Only one buffer codec exists. Default stride is 128; larger prepared layouts opt in
(up to 32768 numeric components). Both flat numeric payload before copying and
encoded UTF-8 have bounded sizes. That is not a total JavaScript heap budget.
`StructuralProjection` additionally limits nodes to 2048 and constraints to 16384.

The recipe transfers thegame's shared-publication / independently sampled presentation
and rest-template + compact node offsets + fracture bits principles. It does not copy
car-specific solver globals or maintain another clock. Restorable checkpoints, nodal
velocities, plastic rest history, arbitrary fracture topology streaming and detached
mesh generation are not supplied by this projection. Replay is presentation, not
physics rollback.

Run `node --test test/network-buffer.test.mjs test/network-structure.test.mjs` and
`node tools/structural-network-harness.mjs` after building. The latter runs the real
structural solver for 240 substeps and sends 61 publications to two actual loopback
SSE readers. The default editor authority remains transform-only unless explicitly
given a structural channel; the car-ball game is an integrated consumer of numeric
structural channels and a persistent dynamic render mesh.
