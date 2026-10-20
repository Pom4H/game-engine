# The Engine: Bun + SDL3 + Dawn, without a browser

Native host for the **existing** `Scene`, `FixedClock` and
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
    dawn-bun.node       # Windows: compatibility copy bound to the-engine.exe
    dawn-bun.node.json  # source/output hashes and required Node-API symbols
  README.txt
```

Keep `runtime/` beside the executable. Addons resolve relative to
`process.execPath`, not the caller's working directory. This first build script
packages the current OS/CPU architecture only. There is no cross-OS packaging,
installer, signing or notarization yet. The target machine still needs a
compatible GPU driver and OS libraries. It does not need a separately installed
Bun/Node or browser merely to run the compiled application.

Keep the Windows executable's name `the-engine.exe`. Its binding names that
executable as the provider of Node-API functions; renaming requires a rebuild.
A renamed executable fails validation before loading the binding. Moving the
whole application directory to another location is supported.

### Windows Node-API compatibility

The pinned Dawn prebuild imports Node-API symbols directly from `node.exe`.
Loading it unchanged in Bun resolves them against the wrong runtime and crashes.
`windows-napi.mjs` creates a separate compatibility copy bound to the running
Bun executable (`bun.exe` in development, `the-engine.exe` when compiled).
It adds a read-only, non-executable PE data section for the new import name;
shader code and the native implementation are unchanged. The installed original
package and its licenses remain in place.

Before creating the copy, the adapter checks the x64 PE structure, verifies all
imported Node-API symbols are exported by the actual host, and rejects signed
addons or non-Node-API imports from `node.exe`. Source runs cache the copy in
`tools/native/.runtime/`; compilation prepares it in `runtime/`. Packaged runs
validate its hash, imports, host name and host exports without writing to the
installation directory. JSON render reports identify this adapter and include
the source and compatibility-copy SHA-256 hashes. This is explicit dependency
adaptation, not a switch to Node or a different renderer.

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

The native install has its own `tools/native/bun.lock`, captured from a successful
Bun 1.4.3 installation on Windows x64. CI uses `--frozen-lockfile` and uploads it
with proof artifacts. Successful installation does not establish addon compatibility.

Windows x64 is the hardware CI target. Linux/macOS have backend selection but
must not be presented as tested platforms until they have their own successful
hardware runs. Likewise, contract tests alone do not establish Bun addon
compatibility or prove that a window was rendered.

## Verification

```sh
node --test test/native-host.test.mjs  # fake device, contract tests only
node --test test/native-process.test.mjs # host crash/timeout supervision
node --test test/native-windows-napi.test.mjs # PE relinking and executable validation
# Full check needs the ignored WASM build outputs in a clean checkout:
rustup target add wasm32-unknown-unknown
cargo build --release --target wasm32-unknown-unknown --manifest-path kernels/world-rigid/Cargo.toml
cargo build --release --target wasm32-unknown-unknown --manifest-path kernels/world-wave/Cargo.toml
cargo build --release --target wasm32-unknown-unknown --manifest-path kernels/world-structure/Cargo.toml
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

### Local Windows hardware acceptance — 2026-10-20

PR head inspected: `a294a22`. Bun `1.4.3` (`c6da4a4d3`), Windows x64,
AMD Radeon 760M, D3D12 driver `32.0.31041.1004`.

All four hardware smoke modes now pass with the compatibility adapter:

| Mode | Frames / simulation ticks | GPU errors | Result |
| --- | --- | --- | --- |
| Bun source, headless | 24 / 24 | 0 | pass |
| Bun source, SDL3 window | 24 / 24 | 0 | pass |
| Compiled executable, headless | 24 / 24 | 0 | pass |
| Compiled executable, SDL3 window | 24 / 24 | 0 | pass |

Each renders the shared WebGPU pipeline (4 draws, 1,624 triangles), produces
nonuniform PNGs whose first/final hashes differ, and moves the sphere from
Y=4 to Y=3.1825 through shared Scene physics. Final source/compiled pixels match
for the same deterministic input. The Windows adapter reports hardware D3D12,
not WARP or a browser. PNGs and per-run JSON/process reports are in
`artifacts/native/`; the compact proof is in
`docs/render-evidence/native-bun-windows-20261020.json`.

Additional corrections:

- The engine's mover AABB accumulators now use mutable tuples and bounded axes,
  fixing the strict TypeScript errors that previously stopped the native build.
- The bloom test fixture initializes its instance-batch map, matching the
  renderer's actual constructor.
- The compiled host loads the pinned packages' physical entry files from its
  adjacent runtime folder. Bare specifiers previously failed resolution inside
  the compiled executable despite the files being present.
- Smoke tests supervise the child process and save `*.process.json` even if
  a native crash prevents the application from writing its own JSON report.
  Reports retain exit status, signal, timeout and bounded stdout/stderr tails.
- Hardware CI builds the three WASM kernels before the full suite, and uses the
  checked-in native lockfile. These corrections do not resolve GitHub's earlier
  `startup_failure`, which occurred before any workflow step ran.

After rebuilding the three WASM kernels, the full engine check passes:
500 passed, 19 skipped, zero failures (519 total). The native adapter, process,
PE relinking and bloom contract subset has 26 passing tests.
The built Windows application is in `artifacts/native-app/`.
These are local hardware results; remote CI status must be checked separately.
Linux/macOS, prolonged runs, all driver families and manual keyboard/resize
acceptance are not established by these four short renders. Cold pipeline
compilation can take tens of seconds before the first frame.

Primary dependency API references:
- https://github.com/kmamal/gpu
- https://github.com/kmamal/node-sdl
- https://bun.com/docs/runtime/node-api
- https://bun.com/docs/bundler/executables
- https://learn.microsoft.com/en-us/windows/win32/debug/pe-format
