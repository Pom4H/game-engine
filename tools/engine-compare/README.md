# Three-way native WebGPU benchmark

Completed local matrix evidence is in
`docs/render-evidence/engine-compare-matrix.json`, with the interactive report at
`artifacts/engine-compare/matrix-standard-v2-20261012/report.html`.
All 132 cases completed on Radeon 760M; all 44 configurations passed exact
canonical image repeatability and scene/motion/common-effect audits. The frame
budget gate failed. At 10k / 1080p / common-post / static, pooled CPU p95 is
6.6 / 1.3 / 1.3 ms and GPU p95 is 5.65 / 4.66 / 5.04 ms for Engine / Three /
Babylon respectively. Engine frame p95 rises to 25 ms for 1% authored motion
and 83.3 ms for 100% motion. These are headless local measurements with native
shader differences, not proof of equal image quality or displayed FPS.

## Motion API and upload audit (2026-10-13)

Fresh evidence: `docs/render-evidence/engine-compare-motion-api-audit.json`.
The direct/API control completed 54 cases in
`artifacts/engine-compare/motion-api-audit-20261013`. The corrected peer adapters
completed another 27 cases in
`artifacts/engine-compare/motion-api-coalesced-20261013/report.html`.
Both runs use the same engine source/build, 10k cubes, 1080p, common-post,
48 warmup + 240 measured frames and three rotated-order repetitions. All 27
saved measured and canonical frames match exactly across harness versions;
each backend's canonical captures also repeat exactly across fresh devices.
`npm run check` passes all 324 tests.

| Scenario | Engine CPU p95 ms | Three CPU p95 ms | Babylon CPU p95 ms |
| --- | ---: | ---: | ---: |
| Static | 6.0 | 1.1 | 1.2 |
| 1% motion, visual-transform API | 8.2 | 10.3 | 4.6 |
| 100% motion, visual-transform API | 92.7 | 20.3 | 15.4 |

For sparse motion, registering Engine movers changes all-pass draws from 10022
to 121 (108 dynamic shadow draws), while retaining 56520 requested upload bytes
and 212 writeBuffer calls per frame. Dense API motion retains 10021 all-pass
draws, 5283720 upload bytes and 10013 writeBuffer calls. Corrected dense peer
uploads use 3 / 4 calls for Three / Babylon, down from 10002 / 10003, with the
same 640576 / 640816 bytes and 8 / 7 draws. This is a harness correction, not
an Engine renderer optimization. Sequential timings have dispersion; these
captures establish exact work counts and saved-frame agreement, not an isolated
causal speedup. Engine's direct/static shadows use 2048px maps and registered
movers use 1024px dynamic maps; shared effect enablement is not equal quality.

## Current instance stream and pose changes (2026-10-13)

The follow-up evidence is `docs/render-evidence/current-instance-stream.json`.
The first stage is preserved in
`artifacts/engine-compare/instance-current-after-20261013/report.html` (39 cases).
The translation follow-up is
`artifacts/engine-compare/translation-current-after-20261013/report.html` (15 cases).
The focused follow-up measures Engine static/sparse API controls and dense API
motion across all three engines, with the same 10k / 1080p / common-post,
48 warmup + 240 measured frames and three rotated-order repetitions.

Without TAA, the main/reflection/shadow source now contains 24 floats (96 bytes):
the current model, color and weather. The full temporal path retains all 40
floats and previous matrices. GPU visibility receives the actual source stride;
CPU-batched culling and all instance shaders use the same layout. Without TAA,
there are no per-batch history commits or settling uploads of previous poses.
Sparse/dense instance writes are 9600 / 960000 bytes per frame, plus the same
3720 bytes of frame and individual body uniforms. Stable source membership
continues to need 112 / 13 writeBuffer calls and 22 all-pass draws for API motion.

Built-in live Render IR publishes the models changed during its authoritative
public-vector observation. Compact instance streams consume this list; visibility
membership still observes public material/geometry/role inputs, then applies
changed models without looking up every stable model again. Custom builders use
the full fallback. Membership, geometry/material replacement, and surface
eligibility changes rebuild the affected batch sources. Translation-only changes
copy the old linear matrix and write a new translation into an independent
snapshot, avoiding trigonometry and scale composition. Rotation/scale/geometry
changes still recompose. `setVisualTransform()` validates all inputs before
writing components into the existing arrays, with no splice/spread arguments.

All 335 tests pass with sequential Node execution and a 512 MB old-space ceiling;
typecheck/build also completed. A concurrent test run and the initial image
reporter hit host memory exhaustion. The reporter's PNG predictor no longer
creates an array for every decoded byte. Source tests and native buffer reads
cover direct/API edits, previous poses, light/reflected visibility, removal,
same-ID replacement, temporal reset and scene swap.

The first-stage dense API Engine CPU repetition p95 values were
26.1 / 26.7 / 91.5 ms; the pooled p95 is 43.9 ms, and that outlier is retained.
Low host RAM and later allocation failures limit timing interpretation; the
91.5 ms spike has not been conclusively attributed. Do not replace the pooled
value with the two faster repetitions. The compact stream changes exact upload
counts independently of this timing uncertainty. Pose and material membership
checks still scan public data, and the opaque shader has not been simplified.

| Engine scenario | Previous CPU p95 ms | Final CPU p95 ms | Final upload bytes/frame |
| --- | ---: | ---: | ---: |
| Static | 6.8 | 3.8 | 3720 |
| API motion, 1% | 5.9 | 4.7 | 13320 |
| API motion, 100% | 32.3 | 29.0 | 963720 |

Final dense CPU p95 is 29.0 / 21.1 / 22.9 ms for Engine / Three / Babylon;
Engine repetitions are 22.3 / 32.2 / 26.6 ms and Babylon repetitions are
17.6 / 33.4 / 18.4 ms. Memory pressure and dispersion prevent a reliable causal
speedup or CPU ranking claim. GPU p95 is 12.95 / 7.33 / 5.85 ms. All 54
comparative measured/canonical frame pairs and 20 native moving-history captures
match their previous source version exactly. This preserves exercised Engine
images; it does not establish cross-engine visual equivalence.

A separate 120-frame dense diagnostic in
`artifacts/engine-compare/translation-current-cpu-profile-20261013` reports mean
CPU 18.02 ms. Covered native WebGPU APIs account for 0.50 ms; projection,
preparation and culling account for 5.00 / 7.31 / 2.82 ms exclusive mean time.
Preparation includes eligibility, source packing and shadow-index grouping;
projection still observes public poses. The remaining time also includes authored
motion, timer/hook overhead and uncovered native APIs. These diagnostic timings
are outside the 54 competitive measurements. There are 55 total completed cases.

Reproduce the final follow-up after `npm run build`:
`node tools/engine-compare/matrix.mjs --plan artifacts/engine-compare/translation-current-plan-20261013.json --output <fresh-directory>`.
Use `node --max-old-space-size=256 tools/engine-compare/matrix-report.mjs --output <directory>`
to validate saved PNGs and generate HTML/CSV. Serial tests used
`node --max-old-space-size=512 --test --test-concurrency=1 test/*.test.mjs`.
Native buffer checks used `CANONICAL_COUNT=32` and
`node tools/gpu-visibility/diagnose-canonical.mjs --model-history`, then the same
command with `--current-instances` into a separate `CANONICAL_OUTPUT`.

## Parameter matrix (shared effects)

### Shared shadow source (2026-10-13)

The implementation and measurements are recorded in
`docs/render-evidence/shared-shadow-instancing.json`; the fresh report is
`artifacts/engine-compare/shadow-shared-after-20261013/report.html`.
All 39 cases completed at 10k / 1080p with 48 warmup + 240 measured frames and
three repetitions. This includes all three engines for static and sparse/dense
API motion, plus Engine direct-mutation, moving-camera and dense CPU-batched
controls. The engine changes are confined to `webgpu.ts` and `instancing.ts`.

Static and dynamic shadows own separate persistent light-visible index buffers
and read the same 40-float source as the main and reflected instance passes.
They never use main-camera visibility. Fully instanced entities prepare only
the batch representative's shared material uniform; pose changes do not upload
that uniform. Individually rendered probe/surface/image/label cases retain their
own uniforms. Switching a representative to an individual pass or replacing its
material refreshes the uniform. Batch growth/removal/disposal releases its shadow
views; the old unused shadow-matrix upload helpers and pipelines were removed.

| API motion | All-pass draws before / after | Upload bytes before / after | writeBuffer calls before / after |
| --- | ---: | ---: | ---: |
| 1% | 121 / 22 | 56520 / 19720 | 212 / 112 |
| 100% | 10021 / 22 | 5283720 / 1603720 | 10013 / 13 |

Dense direct mutation uses 23 draws, 1603720 bytes and 13 writeBuffer calls.
Dense API CPU p95 is 32.3 ms versus 23.2 / 18.1 ms for Three / Babylon in the
fresh run. The previous Engine API capture was 92.7 ms; these sequential captures
are not an isolated timing experiment. Static CPU remains 6.8 ms and dense API
opaque GPU mean remains about 12 ms: complete parity is not established.

All 18 comparable Engine saved measured/canonical cases match the prior pixels
exactly, and all 13 new configurations repeat canonically across fresh devices.
Three native wet quality views also match presentation and HDR reflection exactly.
The native 40-frame history diagnostic passes in GPU and CPU-batched modes,
including physical motion, direct/API changes, hidden reentry, replacement,
removal, reset and scene swapping. `npm run check` passes 328 tests. Intermediate
frame colors were not compared in full; the history diagnostic verifies actual
current/previous GPU matrices and upload contents across its frame sequence.

