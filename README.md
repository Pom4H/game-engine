# Game Engine Core

> Development model: **one active branch — `main`**. Gameplay is frozen until rendering, networking, audio and physics gates are complete. See [docs/ENGINE_FIRST.md](docs/ENGINE_FIRST.md).

A single TypeScript package for deterministic scenes, WebGPU rendering, rigid and structural physics, procedural vehicles, synthesized audio, and character movement. It has no JavaScript runtime dependencies.

The user-authorized [Game → Office integration](docs/THE_GAME_OFFICE_INTEGRATION.md) consumes the existing authority and procedural world in the sibling `thegame` repository. Start its managed server with `bun run game`, or start both entries with `bun run game:office`: Game uses HTTP 3007 / WebTransport 3009, and the existing Office uses Vite 5173 / editor API 7860 with the same installed layout. The Office editor launcher reuses running processes and starts the cached backend with saved Codex tasks awaiting explicit resume in each agent menu. Voice has its existing separate launcher. Build the Game with `bun run game:build`, check adapters with `bun run game:office:check`, and check the original game with `bun run game:check`. Both entries share its existing save. `apps/thegame` retains a historical integration fixture.

[![Domain complexity map](docs/domain-complexity.svg)](docs/DOMAIN_COMPLEXITY.md)

The architecture is organized around one causal source of truth. See [the domain complexity map](docs/DOMAIN_COMPLEXITY.md), the [causal render contract](docs/CAUSAL_RENDER_CONTRACT.md), and [server authority](docs/SERVER_AUTHORITY.md).

## Build and check

```sh
bun install --frozen-lockfile
bun run build
bun run check
```

The package exports simulation and scene APIs from `src/index.ts`, and `BrowserRuntime` plus `WebGPURenderer` from `src/browser.ts`. Browser rendering requires WebGPU. `BrowserRuntime.create(canvas, scene, {audio: true})` creates the renderer and fixed-step simulation; call `resume()`, `pause()`, `step()`, or `dispose()` as needed. Audio starts after `activateAudio()` from a user gesture.

A scene is validated data (`SceneSpec`). `Scene` can run without a browser for deterministic simulation. `PhysicsWorld` handles rigid contacts. `SolidWorld`/`SolidBody` provide the full quaternion compound-box and finite-plane solver used by the production Game, including joints, angular inertia, friction, contact impulses, sleeping supports and swept interaction islands. Application roles and vehicle activity enter through typed `SolidPolicies`; force callbacks run before each island substep. Both solvers are Engine-owned capabilities. Vehicle geometry comes from `compileVehicle` and the passenger, pickup, and M3 definitions. `AnimationSystem` owns walker and wheel transforms. `WalkWorld` supplies bounded static obstacle and camera queries; `BrowserRuntime.controlWalker(id, {world})` connects keyboard, pointer and touch input to an authored walker.

`WebGPURenderer.configurePostProcessing({temporalAA, bloom, motionBlur})` switches compiled camera effects without replacing the Scene or device. Compile `features: {motionBlur: true}` to retain motion vectors independently of TAA; the shutter pass removes raster jitter and rejects incompatible depth. `scene.camera.focusDistance` and `aperture` control depth of field. Game exposes all four controls in its existing graphics panel.


Source code lives in `src/`; focused tests live in `test/`. Build output in `dist/` is generated and ignored.

After building, `node tools/render-stability/verify.mjs` checks the production
shadow/reflection pipeline on a native WebGPU adapter, complete probe publication,
finite HDR targets, and TAA coordinate/history recovery. It saves a report and PNG
under `artifacts/render-stability/`; this small correctness fixture does not measure
live game FPS. See [the verification instructions](tools/render-stability/README.md).

## GPU visibility experiment

`BrowserRuntime.create(canvas, scene, {visibility: 'gpu'})` enables opaque instance
batches with GPU frustum culling, compaction and `drawIndexedIndirect`. The
40-float instance buffers stay resident and upload only changed ranges.
`visibility: 'cpu-batched'` uses the same buffers and shaders with CPU visibility;
`visibility: 'cpu'` preserves the current renderer and remains the default.

The first experiment batches objects sharing geometry and material controls.
Per-instance transforms, previous transforms, colors and procedural seeds are
preserved. Transparent objects, image materials, labels, per-object surface
fields and body weather retain their existing path. Shadow, probe and reflection
visibility are still independent CPU tests. Hi-Z and LOD are deferred.

After `npm run build`, run `node tools/gpu-visibility/benchmark.mjs` on a native
Windows GPU. It compares 5,000 and 10,000 cubes at 1920x1080 with static and moving
cameras, fixed scene/replay hashes, full-frame pixel comparisons and linear HDR
samples. The report records CPU p95, GPU timestamps, frame intervals and queue
upload bytes in `artifacts/gpu-visibility/report.json`. Override `CHROME_PATH`
when the browser is not in a standard location. `VISIBILITY_REQUIRE_60FPS=1`
makes an exceeded 60 FPS p95 budget fail the command; correctness and frame
budget results are always reported separately.

