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

Windows defaults to D3D12 and now also accepts an explicit Vulkan backend:

```sh
bun run native --backend vulkan
bun run native:headless --backend vulkan --frames 60 --output artifacts/native/vulkan.png
```

`--backend auto` retains the platform default: D3D12 on Windows, Metal on
macOS, Vulkan on Linux. Explicit choices are checked against the platform and
passed to Dawn as `backend=...`; an unavailable adapter is an error, with no
silent switch to another API or a software rasterizer. Backend selection is
part of Dawn WebGPU, so the shared renderer and WGSL stay the same.
Vulkan remains opt-in and experimental: the local game-scene test below is
slower and does not establish image parity with D3D12.

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
          -> D3D12 or Vulkan on Windows / Metal on macOS / Vulkan on Linux
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

### Actual TheGame scene and browser comparison — 2026-10-20

[Open the image comparison and frame-time chart](render-evidence/native-game-webgpu-20261020/index.html).
The directory also contains both full GPU frames, an amplified difference image,
the original game screenshot, raw per-frame reports and a separate live game run.
All images come from this project's procedural game assets and actual hardware
renders; none are generated illustrations.

This comparison uses the **current local Engine build used by TheGame**, rather
than the older renderer at this PR's base. Both runtimes load the same built JS
and replay the same captured runtime scene (2,114 entities, 1,482 shared
primitives, three decoded maps and three baked text labels). Current Engine and
TheGame working trees contain local changes. Their HEADs, dirty flags, shared
dist fingerprint, capture bundle, scene and compiled executable hashes are in
`comparison.json`; these results cannot be reconstructed from the PR HEAD alone.
The native host is from this branch. The comparison executable is a recorded
scene harness, not a native implementation of the full TheGame client.

Windows 11, Ryzen 5 7640HS / Radeon 760M, D3D12 driver 32.0.31041.1004,
Bun 1.4.3, Chrome 155.0.8059.85. Both outputs and internal targets are
1280×720, adaptive quality off, TAA on, bloom/motion blur/DOF off. Three
repetitions of 180 measured frames follow 180 warmup frames each. Cases
alternate order within each runtime; all native runs precede browser runs.

| Recorded render case | Browser WebGPU FPS | Native WebGPU FPS | Browser / native p99 interval |
| --- | ---: | ---: | ---: |
| Fixed camera | 33.8 | 23.3 | 39.1 / 49.0 ms |
| Moving camera | 19.1 | 7.5 | 156.4 / 775.0 ms |

Native is slower in this protocol. Moving-camera 1% lows are 5.5 FPS in Chrome
and 1.1 FPS natively; 74 and 166 of 540 intervals exceed 50 ms. The renderer's
CPU profile records hundreds of milliseconds rebuilding/uploading synchronous
environment maps on native camera-grid changes. These stalls remain present
after path warmup and are included in the results. This is not a 60 FPS
acceptance result or evidence that native improves gameplay smoothness.

For deterministic parity **both** replay hosts use synchronous environment-map
updates. The live browser normally uses a worker. Both replay loops wait for
GPU completion: native then presents to SDL and uses its 60 Hz timer; browser
waits for the next animation frame. Reported FPS/p95/p99 describe loop-start
cadence, not external measurements of display presentation. GPU timestamps,
CPU submission, all outliers and per-repetition statistics are retained. One
machine and unrotated host order do not establish general performance rankings.

After resetting temporal history and settling 64 frames, only 46 of 921,600
RGB pixels differ, each by at most **1/255** in one channel. RGB MAE is
0.00001664/255, PSNR 95.92 dB. The pair excludes the DOM HUD in both hosts;
maps, text labels, geometry and material parameters are preserved. The harness
uploads captured RGBA assets into the current renderer's caches; it does not
add general native image decoding or Canvas2D support to the production launcher.

Separately, the canonical **live browser game** with WebTransport/QUIC, normal
workers, a standing player and isolated persistence measured 54.1 FPS over
300 frames (180 warmup), p99 38.6 ms, zero intervals over 50 ms, at renderScale=1
and 1280×720. Its scene/population and overlapping live frame loop differ from
the recorded replay, so this is not a paired native/browser game comparison.
The server reported 49.9 Hz at the final snapshot, below its target 60 Hz.

