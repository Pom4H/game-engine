# Engine ontology

The engine is a causal model of one world. Folders are implementation boundaries, not domain boundaries.

## Core categories

- **Entity** — persistent identity and transform in the world.
- **Constitution** — what an entity is made of. Density, elasticity, thermal, optical and acoustic response are projections of one material constitution.
- **Surface** — the boundary where an entity exchanges energy and matter with its environment. Wetness, snow, dirt, friction and surface sound are one evolving surface state.
- **Structure** — internal degrees of freedom and constraints. Rigid, reduced and deformable bodies are representations of the same structure at different simulation fidelity.
- **Interaction** — a causal exchange between entities or entity/environment: contact, impulse, heat transfer, fracture work.
- **Environment** — shared fields that act on entities and surfaces: gravity, weather, radiation, temperature, wind.
- **Event** — a discrete fact derived from state transitions, not a second source of truth.
- **Observation** — a projection of world state for a sensor: visual rendering, audio, diagnostics. Observations never become authoritative world state.
- **Law** — a deterministic transformation that observes state channels and affects state channels.
- **Representation** — an approximation of the same fact at a chosen fidelity. Representation may change; identity and conserved quantities may not.

## Invariants

1. There is one authoritative fact for one physical property.
2. A subsystem may derive a view but may not own a duplicate fact.
3. Parent causal channels contain descendants. A reader of `entity.motion` conflicts with a writer of `entity.motion.velocity`.
4. Fidelity changes representation, not ontology.
5. Rendering and audio observe the world. They do not define material or motion.
6. Contacts are interactions. Fracture, deformation, sound and footprints are consequences of the same contact fact.
7. Material properties are constitution. Mechanical/thermal/optical/acoustic code reads projections of the same material.
8. Surface state is shared by physics, environment, rendering and audio instead of each subsystem inventing wet/snow/roughness state.

## Current canonical channels

```
world.time
environment.weather

entity.existence
entity.transform
entity.motion
entity.animation

material.constitution
material.surface

surface.state
surface.contact

interaction.contact

structure.state
structure.deformation
structure.fracture

event.stream

observation.visual
observation.acoustic
```

Channels can be refined without extending the scheduler vocabulary, for example:

```
entity.motion.velocity
surface.state.wetness
structure.state.constraint
interaction.contact.impulse
observation.visual.radiance
```

## Refactoring direction

The next refactors should remove parallel ownership, not merely move files:

- merge `BodySpec`, `RigidBody`, `StructuralBody` and vehicle interaction state around one entity/structure identity;
- make `PhysicalMaterial` the source of mechanical, thermal, optical and acoustic responses; authored `MaterialSpec` becomes an appearance/override view rather than another material model;
- make environment surface evolution, contact friction, snow deformation, rendering wetness and footstep acoustics consume the same surface state;
- turn render passes and audio synthesis into observation laws;
- express rigid / reduced / structural simulation as representations selected by fidelity policy, preserving momentum, mass, rest state and identity across transitions.

The desired dependency shape is:

```
World facts
   |
   +-- Laws (weather, contact, deformation, fracture, motion)
   |       |
   |       +--> new World facts
   |
   +-- Observers (renderer, audio, profiler)
           |
           +--> observations only
```

A folder name must never be required to understand causality. The causal graph is the architecture.
