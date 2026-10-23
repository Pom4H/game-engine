# Frame-rate performance contract

**Target:** 60 FPS at 1920×1080 on the named GPU, without changing the
physics state, causal ownership, shaders, camera, or visible quality. A complete
60 Hz displayed frame has ~16.667 ms; CPU simulation, CPU render submission,
GPU work and frame pacing must be measured **separately** because they can
overlap and cannot simply be added as an FPS estimate.

## Measurements

| Gate | Evidence | Criterion |
| --- | --- | --- |
| CPU physics | `FPS budget - physics` on self-hosted Windows RDNA3 | 5 ms median per 60 Hz tick for specified fixtures, strict SHA-256 physical replay |
| Rendering | `FPS budget - hardware WebGPU` on self-hosted Windows RDNA3 | 1920×1080 real Chrome WebGPU; frame interval and render CPU p50/p95/p99, per-pass GPU timestamp p50/p95 |
| Physics integrity | `test/contact-laws.test.mjs`, proving-ground and golden replay | Same cause graph, body positions, impulses, contacts, and physical state |
| Visual fidelity | Existing Render, Proving Ground and promoted scenes | No silent lower resolution, shader changes, removed physics or hidden objects to inflate FPS |

Render-profile sampling is opt-in via `RENDER_PROFILING=1`, and the normal
gameplay path is unchanged. GPU timestamp queries are only reported when
supported. A null GPU sample is **missing evidence**, never a passed gate.
The full frame-pacing benchmark intentionally renders 90 consecutive
requestAnimationFrame callbacks, advancing a 60 Hz simulation tick before each
render. It's a target-device smoke test, **not** a proof for all scenes/devices.

Use:

```sh
bun run build
node tools/fps/physics-benchmark.mjs
RENDER_PROFILING=1 RENDER_REQUIRE_HARDWARE=1 RENDER_FPS_BENCH_FRAMES=90 \
  RENDER_WARMUP_FRAMES=12 node tools/render-harness.mjs \
  tools/promo/clear-day.scene.mjs tools/promo/render-views.mjs 1920 1080
```

CI emits `artifacts/fps/physics-budget.json` and
`artifacts/fps/gpu-budget.json`. The renderer also returns a bounded,
inspectable `cpuStagingBytes` value. Compare p95 **on the same hardware**
and check render shader/visual regressions. Inspect physics causal traces and
per-system CPU sampling separately through the World `performance` directive;
a measured speedup must preserve physics replay hashes.

## Measurements observed before additional GPU optimisation

Hosted Linux CPU 60 Hz physics-only fixtures (October 10, 2026):

| Workload | Baseline ms/tick | Fast ground-path ms/tick |
| --- | ---: | ---: |
| 128 airborne dynamic boxes | 3.6201 | 1.8239 |
| 96 near-ground dynamic boxes | 2.3988 | 1.2919 |
| 512 static + 32 dynamic boxes | 2.8903 | 1.3131 |

Different CI runs can vary due to contention, CPU clock and JIT. These are
not total frame times. Golden replay hashes match for all 90 ticks. The
attempted bulk spatial-hash rebuild was **reverted** after an interleaved
A/B test showed 0.354 versus 0.319 ms for 544 entities (slower than the
original algorithm). Prefer evidence over intuition.

Previous separate Proving Ground 1600×900 14-frame profile: CPU render p95
11.8 ms, GPU timestamp p95 7.12 ms, 632 draw calls. These do **not**
measure actual game FPS or the 1920×1080 target, and do not include the
latest per-object buffer reuse. Future conclusions must use the GPU gate.

## CI runner policy

All new performance benchmarks, GPU rendering, FPS comparisons and quality
checks in these workflows use the project's Windows x64 **self-hosted GPU
runner**. No Apple Silicon or GitHub-hosted macOS job is scheduled. The
material/GI experiment uses PowerShell, fixed 1920×1080 resolution and a
sequential same-device baseline/optimized comparison. The historical Linux
and Apple measurements listed in earlier experiment reports are not current
performance baselines. Do not compare FPS across dissimilar machines.

## Dry-rut/shader-noise zero-work fast path

Asphalt grain is already antialias-gated. A complementary material shader
shortcut uses `rutGain=smoothstep(.035,.22,phaseWet)`. If this authoritative
water/slush response is exactly zero, historical wet tyre tracks cannot appear
and no lane-warp noise texel needs sampling. A zero shoulder-band or snow slush
similarly guarantees that slurry-ridge noise and its normal bump have zero
contribution. All nonzero paths continue to use the existing shader equations
and material/physics state. `test/shader-zero-contribution.test.mjs` exercises
zero/nonzero algebra and proves noise is not read for zero contributions.

The native Windows GPU A/B workflow compares full 1080p PNGs on four identical
camera angles against archived source commits. GPU timing samples are required
for a valid performance result; clean images alone cannot claim a speedup.
Each commit updates only the implementation, not any scene LOD or weather.

## Four-run A-B-B-A dry-road GPU crossover

The native Windows self-hosted GPU job uses fixed 1920×1080 hardware
Chrome, with 90 frames per run, in order: baseline, candidate, candidate,
baseline. Baseline is a pinned shader commit with the same material/GI
implementation before the dry-asphalt-noise shortcut. All four runs
require actual WebGPU timestamp-query frames; four same-camera PNG images
must pass SSIM and luma error checks. Paired A/B measurements avoid
interpreting GPU heating/JIT/order drift as a performance improvement.
Neither a passing A/B workflow nor a temporary >60 FPS median proves a
stable p95 budget below 16.667 ms.

## GPU runner scheduling for iterative shader experiments

One self-hosted Windows GPU must not queue a 120-minute cinematic capture on
every fragment-shader change. The continuous `Render`, `FPS budget`,
`Reality quality gates` and `GPU shader crossover` workflows remain
responsible for renderer code, physical replay, full-resolution performance
and four-camera fidelity. Full `Winter Promo`, `Castle Jelly`, and
`Snowy Arcade` video/release workflows continue to trigger from their
**scene-specific source/test changes** or explicit `workflow_dispatch`.
This avoids re-recording lengthy videos solely because a shader
performance optimization was changed, while retaining GPU validation for
shader modifications. Historical pending runs created before this policy
are not silently reported as passing.