Reproduce locally with compatible current Engine and TheGame checkouts:

```powershell
# Run these tools from the native branch. ENGINE_ROOT must match the game's
# engine-source.ts, and its current src must already be built into dist/.
$env:ENGINE_ROOT = 'C:\path\to\current\game-engine'
$env:GAME_ROOT = 'C:\path\to\thegame'
# Existing canonical game server on localhost:3007; export stages only the
# local saved performance fixture. It does not connect/teleport a live player.
bun tools/native/compare/export-game.mjs
bun tools/native/compare/build.mjs
$env:COMPARE_FRAMES = '180'
$env:COMPARE_WARMUP = '180'
$env:COMPARE_REPETITIONS = '3'
$env:COMPARE_OUTPUT = "$env:ENGINE_ROOT\artifacts\native-game-compare\native-final"
& "$env:ENGINE_ROOT\artifacts\native-game-compare\native-app\the-engine-game-compare.exe"
# Finish native measurement before starting Chrome: do not load the GPU twice.
$env:COMPARE_OUTPUT = "$env:ENGINE_ROOT\artifacts\native-game-compare\browser-final"
$env:COMPARE_HEADFUL = '1'
bun tools/native/compare/browser-run.mjs
# Optional full live browser check: starts/stops its own canonical server and
# creates an isolated save under artifacts, using the captured current bundle.
bun tools/native/compare/live-game.mjs
bun tools/native/compare/analyze.mjs
node --test test/native-compare.test.mjs
```

Outputs are under `$env:ENGINE_ROOT/artifacts/native-game-compare/`. The recorded
scene is about 13 MB gzip / 189 MB JSON and is not committed. Re-exporting uses
the current game's saved performance fixture and may produce a different scene
if either working tree changes. The old PR renderer lacks the current visual
mover/worker/profiling APIs; tools reject it and require a compatible ENGINE_ROOT.
The new statistics, pixel-diff and replay-contract tests pass (6); the full native
tool contract subset passes (30 total). HTML images, slider and chart were
checked in Chrome without JS exceptions. Full engine tests were not repeated
for these tool/documentation-only additions.

### Windows Vulkan / D3D12 diagnostic — 2026-10-20

Vulkan is available in the pinned Dawn build on the same Radeon 760M. An
initial Vulkan-only render/readback produced the expected RGBA pixel
`[64,128,191,255]`. The actual game-scene replay then passed GPU error checks
under both APIs, using the same compiled executable (SHA-256
`4ba22b5bc9faaf8dd162d08f42c5d3496bd87a528bd9b4516043915bf826f8f0`),
the same recorded scene and settings, and 180 warmup + 180 measured frames
per case. Vulkan ran first; D3D12 was rerun immediately afterward.

| Backend | Fixed camera FPS | Moving camera FPS | Moving CPU / GPU mean | Moving p99 interval |
| --- | ---: | ---: | ---: | ---: |
| D3D12 | 23.32 | 7.48 | 99.37 / 29.08 ms | 808.91 ms |
| Vulkan | 19.97 | 6.78 | 106.95 / 35.81 ms | 956.26 ms |

Switching to Vulkan did not improve this scene on this driver/build, and the
large CPU stalls remain. D3D12 stays the Windows default. This is a diagnostic
with one repetition per backend/case, not a general API performance ranking.
Both retain the same synchronous environment baking and GPU-completion waits.

Images are **not pixel-identical**: RGB MAE 1.0794/255, RMSE 5.3696/255,
PSNR 33.53 dB, maximum difference 81/255; 20.695% of pixels differ in at least
one RGB channel. There are visible local shading/depth-detail differences;
their shader/driver cause has not been isolated. This does not establish
Vulkan visual parity or justify an automatic backend switch.

