# Game Engine Core

> Development phase: **engine first**. Gameplay is frozen until rendering, networking,
> audio and physics have explicit acceptance gates. Existing games remain only as
> regression/stress harnesses. See [docs/ENGINE_FIRST.md](docs/ENGINE_FIRST.md).

A single TypeScript package for deterministic scenes, WebGPU rendering, rigid and structural physics, procedural vehicles, synthesized audio, and character movement. It has no JavaScript runtime dependencies.

## Build and check

```sh
bun install --frozen-lockfile
bun run build
bun run check
```

The package exports simulation and scene APIs from `src/index.ts`, and `BrowserRuntime` plus `WebGPURenderer` from `src/browser.ts`. Browser rendering requires WebGPU. `BrowserRuntime.create(canvas, scene, {audio: true})` creates the renderer and fixed-step simulation; call `resume()`, `pause()`, `step()`, or `dispose()` as needed. Audio starts after `activateAudio()` from a user gesture.

A scene is validated data (`SceneSpec`). `Scene` can run without a browser for deterministic simulation. `PhysicsWorld` handles rigid contacts. Vehicle geometry comes from `compileVehicle` and the passenger, pickup, and M3 definitions. `AnimationSystem` owns walker and wheel transforms. `WalkWorld` supplies bounded static obstacle and camera queries; `BrowserRuntime.controlWalker(id, {world})` connects keyboard, pointer and touch input to an authored walker.

Source code lives in `src/`; focused tests live in `test/`. Build output in `dist/` is generated and ignored.

## Existing game harnesses — frozen

Chess, Car/Ball and Thegame-lite already exercise useful engine boundaries, including
headless logic, rigid/structural physics, WebGPU presentation and authoritative
networking. They are retained for regression testing, but they are **not an active
gameplay roadmap**.

Until the engine-first gates pass, changes under these examples should only support
rendering, networking, audio or physics verification. Do not add missions, progression,
economy, combat, NPC gameplay, boarding or other game rules as substitutes for missing
engine capability.

Historical launch instructions and scope remain in their dedicated docs for reproducing
existing tests. The development order is defined in
[docs/ENGINE_FIRST.md](docs/ENGINE_FIRST.md).

## Product integration

The integration product adds `/`, `/modules/`, `/games/chess/`,
`/games/thegame/` and an explicit `/games/car-ball/?mode=local` mode.

```sh
bun run build
node tools/docs/build.mjs
bun cli serve
```

Authoring examples: `examples/chess/project.ts`, `examples/car-ball/project.ts`,
`examples/thegame/project.ts`. `bun cli check <project.ts>` validates configuration
without starting module factories. The same AST editor utilities are shared by games
and `/docs/`. See [remaining integration](docs/product.md); its original full-Thegame
migration gap is now covered by the separately documented, user-approved lite scope.
Meshwork/YouTube output and complete legacy Thegame parity are not implemented.
