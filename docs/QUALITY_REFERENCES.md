# Reality-quality gates

Goal: high-fidelity imagery, physically credible behavior, and real sound **per unit of compute**, without faking physics or lowering resolution to pass FPS.

## Three evidence levels

1. **Sanity** — non-black/non-flat 1080p PNGs, non-silent/non-clipped WAVs, real GPU counters. Sanity **does not measure photorealism**.
2. **Regression** — bit-identical physical replay, independent conservation/energy/cause tests, audio replay, locally computed 8×8 SSIM and absolute image luminance error against *manually approved and SHA-256-pinned* frames.
3. **Reality** — calibrated photographs/lighting, measured impulse responses, physical experiments. The scene, camera, illumination, time, units, acoustic room and source/listener placement must match. An unrelated attractive photograph, subjective AI score or current engine output is not ground truth.

## High-quality independent reference catalog

The machine-readable registry is [quality/references.json](../quality/references.json).

**Visual:** [Stanford-ORB](https://github.com/StanfordORB/Stanford-ORB) supplies real HDR object photographs, cameras, aligned HDR environment maps, masks and geometry. [Poly Haven](https://polyhaven.com/hdris) supplies CC0 HDRI lighting inputs. [Khronos ClearCoatCarPaint](https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/ClearCoatCarPaint) exercises clear-coated automotive materials against the material spec and a reference renderer. Model licenses must be checked individually. [MERL BRDF](https://cdfg.mit.edu/wojciech/brdfdatabase/) provides measured angular reflectance of 100 materials (research/academic-use restrictions: do not bundle commercially without permission). [MPI Sintel](https://sintel.is.tue.mpg.de/downloads) provides ground-truth motion and image sequences for TAA/reprojection tests (synthetic and NOT proof of photographic realism).

**Sound:** [Aachen AIR](https://www.iks.rwth-aachen.de/en/research/tools-downloads/databases/aachen-impulse-response-database) includes real measured binaural room impulse responses (license shipped with database). [BUT ReverbDB](https://speech.fit.vut.cz/software/but-speech-fit-reverb-database) includes real room responses and noise with CC BY 4.0 attribution. Compare time-aligned direct delays, band response, RT60/EDT and reverberant/direct ratio in the corresponding room — **not** raw PCM from unrelated spaces.

**Physics:** [our proving ground](PHYSICS_ENERGY_ACCOUNTING.md) already uses independent conservation, force balance and numerical discretization oracles, along with causal traces. Replay hashes catch regressions but cannot prove the governing physical law is realistic. [NLR NACA 0012 experiments](https://data.nlr.gov/submissions/311) offer measured lift/drag polars to validate wing behavior under matched flow conditions. Real tyre, deformation and water-tank experiments should also be added with calibrated dimensions, uncertainties and equipment conditions. Passing the analytic physics gate is **INCOMPLETE for physical realism** until measured reference comparisons are implemented.

Catalog entries are **discovery**, not imported data: the full Stanford-ORB corpus can be tens of gigabytes. CI must use a small explicitly selected/pinned subset, retain license/attribution and never quietly download or replace the ground truth.

## Approving an actual baseline

1. Freeze and record scene seed, geometry, physical state, camera and exposure, light environment, resolution, renderer version and hardware.
2. Capture a reference from independent offline path tracing or an aligned real-world photograph. Verify it visually, including transparency, shadows, reflections, object silhouette and contact.
3. Save the **approved** PNG under `quality/baselines/`, compute `SHA-256`, and set the corresponding view's `baseline: {"file":"quality/baselines/...png","sha256":"..."}` in [quality/profiles.json](../quality/profiles.json). Never update the reference automatically from a failing CI run.
4. Subsequent CI asserts immutable reference SHA, 8×8 local SSIM, mean luminance error, no blank frame, and real 1080p. Use masks or aligned HDR metrics for photometric comparisons as cases mature.

The first four M3 views intentionally have `baseline: null`: no frame has yet been independently approved. Report status is **INCOMPLETE** for image realism. This is NOT a claim of AAA visual quality. A manually dispatched workflow with `strict_references=true` intentionally **fails** until calibrated image and acoustic references exist. The normal workflow still blocks objective physics/audio/performance/structural failures and reports missing external proof clearly.

## Profiling against a hardware performance profile

`quality/profiles.json` names budgets. The Windows self-hosted and hosted Apple Silicon WebGPU runners collect 90 continuous 1920×1080 frames, 60Hz simulation, CPU submission timing, frame pacing, actual GPU timestamp queries, GPU pass hot spots, per-system simulation hot spots, draw calls and CPU→GPU upload bytes. No software adapter counts as hardware, missing GPU timestamps **fail**, and reduced resolution is not an optimization.

The Linux runner checks rigid-body replay SHA, 5ms median/tick on explicit fixtures, proving-ground experiments, energy/cause presence, synthesised WAV signal health, physical attenuation through open/closed doors and acoustic evolution during garage entry. A real AIR/BUT room-matched acoustic benchmark remains **INCOMPLETE** until pinned.

Run after `bun run build`:

```sh
node --test test/quality-gates.test.mjs
node tools/fps/physics-benchmark.mjs
node tools/proving-ground/physics-exam.mjs
node tools/acoustic-demo.mjs
node tools/car-garage-audio-demo.mjs
node tools/quality/gate.mjs cpu

# Windows GPU runner, after tools/render-harness.mjs 1920 1080:
node tools/quality/gate.mjs gpu --profile=windows-hardware-1080p

# Fail a release without promoted references:
node tools/quality/gate.mjs gpu --profile=windows-hardware-1080p --strict-references
```

Machine-readable evidence in `artifacts/quality/{cpu,gpu}-report.json`, alongside PNG/WAV and the existing `artifacts/fps/` profiler traces. The workflow uploads diagnostics even when gates fail. Thresholds must be tuned only with **measured hardware variance and perceptual/physical validation**, never by hiding objects, reducing resolution or silencing audio.
