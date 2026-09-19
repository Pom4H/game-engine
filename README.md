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

`render` and `record` drive an installed Chrome/Chromium directly over the Chrome DevTools Protocol. There is no Puppeteer or Playwright dependency. `record` advances simulation by exact frame time and sends the PNG sequence to system `ffmpeg`, so rendering slower than realtime does **not** slow the resulting video.

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

**Dependency-aware simulation kernel.** Modules declare stable IDs, cadence and `reads` / `writes`. The scheduler builds deterministic phase batches and caches due-rate plans. This is the reusable part of TheGame's world-kernel approach, without importing any game concepts.

**Bounded spatial broad phase.** The X/Z spatial hash keeps deterministic insertion order, bounded query caching and batched invalidation instead of letting large streamed-world queries retain unbounded object graphs.

**Serializable scene boundary.** GPU objects, callbacks and application classes never enter `SceneSpec`. Physics and rendering consume the same entities but remain replaceable behind their own APIs.

**Procedural geometry.** Boxes, spheres and planes are generated in code. GPU mesh buffers and per-entity uniform resources are cached by the WebGPU renderer.

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

The initial physics backend intentionally implements translational rigid bodies with sphere/AABB contact, impulses, friction and restitution. It does **not** pretend to contain TheGame's full vehicle, deformable chassis, tyre or material model yet.

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
