# World compiler (Rust) — v0.1

Native ahead-of-time scene compiler for the engine. The language describes
authoritative entities/physics and camera/weather inputs. It is intentionally a
small strict subset of the existing `SceneSpec`; unsupported world concepts
are rejected, not silently emulated.

## Build

```sh
cargo test --manifest-path compiler/Cargo.toml
cargo run --manifest-path compiler/Cargo.toml -- compile examples/worlds/collision.world
# writes examples/worlds/collision.wscn
cargo run --manifest-path compiler/Cargo.toml -- check examples/worlds/collision.world
```

The binary can be loaded directly:

```ts
import {decodeWorldBinary, Scene} from '@rom4/game-engine';
const compiled = await fetch('/scenes/collision.wscn').then(r => r.arrayBuffer());
const scene = new Scene(compiled); // WSCN accepted directly; equivalent to decodeWorldBinary(compiled)
```

Or through `sceneFromURL('http://localhost:4173/?src=/scenes/collision.wscn')`.
`BrowserRuntime.create(canvas, buffer)` and `runtime.replaceScene(buffer)` also work.

Compilation is outside the simulation/render loop. The browser does not ship a
Rust parser or evaluate a World program. The output is decoded/validated once,
then uses the existing native Scene/PhysicsWorld/WebGPU code paths. This does
**not** accelerate physics calculations or yet provide a zero-copy GPU upload.
Measure that separately before proposing a native physics migration.

## Syntax (v0.1)

```world
world Demo {
  gravity: (0m/s2, -9.81m/s2, 0m/s2)
  ground: 0m
  seed: 123
  camera { position: (7m, 5m, 9m); target: (0m, 1m, 0m); fov: 55deg }
  environment { temperature: -5C; snowfall: moderate }
  entity floor { mesh: box(12m, 0.2m, 12m); body: static; material: concrete }
  entity ball {
    position: (0m, 3m, 0m)
    mesh: sphere(0.5m)
    material: steel
    body: dynamic(3kg)
    velocity: (1m/s, 0m/s, 0m/s)
  }
}```

Entity fields: `position`, `rotation` (deg/rad), `scale` (unitless),
`mesh` (box/sphere/plane/cylinder), `material` (engine material catalog),
`body` (static/dynamic(kg)), `velocity`, `roughness`, `friction`,
`restitution`, `snow_depth`, `render_only`. Values have mandatory units:
length (m/cm/mm), speed (m/s or km/h), gravity (m/s2), mass (kg/g),
rotation/FOV (deg/rad), temperature (C), or unitless quantities.
Semicolons optional; comments start with `//` or `#`.
Only data is accepted: no code execution, imports, expression evaluation,
timeline control or full vehicle/soft-body compilation in this version.

## WSCN ABI v1 (little endian)

Fixed-width layouts make the decoder deterministic and extensible without
injecting a VM into the render/simulation loop. Never reinterpret a different
version as v1. File limit 32 MiB, entity limit 20,000.

Header: **160 bytes**:

| Offset | Type | Content |
| --- | --- | --- |
| 0 | bytes[4] | `WSCN` |
| 4 | u16 | ABI version (1) |
| 6 | u16 | header length (160) |
| 8 | u32 | record stride (160) |
| 12 | u32 | entity count |
| 16 | u32 | records offset (160) |
| 20 | u32 | strings offset |
| 24 | u32 | file length |
| 28 | u32 | world flags: 1 camera, 2 temperature, 4 snowfall |
| 32 | u32 | seed |
| 40 | f64[3] | gravity (m/s²) |
| 64 | f64 | ground Y (m) |
| 72 | f64[3] | camera position |
| 96 | f64[3] | camera target |
| 120 | f64 | camera FOV (degrees, matches SceneSpec) |
| 128 | f64 | temperature (°C) |
| 136 | u32 | snowfall 0..3 |
| 144 | u32 | world name offset relative to string table |
| 148 | u32 | world name UTF-8 byte length |

Record: **160 bytes**, repeated in source order:

| Offset | Type | Content |
| --- | --- | --- |
| 0 | u32 | UTF-8 id offset in string table |
| 4 | u16 | id byte length |
| 6 | u8 | mesh: 1 box, 2 sphere, 3 plane, 4 cylinder |
| 7 | u8 | material enum index, see compiler source |
| 8 | u32 | flags: 1 body, 2 dynamic, 4 render-only, 8 roughness, 16 velocity, 32 friction, 64 restitution, 128 snow depth |
| 16 | f64[3] | position (m) |
| 40 | f64[3] | rotation (rad) |
| 64 | f64[3] | scale |
| 88 | f64[3] | mesh dimensions (box xyz; sphere radius; plane xz; cylinder radius,height) |
| 112 | f64 | dynamic mass (kg) |
| 120 | f64[3] | initial velocity (m/s) |
| 144 | f32 | roughness |
| 148 | f32 | snow depth (m) |
| 152 | f32 | friction |
| 156 | f32 | restitution |

The trailing string table stores concatenated UTF-8 world/entity identifiers.
Rust and TypeScript implementations are tested together in CI. Stable entity
identifiers preserve mapping to physics/renderer state. Binary records are
hydrated into the **existing** `SceneSpec`, with authoritative physics geometry
and materials; no new per-frame interpreter or duplicate physics state is added.

Future ABI versions can add precompiled GPU buffers/physics batches while keeping
the v1 decoder strict. Never introduce those into simulation tick processing.