[Full D3D12 / Vulkan frames](render-evidence/native-backends-windows-20261020/d3d12-vulkan.png),
[amplified difference](render-evidence/native-backends-windows-20261020/difference-x255.png),
[summary and hashes](render-evidence/native-backends-windows-20261020/summary.json).
The same directory retains each backend's raw frame-interval/GPU/renderer report.
The driver reports D3D12 `32.0.31041.1004` and Vulkan
`AMD proprietary driver: 26.8.1 (LLPC) 2.0.395`; both select the same physical
Radeon 760M, with fallback adapters rejected.

To repeat with the comparison harness, build once with `COMPARE_APP_DIR`
pointing to a fresh application directory, then run that same executable twice
with `COMPARE_BACKEND=vulkan` and `COMPARE_BACKEND=d3d12`. Set separate
`COMPARE_OUTPUT` directories ending in `native-backends/vulkan` and
`native-backends/d3d12`, with `COMPARE_FRAMES=180`, `COMPARE_WARMUP=180` and
`COMPARE_REPETITIONS=1`. Finish each process before starting the next; then run
`bun tools/native/compare/analyze-backends.mjs` with the same `ENGINE_ROOT`.
The analyzer rejects mismatched executables, inputs, protocols and GPU errors.
All 32 native tool contract tests pass after adding backend-selection coverage;
the full engine test suite was not repeated for this host/tool change.

Dawn's documented `backend=...` selector:
https://dawn.googlesource.com/dawn/+/refs/heads/main/src/dawn/node/README.md

### Native worker, bounded GPU overlap and geometry cache — 2026-10-20

The native launcher now calculates environment maps in a Bun worker thread.
The renderer accepts an optional `EnvironmentWorker` factory; browser module
workers keep their existing default. One active bake and one latest replacement
bound CPU work. Stale generations cannot publish after a scene change. The
same bake produces irradiance plus nine specular mip levels, transferred to the
render thread without copying their buffers. While a replacement is pending,
the preceding complete map remains visible. Native worker failures are reported
as failures, including in the replay benchmark.

The launcher keeps at most two submitted GPU frames instead of flushing after
each present. Capture still reads the swapchain before present; resize and
asynchronous `runtime.close()` drain outstanding work before destroying resources.
Callers must await `close()`. The compiled distribution includes the physical
`runtime/environment-worker.mjs` alongside the existing native libraries.

`--fps` retains its fixed simulation rate. `--render-fps` independently controls
the render loop: omitted means the simulation rate, `0` removes the software
cap, and `1..240` sets a cap. SDL FIFO presentation can still limit throughput.

```powershell
bun run native --render-fps 0
# Or the compiled launcher, retaining the entire runtime/ directory:
.\artifacts\native-app\the-engine.exe --render-fps 0
```

Profiling the actual recorded city exposed another CPU stall: `Object.isFrozen`
was called before looking up already verified immutable mesh bounds. On Bun,
the repeated integrity checks occupied 496.3 ms of a 499.1 ms instrumented probe
preparation (928 calls). Looking up the weak cache first removes repeated checks;
three warmed preparations then took 0.445 / 0.300 / 0.300 ms. Mutable arrays still
use the original scan and direct edits remain observable. Full-precision extrema
are multiplied before subtraction to preserve the original rounding. Scene
already restores immutable ownership after loading JSON; the earlier hypothesis
that JSON export lost that property was rejected. The final replay uses the
original snapshot unchanged.

Hardware comparison on Radeon 760M, D3D12, 1280×720, identical visual settings:

| Render replay | Fixed camera FPS | Moving camera FPS | Moving p99 interval | Moving intervals >50 ms |
| --- | ---: | ---: | ---: | ---: |
| Native before | 23.32 | 7.51 | 775.04 ms | 166 / 540 |
| Native after, software cap off | 39.99 | 40.17 | 27.61 ms | 0 / 540 |
| Chrome after, same worker/queue policy | 92.51 | 85.77 | 15.40 ms | 0 / 540 |

Native camera motion is about 5.3 times faster and its long CPU stalls are gone,
but **native is still slower than Chrome**. This patch does not establish the
goal of exceeding browser performance. Remaining native CPU submission and GPU
times are larger; their exact host/driver causes have not been isolated. Moving
native submission averages about 12–13 ms, GPU about 16 ms, compared with about
3–4 / 9–10 ms in Chrome. Vulkan remains slower in the preceding diagnostic.