GPU geometry counts in synchronous telemetry are explicitly marked
`candidate-upper-bound`. Exact indirect counts are optional asynchronous
diagnostics tagged with their source frame; render never waits for them.
The manual **GPU visibility crossover** workflow retains evidence on the Windows
host and writes a numerical Actions summary. Requested artifact uploads and the
60 FPS quality gate remain failure-producing steps. GitHub artifact storage
quota is a separate account condition and is not cleared by this workflow.

The [October 11 local Windows GPU measurements](docs/render-evidence/gpu-visibility-crossover.json)
passed pixel/replay/count checks but exceeded the 60 FPS budget. On the fixed
1080p scene with a moving camera, 5,000 cubes measured 43.55 / 46.18 / 48.15 FPS
for CPU / CPU-batched / GPU. At 10,000 cubes the values were 23.03 / 24.86 / 25.22.
For a static 10,000-cube camera, GPU was slower than the current CPU renderer
(28.81 versus 31.60 FPS). These headless Chrome measurements used a native AMD
RDNA 3 adapter, 32 warmup frames and 120 measured frames; they do not establish
a universal GPU crossover threshold or a successful CI run.

The renderer now reuses its live RenderFrame projection, static model matrices,
light membership and opaque batch plans. It checks numeric radiance causes in
persistent storage and hashes them only after a change. Geometry replacement,
entity generations, material patches, surface eligibility and visual poses still
invalidate the relevant data. Pure `buildRenderFrame` snapshots keep their
existing independent behavior; custom projection builders run each frame.
`inspect().preparation` and `inspect().environmentCache.causes` expose the bounded
working sets and rebuild counts. CPU projection has its own `projection` quantum.

The [render preparation follow-up](docs/render-evidence/render-preparation-cache.json)
matched every previous PNG byte, HDR sample and replay hash in all 12 cases.
For the GPU path with a moving camera, CPU p95 fell from 23.1 to 15.5 ms at 5,000
cubes and from 48.4 to 23.3 ms at 10,000. Mean FPS measured 72.20 and 46.84;
frame interval p95 remained 20.1 and 29.8 ms, so the 60 FPS gate still failed.
At 10,000 cubes, mean environment-key work fell from 10.5 to 1.8 ms and preparation
from 14.0 to 4.3 ms. These are sequential local measurements with unchanged
render passes, not an interleaved hardware throughput proof.

Keep a baseline `report.json` and its PNGs in a separate directory before an
experiment. After the next run, `node tools/gpu-visibility/compare-preparation.mjs
<baseline-directory> <current-directory> <evidence.json>` checks exact reference
images, HDR samples, adapter, frame controls and replay before saving a compact
performance comparison. The comparison does not declare an exceeded p95 budget
successful.


## Three-way WebGPU benchmark

The [native renderer comparison](tools/engine-compare/README.md) imports one
deterministic Render IR snapshot into Engine, Three.js and Babylon.js. It shares
geometry, Float32 transforms, material inputs, lights, HDR radiance and the camera
route, checks replay/source hashes and audits actual instance matrices. All three
use WebGPU on the same native adapter; the engine entry enables GPU visibility.

After `npm run build`, install the pinned benchmark-only libraries and run:

```sh
npm install --prefix artifacts/engine-compare/vendor --no-save --no-package-lock --ignore-scripts three@0.186.1 @babylonjs/core@9.30.0
node tools/engine-compare/benchmark.mjs
node tools/engine-compare/summarize.mjs
```

Defaults are 1920x1080, 5,000/10,000 cubes, static/moving cameras, three rotated-order
repetitions, 48 warmup and 240 measured frames. One asynchronous timestamp/transfer
instrument records CPU/GPU/frame p95, queue bytes and all-pass draw counts, including
cached render bundles. `artifacts/engine-compare/report.html` shows the metrics and
canonical images; [compact local evidence](docs/render-evidence/engine-compare.json)
retains source/build fingerprints, correctness audits, pipeline features and results.

Scene inputs match, while native PBR, shadow filtering and postprocessing differ.
The engine includes procedural surfaces, TAA, AO, SSR, planar reflection and bloom;
the peers use PBR, shadows, environment prefiltering and ACES without extra AA/effects.
These measurements do not establish a speed advantage at equal pixel quality.
FPS is derived from headless RAF intervals and can hit a scheduling ceiling.
`node tools/engine-compare/summarize.mjs --check-budget` fails when any recorded
CPU/GPU/frame p95 exceeds 16.67 ms; a completed local benchmark is not a CI pass.

The opt-in GPU/batched renderer also instances planar reflections with an
independent reflected-camera visibility list and the same persistent source
stream. [Reflection optimization evidence](docs/render-evidence/planar-reflection-instancing.json)
records native 1080p before/after measurements and three wet-surface camera views
whose complete final pixels and HDR reflection targets match exactly. The local
gallery is `artifacts/engine-compare/reflection-comparison/report.html`;
the [benchmark instructions](tools/engine-compare/README.md) include rerun commands.
At 10,000 cubes with camera motion, CPU p95 fell from 27.5 to 14.4 ms and mean
RAF FPS rose from 45.1 to 77.3. Frame p95 is still 20.1 ms, above the 60 FPS budget.