`matrix.mjs` runs a frozen source/build/harness rather than combining unrelated
historical captures. The current standard plan contains **159 actual renderer cases**;
the completed historical matrix above contains 132 and uses direct pose mutation:

| Sweep | Parameters | Cases |
| --- | --- | ---: |
| Reference | 1k / 5k / 10k cubes, 1080p, static / moving camera | 54 |
| Resolution | 10k cubes, 720p, static / moving camera | 18 |
| Effects | 10k cubes, 1080p, bloom on for all three engines | 18 |
| Sparse changes | 10k cubes, 1% authored motion, camera fixed / moving | 18 |
| Dense changes | 10k cubes, 100% authored motion | 9 |
| Sparse API control | 10k cubes, 1% motion through `setVisualTransform()`, camera fixed / moving | 18 |
| Dense API control | 10k cubes, 100% motion through `setVisualTransform()` | 9 |
| Engine culling | 10k cubes, CPU batched culling, static / moving camera | 6 |
| Instancing | 1k cubes, individual meshes/main-view draws on all engines | 9 |

This is a controlled parameter sweep, not every Cartesian combination. Each
standard case uses 48 warmup + 240 measured frames, three rotated-order
repetitions, a fresh native WebGPU document/device and one shared timestamp ring.
The measured CPU interval includes authored motion, one matrix construction per
moving object in each backend, and actual buffer updates. Engine composes inside
its live projection; peers compose in their adapters. Expected matrices are
recomputed outside timing for audits, avoiding duplicate Engine-only work.
All three use one fixed HDR radiance input through the engine's existing
`environmentRadiance` parameter. Dynamic IBL regeneration is not secretly
enabled only on Engine. Synthetic scene-derived radiance remains an explicit
single-engine diagnostic, outside the shared comparison. Physics is frozen;
transformed cubes return to their authoritative initial pose
before replay checks. Both actual final measured images and restored canonical
images are saved. Motion hashes and actual peer/Engine matrices must match.

`COMPARE_MOTION_API=direct` (the historical default) modifies `entity.position`
and leaves body-free cubes in the static shadow map. `visual-transform` calls
`Scene.setVisualTransform()` with the existing rotation and scale, registering
the selected cubes as render movers. The same API and poses are used in all
three adapters, including its cost in the CPU interval. Both sparse and dense
controls are included in the matrix. Reports audit and expose the registered
mover count and count `writeBuffer` calls even when CPU API timing is disabled.
Pose restoration preserves API mover registration; API canonical captures
therefore retain the engine's dynamic-shadow resolution. Historical direct
motion timings must not be described as timings of the visual-transform API.

Peer adapters coalesce adjacent changed matrix records into upload runs. Dense
motion uses one matrix upload per batch; sparse motion leaves unchanged gaps
untouched. Three's WebGPU backend consumes the supplied update ranges separately,
so adding one range per matrix otherwise creates 10k queue calls. Babylon's
numeric `thinInstancePartialBufferUpdate('matrix', count, firstInstance)` overload
uploads each run from its maintained CPU matrix buffer. Native batch bounds are
still refreshed once per touched mesh inside CPU timing on both peers.

`common-post` disables AO, SSR, DOF, bloom, planar reflections and AA on every
renderer. `common-bloom` enables native bloom on every renderer while retaining
the same other switches. Bloom executions are observed, not just labeled.
Threshold 1, weight .46 and initial resolution scale .25 are recorded; native
soft knees, blur kernels and mip chains differ. PBR, atmosphere, shadow filtering,
IBL and tone mapping also remain native. Common effect enablement does not imply
equal pixel quality. Additional full-native features are outside this shared
matrix rather than silently replaced with a different effect.

```powershell
npm run build
node tools/engine-compare/matrix.mjs --dry-run
node tools/engine-compare/matrix.mjs --tier smoke --output artifacts/engine-compare/matrix-smoke-new
node tools/engine-compare/matrix.mjs --output artifacts/engine-compare/matrix-standard-new
node tools/engine-compare/matrix-report.mjs --output artifacts/engine-compare/matrix-standard-new
```

The smoke tier checks adapter bindings, hashes and modes with 16 cubes and short
samples; it is not performance evidence. `--plan plan.json` accepts a validated
custom matrix with explicit controls. `--resume --plan <saved plan.json>` reuses
completed batches only if the frozen trees and controls match. An incomplete or
failed batch remains preserved and requires a fresh output. Completed execution,
60 FPS budgets and canonical repeatability are separate gates.

The report contains filterable parameter rows, p50/p95/mean, per-repetition p95
and dispersion, requested upload bytes, all-pass draw calls, hardware/browser/
driver metadata, source fingerprints, raw samples, PNGs and CSV. The reporter
compares every decoded canonical RGBA8 channel across fresh-device repetitions
without tolerance. Headless RAF FPS is not display FPS; exclusive GPU use and
cross-engine pixel quality are not inferred from this local run.

For a single batch, `COMPARE_PROFILE`, `COMPARE_WIDTH`, `COMPARE_HEIGHT`,
`COMPARE_COUNTS`, `COMPARE_SCENARIOS`, `COMPARE_ENGINE_VISIBILITY` (`gpu`,
`cpu-batched`, `cpu`), `COMPARE_PEER_INSTANCING` (`1`, `0`) and
`COMPARE_DIRTY_FRACTION` (`0`–`1`) are explicit controls. Motion scenarios are
`static`, `camera-motion`, `object-motion` and `camera-object-motion`.
`COMPARE_ENVIRONMENT` defaults to `fixed`; `scene-derived` selects the historical
procedural environment workload and is not accepted for a shared multi-engine
matrix.

The local surface-presence candidate is recorded in
`docs/render-evidence/surface-presence-comparison.json` and
`docs/render-evidence/surface-presence-quality.json`. Public physical-state Map
mutations publish a compact presence index for batch eligibility. Numeric states,
generated visual source links and custom state readers retain their original
semantics. The native paired diagnostic is
`node tools/gpu-visibility/diagnose-canonical.mjs --surface-presence` (128 pairs
per camera route by default).

The measured candidate source/build and the exact baseline runner are frozen in
`artifacts/engine-compare/surface-presence-after/measured-workspace`. All 36 native
three-way cases and three wet quality views completed with matched scene/replay
inputs. Paired CPU preparation improved by about 0.10 ms; its p95 changed from
1.8 to 1.5 ms. This does not establish a full-frame speedup: 10k static CPU p95
regressed from 8.3 to 10.3 ms, and frame p95 remains around 20 ms.

Wet presentation and finite HDR reflection channels match exactly. The original
canonical gate failed on one PNG channel; the paired final TAA and fresh-device
32-frame repeatability gates also failed. Both GPU and CPU-batched visibility
show upstream opaque shading changes with identical depth and velocity. These
failures are retained without adding a pixel tolerance. Native shadow arithmetic
and receiver-plane tests pass; production material compiler messages are empty.
The candidate remains under investigation, with no peer-quality or competitive
advantage claim. Local Windows workflow coverage is configured; GitHub execution
and artifact quota recovery are not confirmed by these local runs.

Lighting localization is recorded in
`docs/render-evidence/opaque-lighting-localization.json`. Two native diagnostic
probes observed 384 canonical frames on 12 fresh devices. Scalar shadow,
roughness, normal derivative variance and sun cosine matched after rgba16float
conversion despite opaque differences. The second probe found a separate
environment/view-cosine difference with an exact opaque output at that frame.
Actual camera instance buffers matched the CPU 40-float records on every frame;
shadow and light observations also matched. The cause remains unresolved.
The probes replace normal MRT output while preserving color arithmetic; shader
scheduling and downstream effects change, so their captures are not visual
quality or performance measurements. Exact measured code is archived with each
report, and strict failed repeatability gates remain intact.

```powershell
$env:CANONICAL_REPETITIONS='3'
$env:CANONICAL_OUTPUT='artifacts/engine-compare/lighting-probe-new-run'
node tools/gpu-visibility/diagnose-canonical.mjs --instance-order --lighting-probe --shadow-inputs --check-repeatability
$env:CANONICAL_OUTPUT='artifacts/engine-compare/environment-probe-new-run'
node tools/gpu-visibility/diagnose-canonical.mjs --instance-order --lighting-probe --probe-kind=environment --shadow-inputs --instance-inputs --check-repeatability
```

Unmodified-shader controls are recorded in
`docs/render-evidence/opaque-boundary-localization.json`. They observed another
384 frames on 12 fresh native devices at 10,000 objects and 1920×1080. In the
readback control, opaque and normal native binary16 copies agree with independent
compute textureLoad/binary32 observations and repeated native copies in every
frame, including an opaque divergence. This control does not independently
validate the packed specular or velocity codecs.

The boundary control captures all four MRT textures immediately after the opaque
pass, before later rendering and postprocessing. Every boundary snapshot matches
the corresponding texture after the full frame. Opaque and velocity differences
between repetitions are already present at that earlier boundary. This places
the observed changes inside or before the opaque producer; the particular
input, interpolation, shader or export cause remains unresolved. Both controls
still fail strict repeatability. Copies and compute observations affect GPU
scheduling; these reports establish neither visual quality nor a speedup.
The project check passes all 292 tests, which does not override the native failure.