Each case retains all three repetitions of 180 warmup + 180 measured intervals,
with alternating case order; no first runs or outliers were removed. Native
runs finish before Chrome starts. These are render-loop intervals, not measured
physical display presentations. SDL FIFO and visible Chrome requestAnimationFrame
have different pacing. One laptop, focus and thermals were not controlled.
A separate capped native run varied from about 40 to 59 FPS between repetitions;
it is preserved locally and is not substituted for the uncapped results above.
The changes were measured together, so their individual FPS contributions cannot
be inferred from this table. The old native 60 FPS cap exceeded its achieved FPS.

The settled native RGB frame is **exactly identical before and after**. Relative
to Chrome, 46 pixels differ by at most 1/255, RGB MAE 0.00001664/255. Geometry,
textures, labels, shadows, TAA, postprocessing and render scale are preserved.
This verifies a settled pose: during movement, background lighting may lag while
the next complete map is calculated, equally in the new native/browser paths.
The replay contains the actual game's recorded scene, not a complete native
game client with its network, input, HUD and persistence.

[Interactive report and frame comparison](render-evidence/native-pipeline-windows-20261020/index.html),
[native / Chrome frames](render-evidence/native-pipeline-windows-20261020/native-browser.png),
[raw summary and provenance](render-evidence/native-pipeline-windows-20261020/summary.json).
The evidence directory includes complete per-frame reports, original game frame,
integrity-check controls, portable-worker proof and the four GPU smoke results.
The recorded scene SHA-256 is
`bc756e10067471694444640530b245d4c06b1efdf11f8a00b4f5ea2f75fee573`.

The PR's older renderer receives the worker API and safe mesh-bounds cache
directly. The current local Engine used by TheGame contains other uncommitted
renderer work; only the small factory hook and cache ordering were edited there.
[Review patch for that current renderer](patches/current-engine-native-worker.patch)
isolates those edits and their regression tests. It is not intended to apply
on top of this PR's older renderer. The comparison harness builds both hosts
from the same `ENGINE_ROOT/dist`, whose fingerprint is recorded in the report.

Reproduce the updated comparison after building that compatible Engine:

```powershell
$env:COMPARE_MODE = 'pipelined'
$env:COMPARE_RENDER_FPS = '0'
$env:COMPARE_FRAMES = '180'
$env:COMPARE_WARMUP = '180'
$env:COMPARE_REPETITIONS = '3'
$env:COMPARE_APP_DIR = "$env:ENGINE_ROOT\artifacts\native-game-compare\native-pipeline\uncapped-app"
bun tools/native/compare/build.mjs
$env:COMPARE_OUTPUT = "$env:ENGINE_ROOT\artifacts\native-game-compare\native-pipeline\final\native-uncapped"
& "$env:COMPARE_APP_DIR\the-engine-game-compare.exe"
$env:COMPARE_OUTPUT = "$env:ENGINE_ROOT\artifacts\native-game-compare\native-pipeline\final\browser"
$env:COMPARE_HEADFUL = '1'
bun tools/native/compare/browser-run.mjs
bun tools/native/compare/analyze-pipeline.mjs
```

The analyzer additionally uses the retained baseline and integrity-check controls
under the native worktree's artifacts directory. `baseline` and `worker` modes
are available for diagnosis; the table uses `pipelined` only.

Validation: strict TypeScript and full engine suite, **528 passed, 19 skipped**;
the final native tool subset after close/pacing changes, **40 passed**. The current
Engine adapter/bake/cache subset also passed (15). Four hardware smoke modes
passed: source/compiled × window/headless, 24 fixed simulation steps each, actual
nonuniform changing readbacks, matching source/compiled pixel hashes, moving
physics, zero GPU errors and process exit 0. A relocated compiled application
also passed headless with PATH restricted to Windows directories. A compiled
worker probe completed a real nine-mip bake without installed Bun/Node on PATH.