The renderer now compiles separate camera, reflection and light visibility plans.
Each plan retains its current static candidates; model, geometry, material
classification and mover changes invalidate the relevant projection. Moving the
camera keeps the static light projection resident. GPU-owned instances remain
outside CPU camera/reflection candidates. `inspect().preparation.visibilityPlan`
exposes bounded candidate counts, rebuilds and clip tests; scene swaps, removal
and disposal release old entries. The plan reads the existing Render Frame models
and does not own simulation state.

[Independent visibility-plan evidence](docs/render-evidence/independent-visibility-plans.json)
records native Windows/AMD RDNA 3 measurements at 1080p. Moving-camera CPU p95
fell from 8.5 to 4.7–4.9 ms at 5,000 cubes and from 14.7 to 8.7–10.2 ms at 10,000
across two unchanged after-runs. The light plan tested 10,001 static candidates
once per scene, then zero per frame. Draw counts and upload payloads stayed the
same. All wet-view final pixels and HDR reflections matched exactly and were
visually inspected. **Strict canonical pixel and 10,000-cube frame gates still
fail**: the unchanged after-runs varied at 13 RGB8 channels total by one level,
and frame p95 remains 19.8–19.9 ms. Both runs and failed gates are retained in
`artifacts/engine-compare/view-planning-comparison/report.html`; no pixel tolerance
or frame budget was relaxed.

The presentation pipeline also compiles its dependencies once at renderer
creation. `WebGPURenderer.create(canvas, {features})` accepts `screenSpace`
(AO, diffuse bounce, SSR and DOF), `bloom`, `temporalAA` and `planarReflections`.
All default to `true`. Disabled consumers omit their passes and attachments;
bloom alone uses a small composition shader, and TAA samples either composed
effects or HDR. Normal/specular attachments exist only with screen-space work,
and velocity exists only with TAA. Disabling planar reflections retains a 1x1
texture for the fixed material binding layout. Final tone mapping remains enabled.
`inspect().pipeline` exposes the immutable plan and `inspect().renderTargets`
reports actual texture dimensions/formats. Resize and disposal release each
owned target once. These choices affect presentation, not World IR or replay.

The three-way benchmark's `COMPARE_PROFILE='native'` preserves each renderer's
full native pipeline. `COMPARE_PROFILE='common-post'` disables the engine's four
feature groups to match the peers' absence of extra screen effects. Native BRDF,
shadow filtering, atmosphere, IBL and tone mapping still differ; this profile
does not establish equal pixel quality. Its separate wet-surface captures always
exercise the full default engine. The [pipeline comparison evidence](docs/render-evidence/render-pipeline-targets.json)
keeps default regression gates, a separate same-profile raster-attachment pixel
gate, real GPU work, timings and failed budgets. No tolerance is added to the
observed baseline repeat range.

In the 2026-10-12 local run, omitting the unused normal/specular/velocity targets
saved 33,177,600 bytes at 1080p and preserved all channels of twelve reduced-profile
canonical captures exactly. Full wet-view presentation and linear reflection
buffers also matched the original baseline in both new reports. The full default
canonical gate still fails at nine channels outside the observed baseline range.
Native 10,000-cube frame p95 is 20.0 ms. The reduced-profile execution encountered
a document-readiness race; its failed report is retained separately from the
recovered execution. Windows counters then showed `llama-server` Compute work on
the same GPU as the browser. The recovered speed comparison is affected by
external contention and establishes no acceleration or competitive advantage.

[Canonical stage repeatability](docs/render-evidence/canonical-stage-repeatability.json)
compares six fresh-device captures per GPU/ordered CPU-batched visibility mode.
Final HDR, normal and effects targets match within each mode. GPU captures vary
at 6–34 raw float16 TAA channels; ordered CPU captures match at every sampled
stage. These differences do not change the diagnostic's final RGBA8 image.
That final-only diagnostic did not capture earlier history inputs or velocity;
it did not establish a TAA shader defect. The subsequent frame trace below
locates an earlier divergence.
Full target channels are compared without tolerance; readbacks and queue waits
make this a correctness diagnostic rather than a performance benchmark.

The current model source is now the existing Render IR index; the renderer no
longer builds a second per-frame model map. Previous poses use persistent
`RenderModelHistory` records with observation generations and source identity.
A pose is valid only from the immediately preceding render. Offscreen single
reentry starts with its current pose, collection releases removed/replaced
sources, and scene swaps/reset clear observations. This remains render history,
not a second physical state. `inspect().preparation.modelHistory` exposes its
record count, allocations, commits and changed model references.

