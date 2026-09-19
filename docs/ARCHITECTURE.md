# Architecture

The engine has one hard boundary: **a serializable scene is data; the runtime is execution**.

```text
TypeScript / JSON / URL
          │
          ▼
       SceneSpec
          │
   ┌──────┼─────────┐
   ▼      ▼         ▼
 physics render   automation
   │      │         │
   └──────┴────┬────┘
               ▼
          BrowserRuntime
               │
        Chrome / interactive
```

`SceneSpec` contains no browser handles, GPU objects or callbacks. That makes a scene portable between an interactive browser, tests, CI and offline capture.

## Dependency direction

The reusable packages may not import application concepts. The engine understands entities, transforms, collision shapes, meshes, materials, cameras and simulation modules. A game may map cars, citizens, factories or quests onto those primitives, never the reverse.

```text
TheGame / another product
          ↓
       public API
          ↓
scene · physics · render · core
```

## Determinism

Simulation advances with a fixed timestep. `FixedClock` retains bounded timer debt for realtime use; CLI capture does not use wall-clock time at all. `record` advances exactly one simulation time sample per output frame, so a slow render does not create a slow-motion output video.

## Current physics boundary

The initial extraction contains translational rigid bodies with sphere/AABB contact, impulses, friction, restitution, a ground plane and broad-phase spatial hashing. Rotation is rendered but is not yet an angular rigid-body degree of freedom. This boundary is deliberate: the more detailed `SolidWorld`, vehicle dynamics and deformable chassis work in TheGame can move behind the same scene API without contaminating game rules.

## Renderer boundary

`WebGPURenderer` consumes only scene entities and camera state. Mesh generation, GPU buffers and bind groups are cached. The current renderer is intentionally small: one geometry/material path, depth testing and procedural box/sphere/plane meshes. Lighting, visibility, Hi-Z, TAA, environment and material systems can be migrated independently behind `Renderer`.

## Automation

The browser exposes `window.__GAME_ENGINE__` with semantic operations: `snapshot`, `pause`, `resume`, `step`, `seek`, `setCamera`, `render`, `flush`, `inspect`. The CLI uses that same API over Chrome DevTools Protocol; there is no Puppeteer/Playwright dependency and no QA-only renderer.
