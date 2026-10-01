# Engine-first development gate

Gameplay development is intentionally frozen.

Existing chess, Car/Ball and Thegame-lite code may remain as regression/acceptance
harnesses for engine systems, but no new game rules, missions, progression, economy,
combat, NPC behavior, boarding, persistence gameplay or world-specific feature work is
accepted until the engine foundation passes the gates below.

The order is deliberate:

1. Rendering
2. Networking
3. Audio
4. Physics
5. Game code

A game may be used to exercise a subsystem, but a subsystem must not depend on game
semantics to work.

## Rendering gate

Required evidence:

- deterministic scene/replay input produces reproducible frames;
- native WebGPU acceptance on the supported GPU runner;
- bounded frame submission and upload queues;
- no simulation wait on GPU completion;
- visual regression artifacts with expected / actual / diff;
- measured frame-time distributions and worst-frame evidence;
- streaming, LOD, lighting, reflections, shadows and material quality are validated
  without game-specific rendering paths;
- the renderer can present arbitrary engine entities from engine state alone.

A beautiful game screenshot is not a rendering acceptance test. The renderer is done
only when the same quality and performance are available to arbitrary scenes.

## Networking gate

Required evidence:

- one authoritative simulation state;
- bounded replaceable snapshot queues and backpressure;
- deterministic input sequencing, stale-input fencing and reconnect epochs;
- explicit reliable vs replaceable channels;
- replayable recorded network sessions;
- latency/loss/jitter simulation in CI;
- interest/visibility projection is independent of game rules;
- server load and bandwidth are bounded and measured;
- no client-side hidden second physics world.

The transport must move generic state/projections. Game messages come later.

## Audio gate

Required evidence:

- sound is a projection of physical/semantic engine events, not animation timing;
- deterministic offline rendering for regression;
- stable source identity and spatial placement;
- engine/tyre/contact/rotor/environment sources derive from shared physical state;
- bounded voices, work queues and DSP cost;
- no game-specific mixer architecture;
- recorded reference artifacts for audible regression review;
- replay produces the same event/audio timeline from the same trace.

## Physics gate

Required evidence:

- one PhysicsWorld / one state integration path;
- every force, torque and impulse has component + source + law provenance;
- cause-trace closes every resultant wrench with zero unattributed contribution;
- contacts/collisions are part of the same provenance chain;
- no car/aircraft/helicopter mode switch;
- wheels, wings, rotors, shafts and control surfaces compose on one body model;
- power/energy/momentum invariants are checked where applicable;
- deterministic convergence tests across supported substep rates;
- migrated Thegame mechanisms are treated as implementation material, not reality;
- real-world datasets become the validation target for physical fidelity.

## Gameplay unlock

Gameplay work may resume only when all four subsystem gates have an explicit,
reviewable CI status and no subsystem requires game-specific exceptions to pass.

At that point game code should be thin composition:

```text
engine primitives
    ↓
project/world description
    ↓
game rules
```

Game code must not become the place where missing rendering, networking, audio or
physics behavior is patched.

## Existing games

Chess, Car/Ball and Thegame-lite are retained because they already expose useful
engine stress cases. They are frozen as product/gameplay tracks. Changes to them are
allowed only when needed to prove or prevent a regression in an engine subsystem.

Their current behavior is not a target for realism and must not be used as a reason to
preserve an engine limitation.