[Model-history evidence](docs/render-evidence/render-model-history.json) retains
two actual three-way native runs, each with 36 cases and three wet views. For
5,009 frozen sources, the after run allocated 5,009 history records across 288
frames. At 10,000 cubes with camera motion, CPU/GPU/frame p95 changed from
9.2/10.49/20.0 ms to 8.7/10.12/19.9 ms. The 5,000-cube moving-camera CPU p95
increased from 6.1 to 8.1 ms; sequential local timings do not establish a
consistent acceleration or exclusive GPU use. All wet final/HDR channels
matched exactly. One canonical capture differs at eight channels, up to 6/255,
outside its six observed baseline captures; **pixel and frame gates remain
failed**. Images from all three renderers and the wet fixture were inspected.
The local gallery is `artifacts/engine-compare/model-history-comparison/report.html`.

[Native moving-history checks](docs/render-evidence/render-model-history-motion.json)
compare 12,822,080 current/previous matrix values from actual GPU instance and
rigid-body uniform bindings against pure Render IR and independent observations.
They also compare 15,999,040 instance-upload values with the persistent CPU
mirror. Both visibility modes exercise published/direct poses, eight moving
bodies, offscreen reentry, replacement, removal, reset and same-ID scene swaps.
Physical hashes stay unchanged across render and agree between modes. The full
local check passes 277 tests. These checks establish the exercised history
semantics, not pixel repeatability or competitive quality.

[Per-frame temporal inputs](docs/render-evidence/temporal-input-repeatability.json)
match through all 32 frames in three fresh-device repeats per mode at 5,000
cubes before the history change. The [10,000-cube trace](docs/render-evidence/temporal-input-repeatability-10000.json)
after the change reproduces GPU variation first in HDR/current color at frames
22 and 31, while depth and velocity match. Later TAA output retains that earlier
color difference. All three ordered CPU-batched repeats match every captured
stage. This shifts the investigation upstream of TAA to instanced shading and
GPU visibility ordering; the exact shader/driver cause remains unresolved.

The [controlled instance-order observations](docs/render-evidence/instance-order-opaque-input.json)
localize another variation to the opaque pass on frame 26: three pixels differ
in color while normal/specular/depth/velocity match. Identical fixed-order
repeats can also vary, so instance order alone is not an established cause.
The diagnostic-only flat color/seed candidate failed to eliminate the variation
and was not promoted. Reading shadow/light inputs produced one stable four-run
sample; it does not cancel the failed observations.

Canonical diagnostics now summarize every captured frame and support
`--check-repeatability`, retaining evidence and returning nonzero on failure.
An unchanged last frame cannot hide an earlier color divergence. The Windows
workflow adds the 10,000-object temporal check, retains nested evidence locally
when upload is disabled, and evaluates frame budget independently. Local checks
pass 281 tests; the amended workflow has not been executed on GitHub Actions.
The [new normal-path native gate](docs/render-evidence/opaque-temporal-gate.json)
passes two fresh-device runs per visibility mode across all 32 frames and six
stages. This stable sample does not resolve the divergent opaque control or
establish a performance improvement; production renderer/shaders are unchanged
by these diagnostic and CI changes.

The [sun-shadow experiment](docs/render-evidence/sun-shadow-demand.json) did not
produce a full-frame improvement and was not promoted. The production renderer
was restored to the measured baseline. All three wet RGBA8/HDR reflection views
match, but 18 canonical channels fall outside the observed baseline range and
frame p95 remains 20 ms at 10,000 moving cubes. A [same-device paired diagnostic](docs/render-evidence/sun-shadow-paired.json)
observes small opaque savings, about 0.11–0.15 ms, with profiling/occlusion
overhead; these do not override failed full pixel/frame gates. CPU quanta reveal
about 1.4–1.6 ms per frame in environment cause checking even for the frozen
scene, guiding the next Render IR dataflow work.

A subsequent [CPU dataflow candidate](docs/render-evidence/render-radiance-projection.json)
observes distant radiance causes in the existing live Render IR pass. Reused
immutable matrices certify unchanged full-precision pose inputs; direct numeric
material changes remain observable. Standalone, custom and dormant projections
still scan Scene, and failed projections force a new cause commit. The key is
consumed once in the synchronous render transaction. Physics and shader code
are unchanged; 287 tests cover direct edits, sub-Float32 motion, membership,
source generations, shared caches and interrupted builds.

[Same-device CPU pairs](docs/render-evidence/render-radiance-paired.json)
at 10,000 cubes save 0.57–0.65 ms on average for projection plus environment,
with combined p95 decreasing from 2.5 to 1.8–1.9 ms. This isolates the traversal
with the current numeric detector and profiler overhead, rather than comparing
the entire historical implementation or measuring display FPS. The full native
three-way candidate still has approximately 20 ms frame-interval p95 and failed
strict canonical/wet pixel gates. All HDR reflection views match, but 30 canonical
channels and 61 channels in one wet presentation capture differ; no release or
equal-quality competitive advantage is established. The code remains a working
candidate, with the failed evidence retained.

[All-frame temporal checks](docs/render-evidence/render-radiance-temporal.json)
pass for two fresh runs per GPU/CPU culling mode, observing all 32 frames and
six stages. [Fresh wet controls](docs/render-evidence/render-radiance-wet-controls.json)
also reproduce presentation variation in the original code; three new candidate
captures match the initial baseline in all wet views. These finite passes neither
erase the original failed gate nor identify its underlying cause.
The [final native integration](docs/render-evidence/render-radiance-final-integration.json)
records the final source after a narrow shared-key lifecycle repair for fallback
readers; its source/dist archive and 16 pairs per route are distinct from the full
benchmark and earlier 128-pair performance measurements.