```powershell
$env:CANONICAL_REPETITIONS='3'
$env:CANONICAL_OUTPUT='artifacts/engine-compare/readback-agreement-new-run'
node tools/gpu-visibility/diagnose-canonical.mjs --instance-order --readback-checks --shadow-inputs --instance-inputs --check-repeatability
$env:CANONICAL_OUTPUT='artifacts/engine-compare/opaque-boundary-new-run'
node tools/gpu-visibility/diagnose-canonical.mjs --instance-order --opaque-boundary --shadow-inputs --instance-inputs --check-repeatability
```

The diagnostic-only `--lighting-probe --probe-kind=velocity-input` writes the
interpolated fragment velocity to the normal attachment's first two channels,
alongside geometric normal y and the object seed. The original velocity export
remains intact. Exact duplicate-export checks cover all depth-covered pixels;
depth-clear background is counted and excluded because attachment clear values
differ. This probe supports `--opaque-boundary` to compare the duplicates at pass
end as well as after the full frame. With `--readback-checks`, the RG16 velocity
packing path is additionally checked against independent textureLoad/f32-bitcast
observations and a repeated packed read. Missing checks or duplicate disagreement
fail the strict gate. Probe shading and GPU scheduling differ, so no diagnostic
capture or timing establishes production quality or performance.

```powershell
$env:CANONICAL_REPETITIONS='3'
$env:CANONICAL_OUTPUT='artifacts/engine-compare/velocity-export-new-run'
node tools/gpu-visibility/diagnose-canonical.mjs --instance-order --lighting-probe --probe-kind=velocity-input --opaque-boundary --readback-checks --shadow-inputs --instance-inputs --check-repeatability
```

The completed velocity export control is recorded in
`docs/render-evidence/velocity-export-localization.json`: 192 frames on six fresh
devices, 384 duplicate comparisons and 576 independent readback checks agree.
Velocity variation did not reproduce; opaque color still changes between
repetitions, so strict repeatability fails. The measured probe's alpha channel
used a representative uniform seed for instances and is excluded from
per-instance input conclusions. The archived code records that limitation;
the current probe generator selects the storage seed for instanced shaders.

