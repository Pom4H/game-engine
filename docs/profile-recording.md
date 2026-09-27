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

Local baseline source da4a0878452b76ee74748c415a4a484a53ae44bf was independently
built/tested with Node 22.16.0 / TypeScript 5.8.3. The project declares TS ^7.0.2;
local results do not verify that declared toolchain.

Typecheck, engine build and portable site build pass. Focused recording/console/DSL
tests: 47 pass / 0 fail. Full baseline: 151 pass / 3 fail. Modified tree: 159 pass /
3 fail, with the same two clearcoat and one M3 geometry expectation. No assertions
were weakened. The parallel native Chrome collector was added after this baseline.

Chromium production recorder UI with a synthetic 2D DOM fixture passes nine assertions
(capture, frame correlation, scrub, saved/live separation, export, mobile bounds).
This is NOT an engine render or WebGPU acceptance. Local editor navigation is blocked
by environment policy; real WebGPU assertions are added to tools/docs/qa.mjs and the
existing DSL workflow. Do not claim their success without an actual run.

The one-time branch-local integration workflow verifies exact input/output hashes,
runs focused checks and deletes its own script/payload after applying the patch. It
is a delivery mechanism, not a permanent CI source-code generator. main is untouched.