The [shadow coverage correction](docs/render-evidence/shadow-filter-plane-numeric.json)
uses one WGSL contract for ordinary, relief and instanced materials. Four static
PCF samples and two dynamic samples are averaged independently before combining
the maps. Previously the static sum was divided by two, suppressing partial
shadows. Offset comparisons now use depth on the geometric receiver plane;
derivatives are computed before bounds returns and singular projections retain
a finite fallback. Existing sample locations, map sizes and biases are retained.

On native Windows AMD WebGPU, 4,177 independent coverage cases match exactly and
225 affine receiver-plane cases pass their declared 1e-6 float32 tolerance. The
diagnostic also verifies use of the shared counts and both depth corrections in
all three actual production shader modules. Full checks pass 287 tests.
[Visual inspection](docs/render-evidence/shadow-filter-plane-quality.json) found
that normalization alone exposed stripes in the wet-road sunlight highlight;
the plane correction removes the apparent stripes in the inspected captures.
All three HDR reflection views remain byte exact, and fresh corrected wet
captures reproduce the complete benchmark's presentation pixels exactly.

The [complete three-way repetition](docs/render-evidence/shadow-filter-plane-comparison.json)
retains the exact archived harness and all scene/geometry/replay inputs. Engine
frame-interval p95 at 10,000 objects remains 19.9–20.0 ms, versus about 10.1 ms
for the peers' different native pipelines. Its GPU p95 is 10.12–10.36 ms.
This is a shadow correctness improvement, with no established speed or
equal-quality advantage. The original exact pixel and frame gates remain failed;
corrected shadow pixels intentionally differ from the old incorrect baseline.
The [new 32-frame trace](docs/render-evidence/shadow-filter-plane-temporal.json)
also fails repeatability: a fresh GPU run changes 12 opaque RGB channels at frame
16, and TAA carries that difference through frame 26. Depth and velocity remain
exact, and both observed CPU-batched runs agree. This localizes the observed
difference to opaque shading in this sample; its underlying cause is unresolved.

The next [live material demand candidate](docs/render-evidence/moss-demand-comparison.json)
skips nine volume-noise samples used only by concrete moss when its live amount
is zero. Base concrete and all nonzero moss expressions remain the same. On the
same native GPU, 128 AB/BA pairs per camera route save 0.324–0.341 ms of mean
opaque time; 117 of 128 pairs improve on each route. Publishing zero/growth/zero
authored material states changes then restores the actual opaque image without
pipeline reconstruction. Opaque/HDR comparisons are exact in all three states;
the paired TAA differences remain failures.

Actual production module-pair hashes match that measured prototype. 287 checks
pass, and the complete 36-case native three-way repetition preserves every wet
RGBA8/finite HDR channel. Canonical captures stay within the existing observed
baseline range with zero additional tolerance. At 10k, static/moving GPU p95
changes 10.356/10.120 → 10.125/10.002 ms and frame p95 remains 19.9/19.8 ms.
Mean static headless FPS declines 84.33 → 82.63 while moving changes 86.50 →
87.64; these sequential runs do not establish a consistent full-frame speed
advantage. The frame budget and paired TAA gates remain failed.
[Direct visual review](docs/render-evidence/moss-demand-quality.json) checks the
full wet views and positive-moss capture. The [fresh all-frame sample](docs/render-evidence/moss-demand-temporal.json)
matches all six stages across 32 frames for two GPU and CPU-batched repetitions;
this finite pass does not erase the paired TAA failures or prove that earlier
intermittent variation has been eliminated.

## Infinite world streaming

The engine has a transport- and game-independent infinite-world boundary.
VisibilityInterest turns one camera/observer into a bounded, non-overlapping
quadtree of tile demands. Close terrain uses 128 m base tiles; distant terrain
automatically becomes coarser. Altitude increases the apparent horizon, so an
aircraft can see tens or hundreds of kilometres without asking the generator for
millions of near-detail chunks.

InfiniteWorld owns bounded asynchronous generation, residency, cancellation,
installation and eviction. The application owns tile meaning.

Render visibility is deliberately independent from physics and gameplay simulation
interest. Seeing a mountain 100 km away does not activate its collision bodies,
NPCs, economy or other detailed simulation.

See docs/INFINITE_WORLD.md.

## Authority execution

The common `FixedClock` and `SpatialHash` also drive the original Game host. Its spatial adapter retains stable cell order and its legacy default footprint policy; large caller-owned query results use iterative filling rather than JavaScript argument expansion.

`plateMechanics`, contact excitation/pulses and `ContactImpulseEnvelope` expose the reduced elastic/contact model used by Game. `createStructuralState` / `stepStructuralGraph` provide its unchanged normalized graph-deformation model, including plasticity, fracture, skin bindings and sleep. This API is distinct from `StructuralBody`'s SI/XPBD model; switching between those models does not promise identical vehicle response. Authored vehicle graphs and calibration remain application data.

