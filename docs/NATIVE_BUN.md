# The Engine: Bun + SDL3 + Dawn, without a browser

Experimental native host for the **existing** `Scene`, `FixedClock` and
`WebGPURenderer`. No Electron, Chromium, WebView, browser server or second
renderer. This is a first native execution path, not complete platform parity.

## Run from the repository

Requires Bun 1.4.3, the Node.js installation already required by this repository
(for addon install scripts), and a working hardware GPU driver. Window mode
also requires an interactive desktop. Install native dependencies explicitly:

```sh
bun install --frozen-lockfile
bun run native:setup
bun run native
```

WASD moves the camera horizontally, Q/E moves vertically, Escape closes the
window. Window close is deferred until the current GPU frame finishes. A
resizable SDL3 window uses its physical pixel dimensions. The demo is an
ordinary scene: ground, a falling physical sphere, a steel box and torus.
It uses the production renderer's lights, materials, shadows and postprocessing.

An existing **procedural** JSON `SceneSpec` can be used directly:

```sh
bun run native --scene ./scene.json
bun run native:headless --frames 60 --width 960 --height 540 --output artifacts/native/scene.png --report artifacts/native/scene.json
```

After `bun run build`, direct entry is `bun tools/native/main.mjs`. A leading
`--` separator is accepted too. Headless mode does not import SDL or create a
window; it renders into a GPU texture. Its default is one frame. Positive
`--frames N` advances the shared simulation exactly one fixed tick per frame;
`--fps` is that fixed tick rate, not a claim about throughput. The interactive
mode uses the existing bounded `FixedClock` and wall time.

`--output` saves the last GPU frame and a sibling `*.first.png`. JSON reports
contain the adapter identity/backend, Bun version, renderer errors/stats,
initial/final simulation snapshots, image hashes and pixel variation. GPU
readback occurs only on requested captures, **before** presenting the swapchain
image. Row padding is removed and BGRA is converted to RGBA before PNG encoding.
PNG compression on CPU does not substitute a CPU rasterizer.

## Architecture and ownership

```
SceneSpec -> shared Scene / physics / FixedClock (JavaScript in Bun)
          -> shared WebGPURenderer / WGSL
          -> @kmamal/gpu (Node-API / Dawn)
          -> D3D12 on Windows / Metal on macOS / Vulkan on Linux
          -> SDL3 swapchain OR offscreen GPU texture
```

`@kmamal/gpu` is pinned to `1.0.0-5`, `@kmamal/sdl` to `1.0.0-3` in
`tools/native/package.json`; these are prerelease bindings. Native dependencies
are isolated from the engine/browser install. Bun trusts installation scripts
for these two explicit packages, which download native binaries. Review them
as native code dependencies. No root lockfile change is needed.

The current renderer initializes through `navigator.gpu` and reads
`devicePixelRatio`. The host owns a narrowly scoped provider for those two
globals, plus the renderer's minimal surface shape; it does **not** invent a
DOM, `window`, Canvas2D or requestAnimationFrame. Original property descriptors
are restored on close/failure. One native session per process is allowed.

The same engine render passes call the same WebGPU methods. There is no
per-object native reimplementation or pixel transport between processes.
This implementation does not batch the renderer's Node-API calls into a new
custom command protocol. Performance is deliberately not claimed: each frame
awaits `renderer.flush()` to bound outstanding work and detect failures.

Dawn is kept alive for the lifetime of GPU resources. GPU buffers/textures and
the device/surface are released before the SDL window. CLI shutdown explicitly
exits after cleanup because a native Dawn instance can retain the event loop.
Initialization errors, device loss and validation errors are fatal. Unknown
adapter identity, fallback adapters and known software renderers are rejected;
there is no automatic CPU/browser fallback. This guard uses driver-reported
metadata, not a hardware attestation mechanism.

## Standalone executable

```sh
bun run native:compile
# Windows:
./artifacts/native-app/the-engine.exe
# Linux/macOS (built on the matching system):
./artifacts/native-app/the-engine
```

The output is an **application directory**, not an honest single-file package:

```
native-app/
  the-engine.exe  # Bun runtime + bundled scene/renderer/application
  runtime/
    package.json
    node_modules/  # .node libraries, SDL and platform dependencies/licenses
  README.txt
```

Keep `runtime/` beside the executable. Addons resolve relative to
`process.execPath`, not the caller's working directory. This first build script
packages the current OS/CPU architecture only. There is no cross-OS packaging,
installer, signing or notarization yet. The target machine still needs a
compatible GPU driver and OS libraries. It does not need a separately installed
Bun/Node or browser merely to run the compiled application.

## Scope and explicit limitations

Procedural scenes use the existing production rendering and simulation code.
Painted `material.label` and URL image/normal/ORM maps are rejected explicitly:
their browser loaders use Canvas2D / ImageBitmap and have not been ported.
There is no native audio, DOM HUD/editor, mouse-look, gamepad layer or mobile
host in this patch. Keyboard controls move the camera, not a complete gameplay
character. Existing browser entrypoints and dependencies are unchanged.

The native host's JavaScript modules follow the repository's `tools/*.mjs`
convention. Shared engine/game authoring remains TypeScript. The initial native
CLI accepts SceneSpec JSON, not arbitrary remote code or HTML pages.

The native install generates its own lockfile; the hardware workflow uploads it
with proof artifacts. Direct dependencies are pinned, but a checked-in native
lockfile should be captured from a successful installation before a release.

Windows x64 is the hardware CI target. Linux/macOS have backend selection but
must not be presented as tested platforms until they have their own successful
hardware runs. Likewise, contract tests alone do not establish Bun addon
compatibility or prove that a window was rendered.

## Verification

```sh
node --test test/native-host.test.mjs  # fake device, contract tests only
bun run check                        # existing full engine suite
bun run native:smoke                  # real hardware, headless + window
bun run native:compile
bun tools/native/smoke.mjs --compiled # same real tests, standalone executable
```

The `Native Bun GPU (no browser)` workflow uses the existing
`[self-hosted, Windows, X64]` runner and an interactive desktop. It checks full
engine contracts, then **four actual renders**: source Bun/headless, source
Bun/SDL, compiled/headless, compiled/SDL. Each must render 24 frames, report a
non-software adapter and no GPU errors, produce a nonuniform PNG, and show both
pixel changes and an actual displacement of the sphere in shared physics.
Missing native libraries, incompatible Bun ABI, unavailable display or GPU are
failures, never successful skips. Proof artifacts include PNGs and JSON reports;
the application directory is uploaded only after all steps pass. Pixel
statistics are smoke checks, not visual-quality acceptance or a benchmark.

Primary dependency API references:
- https://github.com/kmamal/gpu
- https://github.com/kmamal/node-sdl
- https://bun.com/docs/runtime/node-api
- https://bun.com/docs/bundler/executables
