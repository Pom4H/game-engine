# Render recording in the existing Ё console

Open `/docs/`, press **Ё / Backquote**, select **Запись**, press **● Запись**,
reproduce the problem and press **■ Стоп**. Click the CPU timeline, use the slider
or arrow buttons, zoom with +/−, or play the saved filmstrip. Viewing the recording
never calls `seek`, rebuilds geometry or steps physics. Pause the live world separately.

Shell: `record start`, `record stop`, `record clear`, `record export`, `record trace`
and `inspect recording`. Authored parameter changes still use the original source
bindings and shared Undo. The desktop layout keeps timeline, saved image and frame
metadata visible together; the command log is compact while reviewing a recording.

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
profiler. For native Chrome main/worker stacks, GC and trace capture, use the existing
harness collector documented in **chrome-profiling.md**. It is preserved, not wired
to the in-page record button. Full physics/audio/network instrumentation, GPU resource
lifetimes, exact compositor presentation times and restorable world checkpoints are
not supplied by this patch.

## Verification

**Final compact UI:** permanent DSL workflow run **36346447089**, source
**ffd6f758453144ae6619069be9700fa43b65145c**. The project Bun/lockfile toolchain
installed successfully; typecheck, build, focused DSL/console/recording tests and
site build passed. Actual Windows self-hosted **HeadlessChrome153 / WebGPU** passed
**44 browser checks**, including filmstrip recording, frame-keyed CPU/GPU joins,
scrub/zoom without changing the live tick, source roundtrips/Undo, worker recovery,
existing scenes and mobile controls. The renderer reported timestamp queries and no
errors; adapter identity was unavailable. This is functional acceptance, not a
frame-rate or capture-overhead benchmark.

The same run's full suite is **167 pass / 3 fail**: two clearcoat expectations and
one M3 geometry expectation. These also failed in an independently tested baseline
(151 pass / same 3 failures before recording and the concurrent native trace tests).
Tests were not weakened: the overall workflow correctly remains red on regressions.

Artifact **10940781873**, `dsl-playground-evidence`, contains the final
`engine-profiler.png`, `browser-report.json`, `regressions.log`, `commit.txt`, exact
source archive and other real editor screenshots. The built site is artifact
**10941016571**, `dsl-playground-site`.

Earlier dedicated run **36346118905** additionally passed **55 focused tests**
including native Chrome collector tests on isolated TS5.8.3 / Node22, and passed
native WebGPU acceptance before the layout refinement. A separate nine-assertion
production-UI DOM fixture is only a component test, not evidence of an engine render.

The temporary delivery workflow and payload were removed after integration.
Recording checks now live in the existing DSL workflow. main is untouched.