`CausalWorldRuntime` supplies a logical due-event calendar with bounded drains and resource invalidation. Applications choose its time unit and handle the returned events. `BlueprintRegistry` compiles immutable JSON definitions once per published revision and retains canonical definition digests/references; `definitionDigest` is a cache identity, not a security hash. Storage schemas, account ownership and production rules stay in their host/application adapters.

`SimulationInterestPlanner(config)` chooses simulation tiers from the union of X/Z observers, conservative subject radii, critical activity and downgrade hysteresis. The host supplies its radii, delay and subject/observer budgets. Removed subjects leave no retained history. `LocationWorkScheduler(periods, capacity)` selects oldest due location work under both job-count and cost budgets, returning deferred work explicitly; tier periods remain application policy.

`LocationWorkerPool` accepts a worker URL/factory and an application codec (`validate`, `pack`, `unpack`, `transferables`). `pack` must own a snapshot at submission, including queued jobs. The pool bounds concurrency and queue length, cancels running or queued locations, enforces timeouts and verifies location/owner/epoch/tick/revision on responses. It returns proposals without applying game effects or retrying failures. The host must revalidate current ownership and canonical state before committing a proposal at its authority boundary. Browser/Bun workers and an explicit Node worker adapter are tested independently.

`EngineKernel` compiles module phases, dependencies, resource hazards and cadence into direct-call programs. Its third constructor argument accepts `{resourceOrder: 'id'}` for a synchronous state owner with established stable ID ordering; the default `'explicit'` still rejects unordered resource hazards. Explicit dependencies take precedence in both modes. Portable module contexts retain their immutable snapshot contract. The production Game adapter owns its live authority context through the existing `context: 'none'` mode and delegates stage planning and execution to this kernel.

Cadence cycles up to 4096 ticks are precomputed. Longer cycles use a bounded cache of 256 due patterns: `CompiledSchedule.cycleTicks` and `KernelProgram.cycleTicks` are zero in that mode. Call `schedule.plan(tick)` or `program.run(tick, context)` for either mode; non-negative safe integer ticks retain their full precision. Their `diagnostics` expose precomputed plan and cached pattern counts.

## Rust World compiler (ahead of time)

The experimental `worldc` compiler converts `.world` declarative scenes into a
fixed-layout `.wscn` binary with SI units and stable entity IDs. It compiles
**before** execution; scene loading hydrates the existing `SceneSpec` and
preserves the engine's physics/render hot path. The v0.2 authoring prototype adds typed constant folding, dimension-checked
expressions, and compile-time indexed entity expansion on top of the v1 binary
ABI. It remains an intentional subset of TypeScript scene authoring.

```sh
cargo test --manifest-path compiler/Cargo.toml
cargo run --manifest-path compiler/Cargo.toml -- compile examples/worlds/collision.world
```

Read [compiler/README.md](compiler/README.md) for the language, binary ABI,
and `sceneFromURL` integration. Opt-in `performance {tick_budget:5ms;
sample_every:5; history:120}` profiles CPU system costs and budget exceedances.
Run `bun run world:profile` to produce a causal CPU performance JSON report.
The precompiled direct scheduler is the built-in fast path. Custom modules use
the original KernelProgram, and `scene.setSystemDispatch('kernel')` can force it
for parity and runtime comparisons. `decodeWorldBinary()` is exported by both the
core and browser packages.

## Rust/WASM real-time acoustic kernel

The production staggered FDTD acoustic wave solver has an optional Rust/WASM backend.
Its physical state resides directly in persistent WASM f64 buffers: no per-tick state
marshalling, one numerical call per step, original CFL/geometry semantics, and
pressure-slice staging for WebGPU r32float uploads. TypeScript remains the default
until the measured workload warrants enabling WASM. See
[kernels/world-wave/README.md](kernels/world-wave/README.md) for build, use,
parity gates and benchmark evidence.

## Rust/WASM structural XPBD (opt in)

Validated `StructuralBody` can specialize its active XPBD numerical loop with a
Rust WebAssembly kernel, preserving node arrays, strain/plasticity/fracture and
rigid bake. Existing JS path is still the default; user-defined contact
projectors fall back to the JS solver on the same Wasm memory. End-to-end tests
and whole-physics-tick measurements are in
[kernels/world-structure/README.md](kernels/world-structure/README.md).

## Optional Rust/WASM rigid collision kernel

`PhysicsWorld.setRigidContactKernel(await createWasmRigidContactKernel(wasm))`
accelerates (when measured faster) rigid sphere/box narrowphase and sequential
point impulse resolution for moving bodies, including rotated OBB car chassis.
Broadphase, contact order, force drivers, material decision callbacks, static
floor manifolds and causal traces remain engine-owned. It is **opt in** because
per-pair JS↔WASM scratch transfers can be slower than pure JS on sparse scenes.
See [kernels/world-rigid/README.md](kernels/world-rigid/README.md) and its
numerical parity and full-world tick benchmarks in GitHub Actions.

