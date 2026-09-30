# Game Engine Core

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

## Thegame — multiplayer open world

The simplified on-foot migration uses this engine's renderer, humanoid animation,
network projection, source workbench and shared authoritative/predicted character motor.
City, suburbs and natural biomes stream as bounded 128 m chunks. Players can walk,
sprint, jump, meet other players, and discover five marked places.

```sh
bun install --frozen-lockfile
npm install --prefix tools/docs --ignore-scripts
bun run docs:build
bun cli serve thegame
```

`bun run thegame` starts the same server. Open
`http://127.0.0.1:4173/games/thegame/` in two WebGPU browser windows.
One Bun process serves both the client and WebSocket authority; the static site server
alone is not multiplayer. Other devices need an HTTPS/WSS endpoint pointing to that
process. No public server is provisioned by this repository change.

WASD / arrows: move. Shift: run. Space: jump. Drag the scene: camera.
M: map. Ё: measured diagnostics. Code ↔ world: edit the shared TypeScript source.
`viewRadius` and `exposure` apply live; shared physics/seed require a server restart.

This is `thegame-lite/1`, not a compatible loader for legacy saves. Vehicles, combat,
police, economy and persistent saves remain outside the simplified version.
See [scope, networking, deployment and acceptance](docs/thegame.md).

## Car / Ball — same integration branch

```sh
bun install --frozen-lockfile
npm install --prefix tools/docs --ignore-scripts
bun run arena
```

Open `http://127.0.0.1:4173/games/car-ball/` in two WebGPU browser windows.
First two connections drive; subsequent viewers spectate. The same branch includes
the DSL editor, the Ё console, recorded renderer filmstrip and structural networking.
See [game controls, networking and limits](docs/car-ball.md) and
[structural projection API](docs/structural-network.md).

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
