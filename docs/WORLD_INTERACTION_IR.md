# World Interaction IR v1 — typed causal semantics

World Interaction IR is the common **cause/interaction vocabulary** between
simulation, materials, environmental changes, sound, render and networking.
It is a bounded immutable observation of **committed** facts. It is not a
second simulation or a scripting/event engine.

## Authoritative producers

| World law | Producer | Recorded facts (SI units) |
| --- | --- | --- |
| environment.resolve | Scene weather module | temperature °C, snowfall m/s, wind m/s, humidity |
| physics.contact | PhysicsWorld | point m, normal, penetration m, impulse N·s, energy J, speed m/s |
| surface.contact-work | SurfaceEnvironmentSystem | physical surface work J, load N, contact patch, resulting field state |
| scene.impact | Scene impact event | actual materials, acoustic surface and event energy |
| scene.fracture | Scene fracture commit | fragment count, required/available energy J, thickness m |
| scene.mechanism | Scene mechanism commit | physical mechanism, event energy and point |

Producer authority remains in the existing domain:

- PhysicsWorld and its Rust/WASM kernels own their existing order and state.
- SurfaceEnvironmentSystem owns snow/water/ice/mud, persistent deformation,
  friction, traffic heat and work. The journal records accepted work *after*
  authoritative field mutation, not an invented parallel climate simulation.
- Scene decides fracture and plasticity synchronously from actual contacts,
  including the contact model fallback when material changes can be causal.
- Existing Scene events are the single source for sound synthesis/replay;
  no new sound equation is added.
- CausalRenderObservation and other Render IR resources remain projections.
- Network authority, storage and Meshwork continue to own their own commit
  and execution boundaries; observing the graph does not mutate them.

## Usage

~~~ts
import {Scene,eventsFromWorldInteractions} from '@rom4/game-engine';
import {MemoryContentStore} from '@rom4/game-engine';
import {projectSceneRenderFrame} from '@rom4/game-engine/execution';

const scene=new Scene(worldBinary); // a Rust-compiled .wscn or SceneSpec
scene.enableWorldInteractions(4096);
for(let i=0;i<120;i++)scene.step(1/60);
const graph=scene.worldInteractionGraph();
const events=eventsFromWorldInteractions(graph); // exact committed events

const store=new MemoryContentStore();
const projected=projectSceneRenderFrame(scene,store,{
  epoch:1n,frame:BigInt(scene.tick),includeInteractions:true
});
// projected.frame.interactionGraph.kind === 'graph'
// store.require(projected.frame.interactionGraph.hash) equals graph
~~~

Read a cursor window with scene.worldInteractionGraph(lastSequence), or
disable capture with scene.disableWorldInteractions().

## Causal chain

~~~text
world (.world) / WSCN / SceneSpec
               |
       Scene/kernel scheduler
               |
 weather + surfaces + vehicles + fluid/soil/wind
               |
         PhysicsWorld
               |
   collision + material decision
               |
   fracture / dents / contact work
               |
        commit + events
               |
 World Interaction IR (observer)
       |                  |
 audio/replay      Render IR / CAS
                         |
                    network consumers
~~~

The typed interaction record contains: schema, monotonically increasing
sequence, ID, tick, time, law, typed domain source/target, a discriminated
effect with physical units, and optionally a parent causeId. Real impact
and fracture records identify the committed collision that caused them,
even when audio impact cooldown suppresses an earlier sound event.

Capture is off by default. A fixed-size ring of 16..65536 retained records
bounds memory. The graph exposes firstSequence, afterSequence, nextSequence
and dropped. History that was evicted or excluded by a cursor is explicitly
marked; missing in-window causal parents fail validation.

The exact emitted EngineEvent is detached and frozen inside the observer.
The audio renderer consumes that existing event, with the same RNG/event ID;
the graph does not invent a second voice or collision. If the user drains
Scene events, the journal still preserves its own bounded snapshot.

The Render IR link is opt-in (includeInteractions: true), stored as a
content-addressed graph resource with an immutable hash. Existing render
observation schema and physical-vs-visual geometry contract are unchanged.

This works for scenes authored in TS and scenes compiled by the Rust World
compiler. It does not change the binary WSCN ABI or claim that World language
relation syntax exists yet. Future language syntax can compile into this
typed vocabulary only after static relation checking is implemented.

## Verification

Run cargo tests for the World compiler and Rust rigid kernel, build a WASM
kernel, then:

~~~sh
bun run typecheck
bun run build
node --test test/world-interaction-ir.test.mjs
~~~

CI compares capture-on/off physics and events tick-by-tick; surface work and
its post-commit state; weather; parent links; sound sample replay; content
addressed rendering; ring boundaries; Rust-compiled WSCN; and optional WASM
collision backend.

Future law extensions include typed force-driver/torque, acoustic pressure,
NPC/agent decisions and distributed commit edges. Those must be sourced from
their *existing authorities*, never invented inside the observer.

## Typed AOT connections in WSCN v3

World source can now declare typed couplings (from, to, optional min and
named after dependency). Rust validates dimension equality and a directed
acyclic dependency graph before storing a compact extension in WSCN v3.
SceneSpec.couplings is metadata, and committed sound/fracture events can be
annotated with realized coupling IDs. Fluid/acoustic/heat/NPC relations that
lack an executing physical law remain declarative, not synthetic mutations.
See [World coupling ABI](./WORLD_COUPLINGS.md).
