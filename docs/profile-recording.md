# Render recording in the existing Ё console

Open `/docs/`, press **Ё / Backquote**, select **Запись**, press **● Запись**,
reproduce the problem and press **■ Стоп**. Click the CPU timeline, use the slider
or arrow buttons, zoom with +/−, or play the saved filmstrip. Viewing the recording
never calls `seek`, rebuilds geometry or steps physics. Pause the live world separately.

The existing shell supports `record start`, `record stop`, `record clear`,
`record export`, `record trace` and `inspect recording`. Writes to authored scene
parameters still use the same original source-binding/Undo path.

## Evidence and limits

The optional RenderProfiler subscription delivers measured renderer CPU intervals
and asynchronous GPU durations joined by generation + frame. It reuses existing
measurements; no second mathematical model, scheduler or runtime dependency is added.
GPU clocks are not calibrated to CPU time: missing GPU samples remain missing,
and GPU durations are counters rather than fabricated timeline execution spans.

Only scalar metadata is copied: applied source revision, presentation/local tick,
time and entity/body/contact counts. `network-presentation` explicitly does not
represent an authoritative server tick.

Images are copied from the submitted WebGPU canvas, not re-rendered. JPEG sampling
is up to 10 FPS at at most 640×360, with one encoding in flight. If a selected frame
has no image, the viewer labels the nearest earlier image with its actual frame and
age; future images are never substituted. This is a filmstrip, not lossless video.

The session stops at 1800 CPU frames or 30 seconds of incoming samples. Images are
capped at 300 and a conservative 16 MiB UTF-16/base64 payload estimate, NOT total
browser heap, decoded image or GPU memory. Canvas copying/readback has non-zero
cost; imageCopyCpuMs measures the synchronous copy, not all asynchronous encoding.
Uncheck images to measure without capture. No per-frame GPU wait is added; stopping
drains outstanding GPU work asynchronously before unsubscribing. All exports are
local downloads; nothing is uploaded automatically.

The JSON export contains images and metadata. The Chrome trace export contains
measured CPU intervals, screenshot events and unaligned GPU counters; actual Chrome
DevTools import acceptance is not yet verified. There is no recording import UI.

This tab is a compact view of existing engine measurements, NOT a JS VM sampling
profiler. For actual Chrome main/worker stacks, GC and native tracing, use the
existing harness collector documented in **chrome-profiling.md**. It is preserved.
Full physics/audio/network instrumentation, GPU resource lifetimes, exact compositor
presentation times and restorable world checkpoints are not supplied by this patch.

## Verification

Local baseline da4a0878452b76ee74748c415a4a484a53ae44bf was independently tested
with Node 22.16.0 / TypeScript 5.8.3: 151 pass / 3 fail. Modified tree: 159 pass /
3 fail, with the same two clearcoat and one M3 geometry expectation. No assertions
were weakened. The native Chrome collector was added after this baseline.

GitHub Actions run **36346118905** integrated commit
**d33813657901635bc1927f9f08f8a72cce99b0be**. Linux typecheck, build and focused
DSL/console/recording/native trace tests passed: **55 pass / 0 fail**. The Windows
self-hosted job also built and ran the real editor in **HeadlessChrome 153 / WebGPU**:
**44 browser assertions passed**, including actual canvas filmstrip, frame-keyed
CPU/GPU joins, scrub/zoom/frame steps without changing the live scene tick, source
binding roundtrip, Undo, worker recovery and mobile controls. The report records
`timestampQueries:true` and no renderer errors; hardware adapter identity was not
reported. This is functional acceptance, not a frame-rate or capture-overhead benchmark.

Artifacts: `recording-webgpu-evidence` (**10940896463**) contains
`engine-profiler.png`, `browser-report.json` and other native editor screenshots.
`recording-integration-evidence` contains the exact source archive and test output.
The verified CI used isolated TypeScript 5.8.3 / Node 22; it does NOT verify the
project-declared TypeScript ^7.0.2 / Bun toolchain. Subsequent CSS layout refinement
is covered by a separate nine-assertion production-UI DOM fixture; that fixture is
not itself a WebGPU engine render. The existing DSL pipeline reruns native acceptance.

The temporary delivery workflow and payload were removed after integration.
Recording checks now live in the existing DSL workflow. main is untouched.