## Emergent execution contract

Acceleration is not a replacement for the engine's causal world model.
The opt-in Rust rigid backend now supports ordered per-body contact batches,
with strict fallback for fracture/deformation callbacks, causal traces,
static road manifolds and oversized candidate sets. See
[docs/EMERGENT_EXECUTION.md](docs/EMERGENT_EXECUTION.md) for the complete
weather → surface → forces/contacts → fracture/deformation →
commit/events → audio/render/network contract and its CI parity gates.

A certified inert-contact subset of the built-in Scene material law can also
use the Rust batch without disabling material/fracture/audio systems; the
contract must be updated whenever contact material logic changes.

## World Interaction IR (causal cross-domain contract)

Opt-in `Scene.enableWorldInteractions()` captures immutable, bounded interactions
from the authoritative weather, rigid contact, material/fragmentation event and
surface-work commits. Interaction parents link actual contacts to emitted audio
and fracture events. No interaction can drive a second physical world or mutate
the render/audio/network projections. `projectSceneRenderFrame(...,
{includeInteractions:true})` optionally includes one content-addressed `graph`
resource; `eventsFromWorldInteractions` reuses exactly the committed audio events.
See [docs/WORLD_INTERACTION_IR.md](docs/WORLD_INTERACTION_IR.md).

## Rust World v3: type-checked causal connections

World source files can declare a bounded dimension-checked coupling DAG
connecting physics, sound, material, thermal, water, acoustic and NPC signal
ports. The WSCN v3 extension is pure static metadata with no per-tick DSL
interpreter. Only actual committed impact/fracture effects are linked at
runtime; unimplemented links stay declarative. See
[docs/WORLD_COUPLINGS.md](docs/WORLD_COUPLINGS.md).

## Agent Office: toy-brick observability

`bun run office:demo` opens a WebGPU toy-brick office with deterministic causal replay; `bun run office:live` accepts real observed facts through the loopback API. Codex app-server notifications can be normalized with `CodexActivityAdapter` without exposing prompts or reasoning. See [docs/AGENT_OFFICE.md](docs/AGENT_OFFICE.md).

## Self-hosted GPU render without GitHub Actions

On our Windows/Linux GPU worker, run `node tools/agent-office/render-on-worker.mjs` in an up-to-date checkout. The command renders and verifies the real Agent Campus 1080p/24fps H.264 file using hardware WebGPU; `--publish` optionally uploads it to a private prerelease. See [Agent Campus](docs/AGENT_CAMPUS.md).


## Russian literature pipeline

Plain UTF-8 Russian prose to a guarded SceneSpec and WebGPU capture. Example: `node tools/literature/author.mjs examples/literature/pereprava.txt --provider offline --world examples/literature/pereprava.world`; then use `node tools/render-harness.mjs tools/literature/generated.scene.mjs tools/literature/generated.views.mjs 1280 720` on the GPU runner. Offline is deterministic non-LLM smoke test. For an actual model set `LITERATURE_MODEL_URL`, `LITERATURE_MODEL` and optionally `LITERATURE_API_KEY`, use `--provider model`. See docs/LITERATURE_WORLD.md.
## Snowy rush hour

```sh
npm run demo
```

Open `http://127.0.0.1:4173` in a WebGPU-capable browser and click **Почувствовать город** to start motion and sound. The snowy street has 48 cars on continuous opposing routes, taxis and vans, warm shop windows, lamps, headlight reflections, tyre spray and deterministic spatial horn events. Change density to 24 or 64 cars, press V for three camera views, H for a nearby horn, or choose **Прогуляться** to control the preserved winter walker. WASD/arrows move, Shift sprints, mouse or drag changes the view, and Escape pauses. The live demo uses 30 simulation ticks per second and bounded shared traffic meshes.

The slope-aware canopy snow from `tools/arcade/snow-canopy.mjs` is reused along both sides of the street. Scene authoring and driver signal policy live in `tools/winter/traffic-scene.mjs`; native engine routes, contacts and audio own motion, road wear and playback. Vehicles follow authored kinematic routes.

The original courtyard remains at `http://127.0.0.1:4173/?courtyard=1`: walk with WASD/arrows and press E near its car to start it. On touch screens, drag the left side to walk and the right side to look; tap the car prompt to interact. Its three goals use footprints, wet tyre spray and arrival at the bench.

The scene lives in `tools/winter/scene.mjs`; example-level goals live in `episode.mjs`. Native engine systems own simulation, animation, contacts and audio. The car follows an authored kinematic route when activated; this demo does not implement driving controls.

## Visual and performance reference

```sh
npm run demo:verify
```

Open `http://127.0.0.1:4173/?verify=1`, wait for the courtyard to load, then click **Проверить сцену** before starting the walk. This runs fixed keyboard input at 60 simulation ticks per second, checks footprints and wheel spray, and saves four 1280×720 PNGs plus `report.json` to `artifacts/winter/latest/`. Each view warms up for 24 rendered frames, measures 60 more, and records 384 scene-linear TAA color samples. GPU timings appear only when the adapter supports timestamp queries. CPU/GPU p95 measures renderer work, not total game FPS. Reload before another verification run.

