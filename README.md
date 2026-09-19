# Game Engine

**A scene is a URL. A browser is the runtime. TypeScript is the authoring format.**

Game Engine is a small, deterministic WebGPU simulation engine with **zero JavaScript runtime dependencies**. It is being extracted from the engine work behind [TheGame](https://github.com/Pom4H/thegame), but the boundary is intentionally generic: the engine knows about scenes, bodies, meshes, materials, cameras and time — never cars, NPCs, businesses or game rules.

The same scene can be:

- opened interactively in a browser;
- encoded into a shareable URL;
- authored as TypeScript or stored as JSON;
- stepped deterministically without realtime clocks;
- rendered to a PNG from the CLI;
- recorded frame-by-frame to video in CI;
- inspected and controlled through a tiny browser automation API.

```text
scene.ts ─┬─> browser
          ├─> URL
          ├─> physics
          ├─> screenshot.png
          └─> video.mp4
```

## Why

Traditional engines make the editor the center of the workflow. Here, **the scene is the artifact**.

There is no project database required to reproduce a frame. There is no editor-only state required to run physics. If a bug can be reduced to a scene and a time, it can be linked:

```text
https://engine.example/?src=/crash.json&t=2.416&play=0
```

Open it, rotate the camera, inspect state, continue simulation, or render the exact same point in CI.

That makes the engine useful not only for games, but also for simulation fixtures, generated datasets, interactive technical demos, product visualization and deterministic video generation.

## TypeScript: scene as code

```ts
import {defineScene} from '@rom4/game-engine';

export default defineScene({
  version: 1,
  gravity: [0, -9.81, 0],
  camera: {
    position: [7, 5, 9],
    target: [0, 1, 0],
  },
  entities: [
    {
      id: 'floor',
      position: [0, -0.05, 0],
      mesh: {kind: 'box', size: [12, 0.1, 12]},
      material: {color: [0.12, 0.14, 0.17, 1]},
    },
    {
      id: 'ball',
      position: [0, 6, 0],
      mesh: {kind: 'sphere', radius: 0.65},
      body: {mass: 1, restitution: 0.82},
      material: {color: [1, 0.35, 0.15, 1]},
    },
  ],
});
```

No scene graph framework is required. `SceneSpec` is plain serializable data, so it can move between a TypeScript module, JSON, a URL, a worker or a test without adapters full of engine objects.

## Engine computes consequences

Application code describes objects, materials and initial state. It does not script collision outcomes.

```ts
const thickness = [.01,.015,.02,.03,.04,.06,.08,.11,.15,.20];

export default defineScene({
  version: 1,
  entities: [
    ...thickness.map((t, i) => ({
      id: `window-${i + 1}`,
      position: [i * 1.8, 1.2, 0],
      mesh: {kind: 'box', size: [t, 2, 1.5]},
      material: {kind: 'glass'},
    })),
    {
      id: 'ball',
      position: [-4, 1.2, 0],
      mesh: {kind: 'sphere', radius: .11},
      material: {kind: 'steel'},
      body: {mass: 3.8, velocity: [50, 0, 0]},
    },
  ],
});
```

There is no `onCollision`, `spawnShards` or sound callback here. The engine derives the outcome from geometry, mass, velocity and physical materials:

```text
contact energy
   ↓
elastic response / material failure
   ↓
penetration or rebound
   ↓
stress-directed crack field
   ↓
clipped Voronoi cells
   ↓
polygon-prism rigid fragments
   ↓
material/contact acoustic excitation
   ↓
procedural sound
```

For brittle glass plates, crack sites propagate along perturbed radial stress paths from the impact point. Their Voronoi bisectors form the crack graph, clipped against the real panel boundary. Fragment area and mass are conserved; the same deterministic seed reproduces the same crack topology. Fast bodies automatically receive additional physics substeps, so thin geometry does not require scene-specific CCD or timestep code.

## CLI

Build once:

```bash
bun install
bun run build
```

Then the CLI is deliberately boring:

```bash
# Browser playground
game-engine serve examples/bounce.ts

# Validate without launching a browser
game-engine validate examples/bounce.ts

# Turn a complete scene into a shareable URL
game-engine url examples/bounce.ts

# Exact frame at simulation time 2.5 s
game-engine render examples/bounce.ts \
  --time 2.5 \
  --width 1920 \
  --height 1080 \
  --out frame.png

# Deterministic 8 second / 60 fps recording
game-engine record examples/bounce.ts \
  --duration 8 \
  --fps 60 \
  --width 1920 \
  --height 1080 \
  --out shot.mp4
```

`profile` runs the same production BrowserRuntime/WebGPU path after a warm-up and reports CPU/GPU render quanta, p50/p95 timings and per-frame upload/work counters. See `docs/RENDER_QUANTA.md`.

```bash
game-engine profile examples/winter-street.ts \
  --warmup 2 --duration 5 --width 1280 --height 720 \
  --out render-profile.json
```

`render` and `record` drive an installed Chrome/Chromium directly over the Chrome DevTools Protocol. There is no Puppeteer or Playwright dependency. `record` advances simulation by exact frame time and sends the PNG sequence to system `ffmpeg`, so rendering slower than realtime does **not** slow the resulting video.

For `serve`, `render` and `record`, local material texture URLs resolve inside the directory containing the input scene file. For example, both `assets/stone.jpg` and `/assets/stone.jpg` in `scenes/street.mjs` serve `scenes/assets/stone.jpg`, regardless of the shell's working directory. URL-encode spaces (`stone%20tile.jpg`); cache queries and fragments do not change the file lookup. The server exposes only files explicitly referenced by `material.texture`, `environmental.snowMaterial.texture` or a `surfaceContacts.snow[].material.texture` override. Missing files fail before the browser starts. Paths and symlinks must stay within the scene directory; `/`, `/scene.json` and `/dist/` are reserved engine routes. HTTP(S) and protocol-relative image URLs remain remote and follow normal browser CORS rules. A shareable scene URL carries texture descriptors, not image bytes, so its host must serve those assets separately.

`record` synthesizes physics events and native snow footsteps from the same fixed-timestep scene simulation. A `--from` cut preserves sound tails that began before the cut. The exported `renderSceneAudio(scene, duration, {startTime, sampleRate})` returns the stereo PCM buffer and its contact/event telemetry for offline callers; camera placement controls footstep stereo and distance attenuation.

Set `CHROME_PATH` when Chrome is not in a standard location.

## URL API

Two scene transports are supported.

### A file

```text
/?src=https://example.com/scenes/crash.json
```

The remote server must allow browser CORS. `src` is data only; the engine does not execute JavaScript fetched from arbitrary URLs.

### The whole scene in the URL

```text
/#scene=<base64url SceneSpec>
```

Generate it with:

```bash
game-engine url scene.json --base https://engine.example/
```

Runtime overrides stay outside scene data:

```text
?t=3.25
&play=0
&camera=8,4,12,0,1,0,55
```

This is useful for bug reports, visual tests and review links: scene state remains portable while camera/time can be changed independently.

## Browser automation API

The browser runtime exposes a semantic bridge:

```js
const engine = window.__GAME_ENGINE__;

engine.pause();
engine.step(1);
engine.seek(2.5);
engine.snapshot();
engine.setCamera({position: [5, 3, 8], target: [0, 1, 0]});
engine.render();
await engine.flush();
engine.inspect();
```

The CLI uses this same production runtime. There is no second test renderer and no special physics path for capture.

## What is already in the core

**Deterministic time.** A fixed-step simulation clock was extracted from TheGame and cleaned into a standalone primitive. Interactive mode retains bounded timer debt instead of silently losing time after a delayed frame; offline capture advances explicitly without a wall clock.

**Dependency-aware simulation kernel.** Modules declare stable IDs, cadence and `reads` / `writes`. The scheduler builds deterministic phase batches, validates explicit `after` dependencies and caches due-rate plans. `EngineKernel` owns scheduling while `SceneSystemRuntime` maps system commands to concrete implementations; application modules use the same resource graph without owning engine internals. Command batches commit before dependent readers receive a detached state snapshot.

**Bounded spatial broad phase.** The X/Z spatial hash keeps deterministic insertion order, bounded query caching and batched invalidation instead of letting large streamed-world queries retain unbounded object graphs.

**Serializable scene boundary.** GPU objects, callbacks and application classes never enter `SceneSpec`. Physics and rendering consume the same entities but remain replaceable behind their own APIs.

**Procedural geometry and fracture.** Boxes, spheres and planes are generated in code. Brittle plate failure produces deterministic stress-directed Voronoi crack cells that are extruded into exact polygon-prism fragments. GPU mesh buffers and per-entity uniform resources are cached by the WebGPU renderer.

**Zero runtime package dependencies.** The engine code does not pull an ECS, math library, renderer, physics library or browser automation framework into the application. TypeScript and Node types are development dependencies only.

## Architecture

```text
application rules
      │
      ▼
  SceneSpec / public API
      │
 ┌────┼───────────────┐
 ▼    ▼               ▼
core physics       procedural
 │    │               │
 └────┴──────┬────────┘
             ▼
          renderer
             │
             ▼
       BrowserRuntime
             │
    ┌────────┴─────────┐
    ▼                  ▼
interactive          CLI / CI
```

The dependency rule is strict:

> The engine may not import game concepts. A game may import the engine.

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the boundary in more detail.

## Extraction from TheGame

This repository starts with the pieces that are already naturally generic in TheGame and are valuable independently:

- fixed-step clock;
- module scheduler / kernel;
- spatial broad phase;
- scene serialization;
- procedural primitive generation;
- WebGPU runtime;
- browser automation and deterministic capture.

The initial physics backend implements deterministic rigid-body translation, adaptive high-speed substeps, sphere/AABB contact, impulses, friction, restitution, material failure, brittle plate fracture and procedural contact acoustics. It does **not** pretend to contain TheGame's full vehicle, deformable chassis or tyre model yet.

Those systems can be migrated behind the same contracts next, along with the more advanced renderer work: visibility/Hi-Z, lighting, environment, material families, streaming, physical audio and the denser vehicle physics path. Keeping that migration behind `SceneSpec` is the point — TheGame can keep evolving while the engine becomes independently reusable.

## Development

```bash
bun install
bun run typecheck
bun run test
bun run build
```

Node 22+ is the CLI target. The interactive renderer requires a browser with WebGPU support. Video capture additionally requires Chrome/Chromium and `ffmpeg` on the machine running the command.

## Status

`0.1` is the extraction foundation: the public boundary, deterministic runtime, URL/CLI workflow and a real WebGPU path are present. More of the production-grade systems from TheGame can now move here without dragging gameplay code with them.


## Surface environment

The winter street is the first stress test of a generic surface/environment state, not a separate winter-only engine path. Snow, water, ice and slush are phases managed by `SurfaceEnvironmentSystem`; the same owner is where mud, moss, dust, heat and wear evolve as additional consequences.

Weather is declarative. Application code describes the civil-time weather sequence and the semantic use of a physical surface; it does not script snow tracks, puddles or snow attached to moving bodies.

```ts
environment: {
  clock: {startHour: 2, hoursPerSecond: .30},
  weather: [
    {hour: 2,   temperatureC: -10, snowfall: 'heavy',    sunlight: 0},
    {hour: 7.4, temperatureC:   0, snowfall: 'moderate', sunlight: .18},
    {hour: 13,  temperatureC:   4, snowfall: 'none',     sunlight: .88},
  ],
},

entities: [
  {
    id: 'road',
    mesh: {kind: 'box', size: [190, .24, 8]},
    material: {kind: 'asphalt'},
    environmental: {surfaceUse: 'road'},
  },
  {
    id: 'sidewalk',
    mesh: {kind: 'box', size: [190, .18, 3.2]},
    material: {kind: 'concrete'},
    environmental: {surfaceUse: 'sidewalk'},
  },
]
```

The engine derives a grid of local physical surface states for each exposed horizontal surface (up to 64×64 cells):

```text
weather + material + geometry + traffic
              ↓
       surface temperature
              ↓
 snow ⇄ ice → slush → water
                    ↓
              drainage / puddles
```

Supported moving bodies contribute estimated sliding work to cells under their footprint. Airborne bodies contribute no work. That raises local traffic heat, melts wheel paths and produces dirty slush. Snowfall accumulates on moving bodies from geometry and motion; wake recirculation increases rear-facing accumulation, so rear bodywork and wings retain more snow without a `rearSnow` authoring parameter.

The WebGPU renderer consumes those engine states; it does not own snow/wetness/friction facts. Today it synthesizes asphalt aggregate, square paving, tyre-cleared snow tracks, wet/slushy patches, puddles, attached body snow and instanced snowfall. Curb and sidewalk snow mass also generates engine-owned snowdrift geometry. Civil time drives night, sunrise and daylight lighting, while ordinary point lights provide street illumination.

See `examples/winter-street.ts`.

Native animation and surface contacts are also declarative through
`SceneSpec.animation` and `SceneSpec.surfaceContacts`. The engine owns planted-foot
locomotion and IK, kinematic part motion, persistent snow compression, bounded
wheel spray and synchronized contact sound. Scene authoring supplies the meshes,
rig bindings, routes and surface IDs. URL loading and browser reset restore those
systems without demo-specific update callbacks.

The renderer includes a bounded many-light grid, material image loading and
triplanar sampling, geometry and screen-space reflections, contact occlusion and
HDR bloom. The complete winter-street example and its reproducible 48-second
capture pipeline are documented in [`tools/promo/README.md`](tools/promo/README.md),
including the visual and simulation limitations.