`--probe-kind=material-input` observes the fragment's material RGB and source
index. The index is encoded as an exactly representable normal binary16 value,
with raw word `index + 1024`; non-instanced entry points use the `0x7bff` sentinel.
This control requires one camera batch, at most 30,719 instances, and
`--instance-inputs` to check its actual GPU source records. Every covered
instanced pixel is checked against the visible index set and that source record's
RGB. Input conversion admits only the two adjacent binary16 values allowed by
[WGSL floating point conversion](https://www.w3.org/TR/WGSL/#floating-point-conversion);
all cross-frame image comparisons retain zero tolerance. Background and
non-instanced pixels are counted separately. An invalid index or color outside
the conversion interval fails the material input gate.

```powershell
$env:CANONICAL_REPETITIONS='3'
$env:CANONICAL_OUTPUT='artifacts/engine-compare/material-input-new-run'
node tools/gpu-visibility/diagnose-canonical.mjs --instance-order --lighting-probe --probe-kind=material-input --opaque-boundary --readback-checks --shadow-inputs --instance-inputs --check-repeatability
```

The material input control is recorded in
`docs/render-evidence/material-input-localization.json`. All 384 input checks
across 192 frames on six fresh devices pass: source indices are in the observed
visible set and RGB matches its actual source record's conversion interval. The
complete RGB/index probe also matches exactly across every repeated frame.
Independent readback and all four MRT boundary checks agree. Nevertheless,
opaque, specular and velocity show rare changes and strict repeatability fails.
The first attempt's diagnostic source-association error is archived separately;
the completed report uses the corrected camera/source identity check.
All 298 project tests pass; this does not override the native failure.

The production source/build remains unchanged. These input observations do not
exhaust the shading dependencies. The next control below observes actual material
uniforms; full-precision fragment values and sampled textures still require
isolation. No lighting workaround or competitive win is claimed.

`--material-uniforms` observes binding 0 at every actual opaque material draw.
The observer captures complete host uploads (including partial writes), snapshots
the host image at draw encoding, and reads all 92 GPU words immediately after
opaque pass end in the same command encoder. It checks actual buffer identity,
zero binding offsets and the 368-byte ABI. The observed material draw count must
match the renderer's count for this opaque-only fixture; missing draws, reference
stages or host coverage cannot pass. Exact host/GPU word disagreement fails the
material uniform gate, separately from temporal stage comparisons. The observer
leaves render shaders and buffer usage intact; added compute/copies change GPU
scheduling and do not measure performance.

Host byte reconstruction follows
[writeBuffer source offset/size units](https://developer.mozilla.org/en-US/docs/Web/API/GPUQueue/writeBuffer#parameters):
typed-array offsets/sizes use elements, while ArrayBuffer/DataView use bytes.

```powershell
$env:CANONICAL_REPETITIONS='3'
$env:CANONICAL_OUTPUT='artifacts/engine-compare/material-uniforms-new-run'
node tools/gpu-visibility/diagnose-canonical.mjs --instance-order --material-uniforms --opaque-boundary --readback-checks --shadow-inputs --instance-inputs --check-repeatability
```

The completed native control is recorded in
`docs/render-evidence/material-uniform-localization.json`: 192 frames across six
fresh devices, 10,000 objects at 1080p. All 1,920 actual material draws were
observed (10 per frame), covering 176,640 uniform words. Every GPU word agrees
with its captured host image; both records repeat exactly for each frame across
repetitions. Instance source words, Frame/light buffers and the observed shadow
maps repeat too. Two shuffled captures still differ in opaque RGB at one pixel
each, at frames 12 and 25, already at opaque pass end. The independent opaque/
normal readback checks and all four boundary comparisons agree. The strict
repeatability gate therefore remains false; 302 passing project tests do not
override it. Measured source/build/harness/diagnostic trees are archived and
verified. Render shaders are unchanged by this control, but added GPU work
changes scheduling and provides no production performance or quality claim.

`--probe-f32 --probe-kind=world-input` observes fragment world XYZ and the exact
source index in a diagnostic `rgba32float` normal attachment. Regular draws use
index -1; background is identified by depth clear. Every covered source index is
checked against the actual GPU-validated visible set. Native copies retain all
binary32 bits, including signed zero; independent `textureLoad` bitcasts and
repeat copies validate readback. Other MRT outputs retain their formats and the
four attachments require a 36-byte render-target budget (the WebGPU cost for
`rgba8unorm` is eight bytes, distinct from its four-byte texel payload). The
diagnostic checks the adapter limit and requests only this higher device limit;
optional filtering/blending features are not enabled. Pipeline descriptors and
main pass attachments are changed only in the diagnostic. Production source/build
is unchanged, but compiler scheduling and GPU work can change.

The original normal texture stays untouched and bound to effects, so downstream
images are diagnostic and cannot certify quality or performance. Do not use
this control's postprocessing output to compare rendering with competitors.
All probe frames require explicit format, pass and index coverage. Full precision
can also be selected for scalar/environment probes; it cannot be combined with
the existing binary16 material or duplicate-velocity numerical checks.

The first attempt in `artifacts/engine-compare/surface-presence-world-input-f32`
failed native initialization because it requested the default 32-byte budget.
Its report and measured code are retained as failed evidence. Corrected runs
must use a new output directory; the failed attempt is not a passed gate.
The format cost follows the [WebGPU texture format table](https://www.w3.org/TR/webgpu/#plain-color-formats).

```powershell
$env:CANONICAL_REPETITIONS='3'
$env:CANONICAL_OUTPUT='artifacts/engine-compare/world-input-f32-new-run'
node tools/gpu-visibility/diagnose-canonical.mjs --instance-order --lighting-probe --probe-kind=world-input --probe-f32 --material-uniforms --opaque-boundary --readback-checks --shadow-inputs --instance-inputs --check-repeatability
```

The corrected native control is recorded in
`docs/render-evidence/world-input-f32-localization.json`: 192 frames across six
fresh devices, 10,000 objects at 1080p. Every observed binary32 fragment XYZ/index
word repeats exactly. All 384 source-index checks pass; 1,920 actual material
draws cover 176,640 uniform words with no host/GPU disagreement. Independent
opaque/probe readback and all four boundary comparisons agree. One shuffled
capture still differs in six opaque RGB channels at frame 6, already at pass
end. Strict repeatability remains false. The measured code is archived and
verified; 310 project tests pass. Stable XYZ/index observations do not exhaust
the fragment's inputs or identify the cause of the remaining color variation.

Run from the repository root:

```sh
npm run build
npm install --prefix artifacts/engine-compare/vendor --no-save --no-package-lock --ignore-scripts three@0.186.1 @babylonjs/core@9.30.0
node tools/engine-compare/benchmark.mjs
node tools/engine-compare/summarize.mjs
```

The pinned peer packages and generated images stay under ignored `artifacts/`.
The engine keeps its existing dependency set. Babylon's shader translators are
served from its pinned local package; rendering uses no external CDN.

Defaults: 1920×1080, 5,000 and 10,000 cubes, static and moving cameras, 48 warmup
frames, 240 measured frames, three repetitions. Each repetition rotates the
backend order. Every case gets a fresh document and device in an isolated
headless Chrome profile on the native GPU. Set `CHROME_PATH` when necessary.

PowerShell overrides, for example:

```powershell
$env:COMPARE_FRAMES='240'
$env:COMPARE_REPETITIONS='3'
$env:COMPARE_COUNTS='5000,10000'
$env:COMPARE_SCENARIOS='static,camera-motion'
node tools/engine-compare/benchmark.mjs
```

`COMPARE_WIDTH`, `COMPARE_HEIGHT`, `COMPARE_WARMUP`, `COMPARE_BACKENDS` and
`COMPARE_OUTPUT` are also supported. The engine entry uses `visibility:'gpu'`.
The report records browser version, source/build hashes and the dirty Git state.

## Scene equality

All adapters consume the same deterministic physics snapshot after 60 ticks.
There are N cubes, one ground box, eight physical spheres and four point lights,
plus the same directional sun. Physics is outside the measured interval and
remains frozen. Exact positions, normals, indices and Float32 model matrices
come from production Render IR, including sphere tessellation. Peer libraries
use instancing and native PBR with the same authored colors, roughness and
metalness. Colors are converted to linear RGB using the engine's power-2.2 rule.
Peer shadow maps use the same 2048px/290m frustum, raster depth bias 1 and slope
bias 1.5 as the production engine. The small normalized depth offset is 0.000025
(Three receiver API -0.000025; Babylon caster API 0.00005 with its WebGPU half-Z
factor). Raster slope bias reduces terrain self-shadowing without a large
constant world-space offset. Residual PCF striping remains visible in Babylon's
large ground and is recorded as a visual limitation. Shadow filters remain native
and different.

Camera motion is indexed by frame, independently of each backend's FPS.
Right-handed view and WebGPU projection matrices are audited. The current
engine's `cameraProjection` uses clip defaults 0.05–10,000 m; the peers use those
actual defaults too. TAA jitter is a pipeline feature, excluded from the base
projection audit.

All backends receive the same 256px HDR environment cubemap generated once
outside measurement. Three's sampling X convention is adapted without changing
the source radiance. Native roughness prefiltering and diffuse integration
remain different. Babylon uses native HDRFiltering with 64 GGX samples before
measurement; Three uses native PMREM. Setup generation accesses the engine's bounded radiance cache
through a benchmark-only adapter and fails explicitly if that contract changes.

Source, geometry, environment and replay hashes must match across cases.
Actual peer geometry/instance buffers and production engine Render IR are
audited. Rendering must leave the physical snapshot hash unchanged. Software
adapters, GPU validation errors, blank captures and insufficient timestamps fail
the run. In-progress and failed reports keep their explicit status.

## What the numbers mean

- CPU is wall time for camera update and the synchronous render call, including
  common instrumentation hooks. Timestamp resolve overhead is reported separately.
- GPU is the sum of hardware render/compute pass durations measured by one common
  eight-slot asynchronous ring. It excludes copy-only commands and queue gaps.
  No GPU readback or fence is awaited inside the measured frame loop.
- Frame interval is RAF interval; FPS is 1,000 divided by its mean. Native
  headless scheduling can quantize intervals and does not establish display FPS.
- Upload bytes count requested `writeBuffer`/`writeTexture` payloads, respecting
  typed-array element units. External-image copy estimates are separate. They
  are not a claim about physical bus traffic.
- Draw counts include all passes and executed cached render bundles. Indirect
  draws are counted, but their triangles cannot be inferred without readback;
  `trianglesDirect` explicitly excludes them.
- Aggregates pool per-frame samples across repetitions. Per-repetition FPS is
  retained to show variability. A 60 FPS gate checks CPU/GPU/frame p95 separately.

These are **identical scene inputs with different native pipelines**. The engine
includes procedural surface detail, TAA, AO, SSR, planar reflections and bloom;
peers use native PBR, shadows, the shared environment and ACES tone mapping,
without additional AA/effects. Point-light attenuation, shadow filtering,
atmosphere, tone mapping and IBL also differ. `pipeline` records these features.
Canonical PNGs and RGB sample differences make the mismatch reviewable. Results
do not prove a speed advantage at equal pixel quality.

`COMPARE_CPU_API_TIMINGS=1` adds opt-in synchronous host timings around covered
native queue/device/texture/command/pass calls. Per-frame raw method counts,
exclusive/inclusive durations and the remaining render wall time are retained.
Nested native calls contribute once to the exclusive total. Timestamp resolve
work stays outside the measured renderer interval. This is host API time, not
GPU execution time or direct proof of a driver stall. The remaining interval
includes JavaScript, instrumentation overhead and uninstrumented native calls
(including `GPUCanvasContext.getCurrentTexture`); it is not pure JS compute.
The default leaves this timing off. Use separate off/on captures of the same
harness to assess observer overhead before drawing performance conclusions.

```powershell
$env:COMPARE_COUNTS='10000'
$env:COMPARE_SCENARIOS='static'
$env:COMPARE_REPETITIONS='3'
$env:COMPARE_CPU_API_TIMINGS='0'
$env:COMPARE_OUTPUT='artifacts/engine-compare/cpu-api-off-new-run'
node tools/engine-compare/benchmark.mjs
$env:COMPARE_CPU_API_TIMINGS='1'
$env:COMPARE_OUTPUT='artifacts/engine-compare/cpu-api-on-new-run'
node tools/engine-compare/benchmark.mjs
```

The completed native off/on control is recorded in
`docs/render-evidence/cpu-api-timing.json`: 18 fresh devices and 4,320 measured
frames, with unchanged production source/build and archived harnesses. At 10k
static objects and 1920×1080, the off control has CPU/GPU/frame p95:

| Backend | CPU p95 (ms) | GPU p95 (ms) | Frame interval p95 (ms) |
| --- | ---: | ---: | ---: |
| Engine | 7.70 | 10.774 | 20.0 |
| Three.js | 1.30 | 5.850 | 10.1 |
| Babylon.js | 1.20 | 5.673 | 10.1 |

In the timing-enabled Engine capture, covered native calls average 0.352 ms
out of 7.781 ms render wall time (4.53%). An actual overall-p95 frame takes
10.9 ms, including 0.4 ms in covered native calls. The remainder includes timer
and hook overhead and uncovered APIs, so it cannot be attributed wholly to JS.
Browser clock quantization makes many individual fast-call samples zero.
The sequential off/on CPU difference includes run variation; observer overhead
has not been isolated. These are profiling results, not a production speedup.

All 18 canonical PNGs match their own backend's control exactly. This does not
override earlier temporal repeatability failures or establish equal quality
between backends. Personal inspection found smoother but softer distant detail
in Engine, with different contrast, sky and lighting in the peers. No competitive
quality winner is established. All 312 repository checks pass.

### CPU phase observation

`COMPARE_CPU_PHASE_TIMINGS=1` records exclusive CPU time in existing renderer
phases while keeping the renderer's GPU profiler disabled. It requires
`COMPARE_BACKENDS=engine`; the default three-way comparison leaves it off.
Enabling the GPU profiler would add occlusion/query work and would change this
control. Per-frame phase sums and the uncovered remainder are retained and
checked against the measured render wall interval. The remainder includes
uncovered native calls and observer overhead. GPU timestamps remain separate.

```powershell
$env:COMPARE_BACKENDS='engine'
$env:COMPARE_COUNTS='10000'
$env:COMPARE_SCENARIOS='static,camera-motion'
$env:COMPARE_REPETITIONS='3'
$env:COMPARE_FRAMES='240'
$env:COMPARE_WARMUP='48'
$env:COMPARE_CPU_API_TIMINGS='0'
$env:COMPARE_CPU_PHASE_TIMINGS='1'
$env:COMPARE_OUTPUT='artifacts/engine-compare/cpu-phases-new-run'
node tools/engine-compare/benchmark.mjs
```

`docs/render-evidence/cpu-phase-timing.json` records six fresh native devices and
1,440 measured frames. Projection averages 1.988 ms (static) / 2.009 ms (camera
motion); preparation averages 1.479 / 1.613 ms, and culling 1.210 / 1.320 ms.
This identifies CPU work to investigate; it does not measure observer overhead
in isolation or prove a production speedup. Five of the six canonical images
match the prior Engine control exactly; one moving capture differs in two PNG
channels. No prior temporal failure is overridden. All 314 tests passed at that
capture; the subsequent restored-source check passes 317.

### Radiance cause experiments: rejected after replication

Three CPU candidates were measured without shader or physical-state changes:
frozen material certificates, an absent-emission guard, and cached static mover
membership. None remains in production. The first made static CPU work slower;
the second did not establish overall static CPU improvement; the third failed
an independent larger replication. Evidence and archived source/build/harnesses
are retained in `docs/render-evidence/radiance-cause-plan-rejected.json`,
`radiance-emission-demand-not-adopted.json` and
`radiance-membership-not-adopted.json`.

Static membership initially saved a mean 0.034 / 0.083 ms of combined
projection/environment CPU time in 128 pairs per route. A fresh 512-pair capture
of the exact same source/build instead measured **+0.013 / +0.027 ms**, for
static / moving routes respectively. Both first orders had positive means in
the larger capture. Block-bootstrap 95% intervals span zero for both routes;
`radiance-paired-confidence.json` retains both captures rather than selecting
the favorable one. Whole environment causes, replay hashes, and observed
draw/upload work match in every pair. The strict final-stage gate still fails:
the larger capture changes 35 TAA channels in candidate and baseline repeats.
That observation does not establish a candidate-caused regression.

The 72 complete native before/after cases cover 5k/10k, static/camera-motion,
Engine/Three/Babylon, three repetitions, 240 measured and 48 warmup frames at
1920×1080. `radiance-membership-comparison.json` and the gallery in
`artifacts/engine-compare/radiance-membership-comparison/report.html` retain
these results. Engine 10k GPU p95 changes from 12.52 / 13.19 to 11.29 / 10.93 ms,
while the peers remain around 4.7–5.3 ms. Engine 5k CPU p95 becomes worse.
Sequential runs do not isolate clock/load variation, and the native pipelines
have different effects and AA; these numbers prove no competitive advantage.
The full frame-budget gate fails. Three PNG channels in the 10k static candidate
are outside the observed baseline range by one 8-bit level, so the original
canonical-image gate also fails. All three wet presentation/reflection views
match control exactly. Personal full-resolution inspection and image hashes are
recorded in `radiance-membership-quality.json`.

`diagnose-canonical.mjs --radiance-cause-plan` switches a historical compiled
radiance projection and the renderer's current projection on one native device.
It accepts `CANONICAL_PAIRS` from 16 to 512 and defaults to 10,000 objects. Each
pair alternates first order, includes two settling frames per variant, and
preserves both variants' final opaque/HDR/TAA comparisons. Run a rejected
candidate from its archived `measured-state` tree: the current production code
has been restored to the historical source, so running the current diagnostic
does not recreate that candidate. Use a fresh output directory. Failed gates
write the complete report and return a nonzero exit status.

The complete native comparison can be regenerated from the frozen workspaces:

```powershell
node tools/gpu-visibility/compare-model-history.mjs --experiment radiance-membership --paired artifacts/engine-compare/radiance-membership-paired/report.json --before artifacts/engine-compare/radiance-membership-before --after artifacts/engine-compare/radiance-membership-after --output artifacts/engine-compare/radiance-membership-comparison-new --check-budget
```

The rejected candidate's source/build and both native diagnostic archives were
verified before restoration. Current production source/build match the CPU
phase control byte for byte. The final project check passes all 317 tests;
local success does not establish CI success or artifact-quota recovery.

`report.json` and a standalone `report.html` with metrics, controls and images
are saved in `artifacts/engine-compare/`. A compact evidence JSON can be exported
with `node tools/engine-compare/summarize.mjs --evidence <path>`. Local completion
does not imply a GitHub Actions run or solve artifact-storage quota.

## Reflection optimization: performance and visual inspection

With `visibility: 'gpu'` or `'cpu-batched'`, the main and reflected cameras share
one persistent 40-float source stream, but own independent compacted indices and
indirect arguments. The reflected pass preserves the production LOD shader,
plane clip, vertex colors, emission, 62.5% resolution and all postprocessing.
Images, labels, per-object weather and surface fields keep their existing path;
snow/asphalt remain excluded from the planar capture. Each reflected batch adds
three bounded buffers, exposed by `inspect().visibility.reflection` and released
with its main source generation. `cpu` remains the default reference mode.

For a before/after experiment, build and capture **before editing renderer code**:

```powershell
npm run build
$env:COMPARE_BACKENDS='engine'
$env:COMPARE_QUALITY='1'
$env:COMPARE_OUTPUT='artifacts/engine-compare/reflection-before'
node tools/engine-compare/benchmark.mjs
# Apply the renderer change, then build and measure again.
npm run build
$env:COMPARE_OUTPUT='artifacts/engine-compare/reflection-after'
node tools/engine-compare/benchmark.mjs
node tools/engine-compare/compare-reflection.mjs --evidence docs/render-evidence/planar-reflection-instancing.json
```

`COMPARE_QUALITY=1` adds three native engine captures outside measurement:
front, reverse and low camera views of a wet road, colored/nonuniform instances,
vertex colors, emissive spheres, glass, image materials, labels and snow.
It saves the presentation PNG + full RGBA8 pixels and reflection preview + full
linear rgba16float pixels. The fixed Reinhard/sRGB preview is only for inspecting
the reflection buffer. The final image uses the engine's unchanged tone mapping.
The texture bytes and physical replay are hashed independently.

The comparator requires matching controls, hardware, browser, measured harness,
source/geometry/environment/replay hashes. Wet-scene presentation and reflection
texels must match exactly. Canonical benchmark PNGs are decoded fully; every
after channel must lie within the observed baseline repetitions' range for the
same pixel/channel. This detects a changed image without inventing a tolerance
for pre-existing repeat variation. The current native baseline varied at eight
channels by one RGB8 level across its six captures per cube count; nine of twelve
paired PNGs were identical, and every after pixel stayed within that baseline
range. All three wet captures and their HDR targets matched exactly.

On 2026-10-11, Windows/AMD RDNA 3 at 1920×1080, three repetitions of 240 frames:
moving-camera CPU p95 fell from 14.3 to 8.0 ms at 5,000 cubes and from 27.5 to
14.4 ms at 10,000. Mean RAF FPS rose from 79.2 to 100.6 and from 45.1 to 77.3.
The 10,000-cube reflection draw count fell from about 5,440 to nine; all-pass
draws fell from about 5,466 to 36. Additional visibility uploads are 132 bytes
per frame for this one batch. Sequential GPU measurements can vary with clock
and load; headless RAF does not establish display/VSync performance. The
10,000-cube frame p95 remains 20.1 ms, so the stable 60 FPS gate still fails.

The current before run deliberately served the older, already built `dist`
while source edits were pending. Its `distSha256` matches the earlier three-way
benchmark's compiled build. The recorded working-tree source hash is retained
and labeled separately from that executed baseline. Future experiments should
use the build-first sequence above.

`compare-reflection.mjs` writes a reviewable HTML gallery and JSON evidence in
`artifacts/engine-compare/reflection-comparison/`. `--check-budget` returns a
nonzero exit code while any CPU/GPU/frame p95 exceeds 1000/60; a completed run
is not presented as a passed frame budget. Raw full-resolution artifacts remain
local and ignored by Git; the compact evidence belongs in the repository.

## Independent visibility plans

Camera, transparent objects, reflection, static shadows and dynamic shadows own
separate plans. Membership is compiled from the current scene's geometry,
classification, mover and batch causes. Each view retains its latest static
projection; moving the main camera cannot invalidate the light projection.
Render Frame matrices remain the model source. Static pose/geometry edits,
emission/opacity changes and publishing a previously static visual pose are
observed without depending solely on a scene structural revision. Candidate
storage is bounded to the current scene and exposed by
`inspect().preparation.visibilityPlan`; clip multiplication uses persistent
scratch memory. The planner still scans current object causes once per frame.

Capture a built baseline before editing the renderer, then build and capture
the changed renderer with the same controls:

```powershell
npm run build
$env:COMPARE_BACKENDS='engine'
$env:COMPARE_QUALITY='1'
$env:COMPARE_OUTPUT='artifacts/engine-compare/view-planning-before'
node tools/engine-compare/benchmark.mjs
# Apply the renderer change, build, then capture with identical controls.
npm run build
$env:COMPARE_OUTPUT='artifacts/engine-compare/view-planning-after'
node tools/engine-compare/benchmark.mjs
node tools/gpu-visibility/compare-view-plans.mjs --evidence docs/render-evidence/independent-visibility-plans.json --check-budget
```

The architecture gate requires one static light projection per fresh fixture,
`count + 1` static clip tests total, zero static clip tests on the last measured
frame, and one CPU static camera/reflection candidate. Cubes are owned by GPU
visibility; eight replay bodies retain their independent path. This is measured
from the production renderer, alongside scene/model/replay/pixel audits.

On 2026-10-11, Windows/AMD RDNA 3 at 1920×1080, three baseline repetitions and
two after-runs of three repetitions, 240 frames per case: moving-camera CPU p95
changed from 8.5 to 4.7–4.9 ms at 5,000 cubes and from 14.7 to 8.7–10.2 ms at
10,000. Mean RAF FPS stayed about 101 at 5,000 and changed from 79.0 to 85.1–86.6
at 10,000. All-pass draws stayed 36 and upload payloads stayed 3,868 bytes/frame
for the static camera or 5,745.7 bytes/frame on average with camera motion.
The static light plan built once across all 288 warmup/measured frames.

The first after-run differed from the baseline at one red channel, (1645,418),
5,000/camera-motion/r1, by 1/255. An unmodified rerun differed at twelve other
channels in two 10,000/camera-motion captures, also by 1/255. Source, compiled
build and measured harness fingerprints were identical between the two
after-runs. All three wet-surface final images and full linear HDR reflection
targets matched the baseline exactly in both runs and were personally viewed.
The internal GPU/capture source of the canonical variation is not isolated.
**Both strict canonical pixel gates remain failed.** The 10,000-cube frame p95
is 19.8–19.9 ms, so the stable 60 FPS gate also remains failed. No tolerance was
changed, and no successful CI run is implied by these local measurements.

Reports are saved even when canonical pixel checks fail; the comparator still
returns a nonzero exit code. This preserves the images, mismatch coordinates
and measurements for diagnosis. An unchanged repeat can retain the first run:

```powershell
$env:COMPARE_OUTPUT='artifacts/engine-compare/view-planning-after-repeat'
node tools/engine-compare/benchmark.mjs
node tools/gpu-visibility/compare-view-plans.mjs --after artifacts/engine-compare/view-planning-after-repeat --observed-after artifacts/engine-compare/view-planning-after --evidence docs/render-evidence/independent-visibility-plans.json --check-budget
```

`--observed-after` requires the same source/build/harness fingerprints, compares
all canonical captures across the unchanged runs and verifies full wet-scene
pixels. The local HTML gallery and machine-readable evidence are in
`artifacts/engine-compare/view-planning-comparison/`; the compact JSON records
both after-runs' metrics and failed pixel gates.

## Compiled presentation dependencies

`COMPARE_PROFILE` selects `native` (default, full native renderer pipelines) or
`common-post` (engine screen-space work, bloom, TAA and planar reflections off).
The latter matches the peers' absence of extra screen effects; BRDF, atmosphere,
IBL, light attenuation, shadow filtering and tone mapping still differ. Neither
profile establishes equal pixel quality between engines. `COMPARE_QUALITY='1'`
always captures the full default engine's separate wet scene, even when the
measured cube scene uses `common-post`.

The engine compiles effect dependencies at device creation. Main normal/specular
targets exist only for screen-space consumers and velocity only for TAA. Bloom
alone uses a composition shader; TAA and presentation bind the compiled input.
The profiler and `inspect().renderTargets` expose the work and actual resources.
The full default image path remains enabled unless a caller explicitly selects
features. All sixteen feature combinations have binding/lifetime unit checks;
native full and reduced profiles also ran on the actual Windows GPU.

```powershell
npm run build
$env:COMPARE_QUALITY='1'
$env:COMPARE_PROFILE='native'
$env:COMPARE_OUTPUT='artifacts/engine-compare/pipeline-native'
node tools/engine-compare/benchmark.mjs
$env:COMPARE_PROFILE='common-post'
$env:COMPARE_OUTPUT='artifacts/engine-compare/pipeline-common-post'
node tools/engine-compare/benchmark.mjs
node tools/gpu-visibility/compare-render-pipelines.mjs --before artifacts/engine-compare/current-native --native artifacts/engine-compare/pipeline-native --common artifacts/engine-compare/pipeline-common-post --output artifacts/engine-compare/pipeline-comparison --evidence docs/render-evidence/render-pipeline-plans.json --check-budget
```

`--previous-common` adds a same-profile before/after gate for removing raster
attachments. Every decoded RGBA8 channel must stay within the observed before
repeat range; no tolerance is introduced. `--contention <snapshot.json>` retains
an observed external GPU workload and puts its limitation above the report's
metrics. Successful execution does not imply passed quality/frame budgets or
exclusive GPU use.

On 2026-10-12 locally, omitting unused normal/specular/velocity targets saved
33,177,600 bytes at 1080p. All twelve reduced-profile PNGs matched their pre-change
captures exactly. Full wet-scene pixels/HDR matched the original baseline in
both new reports. The default canonical gate remains failed at nine channels
outside the baseline repeat range; full 10,000-cube frame p95 remains 20.0 ms.

The reduced-profile run failed after 24 cases because `document.documentElement`
was briefly null after navigation. The failed report remains at
`artifacts/engine-compare/pipeline-target-common/`. A separate recovery reused
those validated cases and ran the remaining twelve with an unchanged source,
dist and measured harness. It records original/recovery runner hashes, provenance
and original image locations. The recovery generator rejects other errors and
changed programs; it was applied before changing the harness. The primary
benchmark now guards both readiness polls against an absent document element.
The exact measured harness was archived before that fix and this documentation
update at `artifacts/engine-compare/pipeline-target-comparison/measured-harness/`.

During recovery, Windows GPU counters showed `llama-server` Compute utilization
96% on the same adapter as Chrome's 3D work. All three renderers slowed sharply.
Those timings cannot establish an optimization or competitive advantage. The
separate recovered execution is completed, but its frame gates fail and the
original failed execution remains failed. The combined evidence and gallery are
`docs/render-evidence/render-pipeline-targets.json` and
`artifacts/engine-compare/pipeline-target-comparison/report.html`.

## Canonical stage repeatability diagnostic

```powershell
node tools/gpu-visibility/diagnose-canonical.mjs
```

Six fresh-device captures per GPU/ordered CPU-batched visibility mode compare
every final HDR, normal, effects, TAA and presentation channel with zero
tolerance. The diagnostic uses queue waits and readbacks outside any performance
measurement; its warmup also waits per submission and omits GPU journal hooks.
`CANONICAL_COUNT`, `CANONICAL_REPETITIONS` (2–12) and `CANONICAL_OUTPUT` control it.
It preserves source/build/harness/diagnostic fingerprints and physical hashes.

At 5,000 cubes in the observed run, final HDR, normal and effects targets matched
within each mode. GPU captures varied at 6–34 float16 TAA channel words by one or
two encoded units; all ordered CPU captures matched at all checked stages.
Final RGBA8 images in this diagnostic matched in both modes. This final-only
capture did not isolate earlier-frame inputs or velocity and did not establish
a TAA shader defect. A stable
sample cannot eliminate intermittent variation. Evidence is retained in
`docs/render-evidence/canonical-stage-repeatability.json`; the older failed
canonical quality gates are unchanged.

The frame trace reads all 32 canonical HDR/current/velocity/depth/TAA frames:

```powershell
$env:CANONICAL_TRACE='1'
$env:CANONICAL_COUNT='10000'
$env:CANONICAL_REPETITIONS='3'
$env:CANONICAL_OUTPUT='artifacts/engine-compare/temporal-inputs'
node tools/gpu-visibility/diagnose-canonical.mjs
```

Read-only diagnostic compute packs the production velocity/depth after render,
without adding texture usage flags or feeding results back into the renderer.
SHA256 matches certify identical full buffers; differing references are
losslessly decompressed and every raw channel is compared with zero tolerance.
References occupy bounded host memory for one mode, not production VRAM.

At 5,000 cubes before the history change, all five stages matched across three
fresh-device repeats per mode (`docs/render-evidence/temporal-input-repeatability.json`).
At 10,000 afterward, GPU repetition 1 first differs in HDR/current color on
frame 31 (12 raw channels); repetition 2 first differs on frame 22 (nine raw
channels). Depth and velocity match. Later frames retain the color divergence
in TAA even after current inputs match again. All three ordered CPU-batched
repeats match all stages. Evidence is
`docs/render-evidence/temporal-input-repeatability-10000.json`. The first observed
divergence is upstream of TAA; GPU instance ordering/shading still needs isolation.

### Instance order and the earliest color divergence

`node tools/gpu-visibility/diagnose-canonical.mjs --instance-order` starts fresh
native devices with identical CPU frustum sets. Both branches add the same-size
queue write; one preserves ascending indices and the other applies a fixed-seed
shuffle. Read-only GPU storage observations verify the actual sequence and its
sorted set. Geometry, source instance records, reflection lists, camera and
physical replay stay unchanged. It compares every channel of all 32 frames,
including opaque color, final HDR, normals, specular, effects, velocity, depth
and TAA. These readbacks/waits are correctness observations, not timing results.

The initial four-run control varied in shuffled repetition 0 on frame 5, while
its second identical shuffled run matched the ascending reference. Moving
instance color/seed into flat vertex outputs did not resolve variation: that
diagnostic-only candidate varied in ascending repetition 1 on frame 31 and
shuffled repetition 1 on frame 29. It was not promoted to production. Evidence
is `docs/render-evidence/instance-order-control.json` and
`docs/render-evidence/instance-order-flat-candidate.json`.

The separate `--shadow-inputs` control additionally captured the initial static
shadow, every dynamic shadow, Frame uniform and light source/cell buffers. All
four observed runs matched (`docs/render-evidence/instance-order-shadow-inputs.json`).
Additional reads can affect GPU behavior; this sample does not erase earlier
failed gates or establish a shader/driver cause.

Adding opaque color produced another divergence among six fresh-device runs:
shuffled repetition 2 first differs on frame 26 at three pixels, nine color
channels. Opaque/HDR/effects differ together; normal, specular, depth and velocity
match throughout. TAA retains differences on frames 27–31 after current color
matches again. This localizes the first observed difference to opaque rendering,
before the HDR blit and TAA. Same-order repeats can vary, so these observations
do not establish deterministic dependence on instance order. Full evidence is
`docs/render-evidence/instance-order-opaque-input.json`; the exact measured tools
are archived in `artifacts/engine-compare/instance-order-opaque-input/measured-diagnostic/`.
The earlier control's `diagnostic-with-candidate/` is a later snapshot, not an
exact archive of its measured diagnostic.

`canonical-summary.mjs` checks all captured frames, stages, run coverage,
physical replay and hash/comparison consistency. It reports the first divergent
frame even when the final frame matches. The following commands retain the
report and return nonzero on a failed observed repeatability gate:

```powershell
node tools/gpu-visibility/canonical-summary.mjs artifacts/engine-compare/instance-order-opaque-input/report.json --check-repeatability
node tools/gpu-visibility/diagnose-canonical.mjs --instance-order --check-repeatability
```

The normal temporal trace also captures opaque color and supports
`--check-repeatability`. The Windows workflow runs that trace at 10,000 objects,
stores nested evidence on the host even if artifact upload is disabled, and
checks frame budget independently after a repeatability failure. Completing a
diagnostic is distinct from passing its quality gate. Local checks pass 281
tests, including early divergence, incomplete evidence and contradictory hashes.
The workflow changes have not yet been run on GitHub Actions.

The new normal-path local run at 10,000 cubes passed the observed gate: two
fresh-device runs each of GPU and CPU-batched visibility, all 32 frames and six
stages (opaque/HDR/current/velocity/depth/TAA) matching within each mode. The
runner exited zero with `--check-repeatability`. Evidence is
`docs/render-evidence/opaque-temporal-gate.json`; measured tools are in
`artifacts/engine-compare/opaque-temporal-gate/measured-diagnostic/` with verified
fingerprints. The saved divergent opaque control exits one under the same
summary gate. Production source/build fingerprints remain unchanged by these
diagnostic/CI changes. No rendering speedup or elimination of the intermittent
variation is established.

## Persistent model observations

The existing Render IR index supplies current models, replacing a second
per-frame map. `RenderModelHistory` retains one record per observed live source;
only an immediately preceding observation is a valid previous pose. Its source
identity also prevents same-ID replacements from inheriting another object's
velocity. Offscreen singles expire logically, removals are released on collect,
and scene swaps/reset clear observations. It owns no physical state.
`inspect().preparation.modelHistory` records entries, generations, allocations,
commits and changed model references.

Both local native reports contain actual Engine/Three/Babylon results: 36 cases
each, 240 measured plus 48 warmup frames, three repetitions at both sizes and
both camera routes. Baseline dist remained unchanged throughout its capture
and is archived at `artifacts/engine-compare/model-history-before/compiled-dist/`.
The changed source was rebuilt after all 277 checks passed. Measured harness
fingerprints match; its pre-documentation copy is in
`artifacts/engine-compare/model-history-comparison/measured-harness/engine-compare/`.

```powershell
node tools/gpu-visibility/compare-model-history.mjs --before artifacts/engine-compare/model-history-before --after artifacts/engine-compare/model-history-after --evidence docs/render-evidence/render-model-history.json --check-budget
Remove-Item Env:CANONICAL_TRACE -ErrorAction SilentlyContinue
$env:CANONICAL_COUNT='5000'
$env:CANONICAL_OUTPUT='artifacts/engine-compare/model-history-motion'
node tools/gpu-visibility/diagnose-canonical.mjs --model-history
```

The comparison checks actual history bounds/allocation counts, unchanged draws,
transfers/pipeline/targets, every canonical pixel against the observed before
repeat range, and every full wet RGBA8/finite reflection channel exactly. It
saves evidence/gallery even when gates fail and exits nonzero for those failures.
Each frozen after case allocated 5,009 or 10,009 history records over 288 frames.
At 10,000 cubes with camera motion CPU/GPU/frame p95 changed from 9.2/10.49/20.0
to 8.7/10.12/19.9 ms; 5,000 moving CPU p95 increased from 6.1 to 8.1 ms. The
sequential measurements establish no consistent speedup or GPU isolation.
Full wet buffers match exactly. One canonical capture has eight changed channels
outside the baseline range, with maximum RGB8 error 6; both pixel/frame gates
remain failed. Scene inputs/replay match peers, but native pixel quality differs.

The separate moving diagnostic reads real production instance storage and
single/body uniform bindings with read-only compute after render. Across both
visibility modes, 12,822,080 matrix values match independent pure Render IR and
last-observed poses; 15,999,040 uploaded instance values match CPU mirrors.
Each 40-frame run exercises eight physical movers, published/direct visual
motion, isolated transparent-single hide/reentry, same-ID replacement, removal,
history reset and scene swap. Physical hashes match across render and modes.
The complete evidence is `docs/render-evidence/render-model-history-motion.json`
and native captures are in `artifacts/engine-compare/model-history-motion-v3/`.
This correctness workload is not a performance or canonical repeatability gate.

## Rejected sunlight sampling candidate

A candidate guarded PCF/relief visibility with `nl > 0`: both direct sun lobes
multiply by that cosine, so a zero cosine has no sunlight contribution. Fresh
full native before/after captures contain 36 cases each and all three wet views,
with 240 measured/48 warmup frames and three rotated repetitions. Source, dist
and harness snapshots under each report's `measured-state/` match its recorded
fingerprints. The production edit passed all 281 local tests.

```powershell
node tools/gpu-visibility/compare-model-history.mjs --experiment sun-shadow --before artifacts/engine-compare/sun-shadow-before --after artifacts/engine-compare/sun-shadow-after --output artifacts/engine-compare/sun-shadow-comparison --check-budget
$env:CANONICAL_COUNT='10000'
$env:CANONICAL_OUTPUT='artifacts/engine-compare/sun-shadow-paired'
node tools/gpu-visibility/diagnose-canonical.mjs --shadow-demand
```

The ordinary full benchmark did not establish a consistent improvement. At
10,000 moving cubes, GPU p95 is 10.273 → 10.281 ms and interval p95 stays 20 ms.
Wet RGBA8 and finite HDR reflection buffers match exactly in all three views.
One canonical capture has 18 channels outside the six observed baseline
captures, with maximum RGB8 error one. Pixel and frame gates remain failed.
The candidate was not promoted; production src/dist were restored exactly to
the measured before fingerprints. Evidence/decision are in
`docs/render-evidence/sun-shadow-demand.json`; the gallery is
`artifacts/engine-compare/sun-shadow-comparison/report.html`.

The separate same-device diagnostic reconstructs both fragment variants and
uses shared explicit layouts/vertex stages. Every executed baseline pipeline is
counted; shader hashes and actual native pass timestamps are recorded. It runs
128 AB/BA pairs per camera route, alternates which variant runs first, keeps the
same camera/timeline within a pair, and waits after each submission. CPU profiling
and occlusion queries add overhead; compare within-pair differences, not those
absolute GPU durations with the ordinary benchmark. GPU timestamps have one
owner: the common journal. Its first two failed diagnostic reports remain in
`sun-shadow-paired/` and `sun-shadow-paired-v2/`; the completed version is
`artifacts/engine-compare/sun-shadow-paired-v3/` and
`docs/render-evidence/sun-shadow-paired.json`.

Mean opaque differences are -0.113 ms static and -0.146 ms moving; 101/128 pairs
improve on each route, with negative means for both first-variant orders. Final
opaque/HDR/TAA snapshots after independent history resets match. These local
savings do not override the failed full frame/pixel gates. A 16-pair integration
run also passes after restoring production, and verifies the same shader-pair
hashes; the diagnostic can test the candidate without editing production.

Instrumented CPU quanta identify a larger recurring cost: environment cause
checking averages 1.42–1.57 ms, preparation 1.26–1.33 ms, culling 0.95–0.99 ms
and projection 0.73–0.74 ms. The frozen environment keeps its cubemap, but its
19 numeric radiance causes are still scanned per static entity every frame.
Sharing the already observed Render IR transform changes with that check is a
next architectural target; direct numeric edits and independent pure projections
must retain their current behavior. No such production change is implemented
by this experiment.

## Render IR radiance dataflow candidate

The subsequent CPU candidate adds a lifecycle observer to the live Render IR
cache and feeds it to the distant-radiance cache. Static full-precision poses are
checked by Render IR once; immutable current-model identities certify unchanged
inputs for radiance. Materials still have direct numeric observations. Pure,
custom and dormant consumers scan authoritative Scene values. Hashing/probe
generation still use Scene values, with no GPU model as a second world state.
An observation is consumed once, shared commits supersede a pending key, and
aborted builds leave the cause cache dirty for recovery. 287 tests pass.

`artifacts/engine-compare/radiance-projection-after/measured-workspace/`
freezes the candidate source/dist and the exact archived `sun-shadow-before`
runner/harness. The existing complete native baseline is reused; its harness
SHA256 matches the actual candidate report. Vendor dependencies are a Windows
junction to the existing pinned installation. The measured mirror also contains
fixture source and texture assets. The current README is not substituted into
that frozen measurement. The comparison is reproducible with:

```powershell
node tools/gpu-visibility/compare-model-history.mjs --experiment radiance-projection --before artifacts/engine-compare/sun-shadow-before --after artifacts/engine-compare/radiance-projection-after --output artifacts/engine-compare/radiance-projection-comparison --evidence docs/render-evidence/render-radiance-projection.json --check-budget
```

Actual 288-frame inspections observe 5,001/10,001 initial static pose checks and
reuse their certificates for the remaining 287 frames. Draws, requested uploads,
pipeline targets, physical/geometry/environment hashes and all 23 WebGPU source
template literals are preserved. CPU p95 changes are mixed in the sequential
full benchmark; moving 10k decreases 8.5 → 7.7 ms, while static 10k increases
7.9 → 9.2 ms. Frame p95 remains about 20 ms. Strict canonical and wet gates fail
and the checker exits 1: 30 canonical channels are outside the observed baseline
range, and wet-back differs at 61 presentation channels in an 8×6-pixel region
(maximum RGB8 error 8). All finite HDR reflections match exactly.

The independent same-device traversal diagnostic runs both current numeric
detectors with/without the fused observer, alternating AB/BA order:

```powershell
$env:CANONICAL_OUTPUT='artifacts/engine-compare/radiance-projection-paired'
$env:CANONICAL_COUNT='10000'
$env:CANONICAL_PAIRS='128'
node tools/gpu-visibility/diagnose-canonical.mjs --radiance-projection
```

Two untimed settling frames restore each variant's steady-state certificates
before a sample. On both static/moving routes, combined projection+environment
mean saves 0.572/0.652 ms, p95 changes 2.5 → 1.8/1.9 ms, and 120/123 of 128 pairs
improve. Negative means occur with either first-variant order. This has profiler
overhead and queue waits; it is neither a historical-detector comparison nor
display FPS. Final opaque/HDR/TAA snapshots match, with original physical state.
Exact measured tool archives are retained under each diagnostic report.

`radiance-projection-temporal/` observes all 32 frames of opaque/HDR/current/
velocity/depth/TAA for two fresh GPU and CPU-culling repetitions; all comparisons
pass. `radiance-projection-wet-control/` has three fresh baseline and candidate
captures. One old-code run differs by 37/2 wet-front/back channels (maximum error
3/1); all three new candidate captures match the original wet images and all
HDR reflections match. Eight preparatory cube frames in these wet controls are
setup, not a timing sample. Original failed gates remain failed, and intermittent
presentation variability remains unresolved. The implementation is a local
candidate; a release and equal-quality competitive advantage are not established.

After those full measurements, a narrow lifecycle repair makes shared Scene
commits supersede a pending custom/dormant fallback key as well as a live key.
The live fused path is unchanged. A regression assertion and the full 287 tests
pass again. `radiance-projection-final-integration/` records 16 fresh native pairs
per route with the final source/dist: both paths execute, physics and final
opaque/HDR/TAA remain exact. Its complete measured source/dist/tool archive
matches the recorded fingerprints. This integration check is distinct from the
earlier 128-pair performance sample and 36-case benchmark; their original source
fingerprints and failed full quality/frame gates are retained.

## Shadow coverage and receiver-plane correction

The actual material shader added four static PCF comparison samples and two
dynamic samples, then used `min(staticSum,dynamicSum)*0.5`. A clear dynamic map
therefore saturated static half coverage to full visibility. Shared WGSL sample
counts now normalize each map independently before the existing `min`.
The inactive dynamic map uses its sample count as a fully visible sum.

Normalization alone exposed self-shadow stripes in the sunlight highlight on
the wet-road fixture. The retained candidate corrects tap comparison depth
using the geometric receiver-plane gradient in light texture coordinates.
Derivatives precede bounds returns; singular projections return a neutral
finite gradient. Original offsets, static/dynamic map sizes, normal/constant/
caster biases, samplers, material features and physical state are retained.

```powershell
$env:CANONICAL_OUTPUT='artifacts/engine-compare/shadow-filter-plane-contract'
node tools/gpu-visibility/diagnose-canonical.mjs --shadow-filter
```

The completed native AMD RDNA3/Chrome 154 report evaluates 4,177 independent
coverage references with zero tolerance and 225 authored affine receiver planes
with declared absolute float32 tolerance 1e-6. Their measured maximum errors are
zero; the old unequal-kernel arithmetic fails 2,089 coverage cases. All three
actual ordinary/relief/instanced modules must contain the helper, count-driven
loops, dynamic-disabled sum and both corrected comparison depths. Production
source/dist and diagnostic tools are archived and verified against every recorded
tree fingerprint in `shadow-filter-plane-contract/measured-state/`.

The complete corrected benchmark is `shadow-filter-plane-after/`, with 36 cases
at 1920×1080, 240 measured/48 warmup frames, three repetitions, native pipelines
and three wet views. Its `measured-workspace/` source/dist and exact archived
runner/harness are verified. The complete `radiance-projection-after` baseline
is reused with an identical measured harness SHA256. The narrow CPU fallback-key
repair also separates source snapshots but is inactive on this built-in live
route; a sequential comparison does not isolate GPU load or clock variation.

```powershell
node tools/gpu-visibility/compare-model-history.mjs --experiment shadow-filter --numeric artifacts/engine-compare/shadow-filter-plane-contract/report.json --before artifacts/engine-compare/radiance-projection-after --after artifacts/engine-compare/shadow-filter-plane-after --output artifacts/engine-compare/shadow-filter-plane-comparison --evidence docs/render-evidence/shadow-filter-plane-comparison.json --check-budget
```

The comparison correctly exits 1. Across 12 Engine captures, 7,137,745 channels
are outside the observed old-code envelope; shadow arithmetic intentionally
changes those pixels. Wet front/back/low differ by 47,959/28,440/27,689 RGBA8
channels, while every finite HDR reflection channel remains exact. No original
pixel/frame gate is waived. Engine 10k static/moving GPU p95 is 10.356/10.120 ms;
frame interval p95 remains 20.0/19.9 ms versus about 10.1 ms for the peers'
different native pipelines. This establishes a correctness change without a
competitive speed or equal-quality claim.

`docs/render-evidence/shadow-filter-plane-quality.json` records direct visual
inspection of original full-resolution images: intermediate stripes disappear
in the inspected corrected wet-front highlight; back/low retain geometry,
reflections, emission, vertex colors, labels and transparency. The full corrected
wet capture repeats the preliminary corrected capture byte exactly in all
presentation/HDR views. The actual full 10k Engine/Three/Babylon images were
also viewed; sky/fog, lighting, contrast and edge smoothing visibly differ.
Eight preliminary cube frames with one warmup are fixture setup, not timing
evidence. 287 repository checks pass.

`shadow-filter-plane-temporal/` records two fresh GPU and CPU-batched repetitions,
all 32 frames and six production stages, with exact measured source/dist/tool
archives. It exits 1: GPU repetition 1 first differs at frame 16 in 12 opaque
RGB channels (four pixels); HDR/current inherit that difference and TAA retains
151 changed channels over frames 16–26. Depth/velocity and both observed CPU
repetitions match exactly. This sample localizes divergence to opaque shading
but does not prove its cause or remove earlier intermittent failures.

The continuous-shadow rotation prototype is separately retained as a rejected
diagnostic in `docs/render-evidence/continuous-shadow-order.json`: six fresh
ascending/shuffled captures still differ, sometimes in specular or velocity.
It was not adopted. CI adds the native numeric shadow check and preserves the
existing repeatability/frame gates; this workflow was not executed on GitHub,
and optional artifact uploads do not prove the storage quota has been freed.

## Live moss demand candidate

The following production candidate guards only concrete's moss color block with
`u.surface.x != 0.0`. When moss is zero, three FBM evaluations (nine explicit
volume-noise samples) contribute no color and can be skipped. Base concrete,
sidewalk seams and every nonzero moss expression remain unchanged. The live
uniform keeps future growth active without creating a static material variant.

```powershell
$env:CANONICAL_OUTPUT='artifacts/engine-compare/moss-demand-integration'
$env:CANONICAL_COUNT='10000'
$env:CANONICAL_PAIRS='16'
node tools/gpu-visibility/diagnose-canonical.mjs --moss-demand
```

`moss-demand-prototype-v4/` measures 128 same-device AB/BA pairs per static/moving
route, with a shared camera and timeline inside each pair. Only the guard differs
between paired production material shaders. Mean opaque GPU time saves
0.340944/0.324442 ms, with 117/128 pairs improving on each route and negative
means under both first-variant orders. Profiler/occlusion instrumentation and
queue waits distinguish this measurement from native frame intervals or display
FPS. The 16-pair integration uses actual changed source/dist and identical three
before/after shader-pair hashes; its sample is integration evidence, not a second
128-pair timing estimate. Both reports have exact source/dist/tool archives.

The diagnostic publishes immutable authored zero/0.65/zero moss material values
with an appearance revision. The actual opaque hash changes for growth, restores
for zero and matches both shader variants. No pipelines are rebuilt. All opaque
and HDR channels match for all three states. Paired final TAA remains different:
prototype growth/restored have 20/25 changed channels, while integration zero/
growth has 48/5. Reports retain `finalCanonicalStages:false` and the runner exits
1. Failed initial diagnostics are retained separately: the first attempted to
write a frozen surface, the second did not confirm the live transition, and v3
completed but exposed the missing appearance cause (`liveGrowthObserved:false`).
Their failed gates are not timing or correctness successes.

`moss-demand-after/measured-workspace/` freezes the changed source/dist and the
exact completed `shadow-filter-plane-after` native harness/assets. Its actual
36-case report has the same source/geometry/environment/physics inputs, targets,
draws and requested uploads. Complete archive fingerprints are verified.

```powershell
node tools/gpu-visibility/compare-model-history.mjs --experiment moss-demand --paired artifacts/engine-compare/moss-demand-prototype-v4/report.json --integration artifacts/engine-compare/moss-demand-integration/report.json --before artifacts/engine-compare/shadow-filter-plane-after --after artifacts/engine-compare/moss-demand-after --output artifacts/engine-compare/moss-demand-comparison --evidence docs/render-evidence/moss-demand-comparison.json --check-budget
```

This comparison exits 1 for the retained paired TAA and full frame-budget
failures. Canonical pixels do pass their original observed-baseline-envelope
test: three paired captures change 6/15/4 channels within the original 6/19-channel
before variability, with zero channels outside that range and no added tolerance.
All wet RGBA8 and finite HDR reflection channels match exactly. Personal visual
review of front/back/low wet views and zero/positive-moss prototype images is
recorded in `docs/render-evidence/moss-demand-quality.json`.

10k static/moving GPU p95 changes 10.356/10.120 → 10.125/10.002 ms, while frame
interval p95 remains 19.9/19.8 ms. Mean static headless FPS decreases 84.33 →
82.63 and moving changes 86.50 → 87.64. Sequential CPU/clock/load variation was
not isolated; this establishes a narrow opaque-cost reduction, not consistent
full-frame or competitive speed. The three native pipelines still differ in
shading/effects. All 287 repository checks pass.

`moss-demand-temporal/` freshly observes all 32 frames and six stages in two GPU
and CPU-batched repetitions; this sample matches exactly, with original physical
state and verified source/dist/tool archives. It does not erase the earlier
paired TAA or old-source intermittent failures. CI adds a native 16-pair live
material check, while the original strict repeatability/frame gates and local
evidence retention remain. No successful GitHub workflow or freed storage quota
is implied by these local results.