Preserve a reviewed reference outside `latest/` before the next run, then compare:

```sh
node tools/winter/compare.mjs artifacts/winter/baseline/report.json artifacts/winter/latest/report.json
```

The comparison rejects changed cameras/ticks, flags color changes exceeding an absolute 0.02 plus relative 8% tolerance at over 5% of sample points, and flags CPU/GPU p95 above 130% of the reference plus 2 ms. Compare performance on the same computer/browser with other work idle. Inspect the PNGs too: sparse color probes cannot detect every visual regression. Reference files are generated and ignored by Git; saving them is enabled only by the verification server.


## Live snow migration fixture

Meshwork loads `tools/snow-city/scene.mjs`. One native authority advances at
60 Hz (vehicle force integration at 120 Hz). Workers receive compressed ranges
of authoritative snapshots and render them out of order; they do not replay the
city's history or run independent NPC simulations. The legacy recorded fixture
is retained for compatibility, but is not the live entry point.

`SnowMatter` is a sparse mass/enthalpy volume: 20 cm cells in the city and
10 cm in the shovel fixture. Load changes density, frictional work and body
contact transfer heat, and cutting/pouring/rolling exchange real material.
Gravity has a separate work queue from render invalidation. Distant changes are
archived by the authority. The city's renderer samples the upper surface; the
laboratory exposes voxel faces so a cut can preserve a roof over a cavity.
This is a bounded material approximation, not a grain-by-grain snow solver.

Native vehicle contact controls the preserved M3 mesh/soft panel cage. Driver
controls follow streets, respond to grip and recover a stalled engine with a
starter/open clutch. Resident needs select nearby work/play; compacted snowman
parts and loose creeping clumps use the same mass ledger. A loaded service
vehicle follows street junctions to a disposal boundary; exported mass is
recorded. The director scores slip, predicted closest approach and recent
subjects/districts. This is the first migration fixture, not a complete port of
TheGame's resident planning or persistent world simulation.

Materials may provide `texture.heightUrl` and physical `heightScaleM`.
The dedicated relief pipelines share bounded 8/16-step intersection between
camera, shadow, reflection and probe passes, with surface depth, normal,
self-shadow and previous-pose motion. Untextured materials retain the ordinary
pipelines. Relief is inward from the raster shell; bounded SDFs, outward
silhouettes and deformation-history motion of the virtual surface remain future
work. The height asset in this fixture is procedural test data.

Validation: `npm run check` includes snow mass/heat/undercut/avalanche tests,
late/out-of-order state restoration, audio segment continuity, separate vehicle
residency and static GPU cache invalidation. Real GPU image/stream validation
is performed through Meshwork's LAN server.

Sequential live workers now fetch material deltas between 120-tick checkpoints;
random access retains a full checkpoint. Archive removals travel in the same
ordered delta stream. The native store activates individual cells, rather than
reloading an entire tile when only its centre is nearby. Activation runs at 1 Hz;
eviction/writeback runs at 0.2 Hz or at the residency high-water mark. Archive
work appears explicitly in the authority profiler.

The distant radiance cache retains four exact cubemap/irradiance results. A
cache hit preserves diffuse irradiance, and a return to the same causes reuses
the generated texels. Coarse snow meshes rebuild only when a sampled physical
column changes; edits on distant streets do not invalidate unrelated terrain.

Terrain residency indexes material columns directly. Presentation applies only
the final value of each changed cell between rendered frames, while native
material integration remains unchanged. Backward seeks also clear soft-body
damage when it is absent from the requested authoritative snapshot.

The live presentation preserves physical snow vertex colour, including compacted,
melted and exposed cells. Height/optical samples interpolate cell centres; detailed
tile edges join the coarse grid with matching height, colour and normals. The
ground is the material surface rather than decorative box-shaped banks. Snow
grain detail is filtered at sub-millimetre scale and uses shared world coordinates.

Damaged M3 shells transfer native displacement onto cached smooth render topology
and recompute area normals across precompiled crease groups. The additional 2 mm
subdivision is selected when its projected error exceeds half a pixel. Changing
snow and damage meshes use small identity keys instead of serialising their arrays
for every GPU-cache lookup; they remain deeply immutable. Untouched snowfall shares
one immutable sample without growing a cache over the unbounded city.

The camera retains nine detailed districts and sixteen simplified skyline districts.
Generation priorities and flush wait for every admitted tile. Frames, sills, doors,
balconies and winter trees are static batches. The service truck has a shaped cab,
wheel/rim geometry and a curved blade; its visible payload integrates to the actual
collected volume and follows packet heat and emptying. These are presentation changes;
collision shapes and the authoritative material store remain separate.

Meshwork profiles expose `view.vehicles`, `view.people`, `view.snow` and `view.city`
as exclusive preparation times. Local FHD comparisons use identical native snapshots,
including a collision and subsequent deformation. They validate WebGPU compilation
and snow colour both with and without a deposited-cover state; they do not measure
Safari/M1 performance or prove FHD60 distributed throughput.
