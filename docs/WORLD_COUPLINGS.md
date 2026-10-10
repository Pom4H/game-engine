# World compiler: typed causal coupling graph (WSCN v3)

The Rust World compiler accepts typed declarative connections between existing
simulation-domain signals. Every edge is an OBSERVATION dependency. This first
version cannot generate force, sound, heat, water or NPC actions by declaring
an edge: only actual domain owners commit physical state.

Example (see examples/worlds/coupled-glass.world):

    world Coupled {
      entity pane { mesh: box(1cm,1m,1m); body: static; material: glass }
      coupling hit_sound {
        from: physics.contact.energy
        to: audio.impact.energy
        min: 200J
      }
      coupling fluid_wave {
        from: fluid.pressure
        to: acoustic.pressure
        min: 1kPa
      }
      coupling hearing {
        from: acoustic.pressure
        to: npc.hearing.pressure
        after: fluid_wave
        min: 10Pa
      }
    }

Each named coupling requires from/to ports; optional after references another
coupling and optional min is a nonnegative threshold in the source dimension.

The compiler rejects unknown signals, duplicate names, mismatched dimensions,
wrong threshold units, cycles, self-links and unknown named dependencies.
Port chaining A.to=B.from and explicit after links both induce DAG edges.
Compiled entries are deterministically topologically ordered.

Signal dimensions: energy J/kJ; pressure Pa/kPa; impulse Ns; temperature C;
length m/cm/mm; speed m/s/km/h; and unitless scalar. The catalog with stable
ABI tags is mirrored in src/world-ir/couplings.ts.

## Runtime boundary

A binary compiles to existing native SceneSpec plus an immutable, prevalidated
couplings array. Compiled declarations are available as scene.spec.couplings
and are included in the optional scene.worldInteractionGraph().

Already committed physics contact-energy -> audio impact energy and contact
energy -> material fracture energy events can be annotated with couplingIds
when their actual measured event energy passes min. The existing Scene event
stream, fracture law and audio synthesizer are unchanged.

Other links (e.g. fluid pressure to acoustic pressure, acoustic pressure to NPC
hearing or temperature to a thermal field) are validated descriptors only.
They are NOT executable couplings until the real physical domain owns a law
and commits its effect. No frame interpreter or second source of world state.

## Binary ABI v3 (little endian)

The WSCN header remains exactly 160 bytes, with fixed 160-byte entity records.

Versions 1 (entities only) and 2 (performance profile) are unchanged.
Version 3 is emitted only if at least one coupling appears. Header offset 140
becomes a u32 offset relative to the string table, pointing to the coupling
extension; zero in versions 1 and 2. Offsets 152/156 retain optional performance
offset/length metadata. Version 3 may contain zero or 16 performance bytes
followed by the coupling section.

The coupling section occupies the *end* of the file:
- bytes 0..4: ASCII WREL
- u16 at 4: version 1
- u16 at 6: fixed record size 32
- u32 at 8: number of records 1..256
- u32 at 12: reserved 0
- records: exactly count * 32 bytes

Each coupling record:
- 0: u32 coupling-id UTF-8 offset from string-table start
- 4: u16 coupling-id UTF-8 length
- 6: u8 source signal tag
- 7: u8 target signal tag
- 8: u32 optional after-dependency name offset
- 12: u16 optional after-dependency name length
- 14: u16 flags; bit 0 indicates min
- 16: u64 reserved zero
- 24: f64 min in canonical source units, zero if absent

Strings precede any performance or coupling extension; decoder validates their
bounds, UTF-8, reserved bytes, tags, graph constraints and exact final size.
No arbitrary code, pointers, JSON, callback names or unchecked unit conversions
are accepted in the binary.

Strip-performance mode removes only performance data, never coupling metadata.
New WSCN versions are not silently decoded as older versions.

To verify:
    cargo test --manifest-path compiler/Cargo.toml
    cargo run --manifest-path compiler/Cargo.toml -- compile examples/worlds/coupled-glass.world
    bun run build
    node --test test/world-couplings.test.mjs
