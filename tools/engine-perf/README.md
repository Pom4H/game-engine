# Engine tracing, technology audit and budgets

Build with `npm run build`. All output goes under ignored `artifacts/engine-perf/`.
The tools add no dependencies and leave simulation laws, renderer features and game settings unchanged.

```powershell
npm run perf:audit -- --profile tools/engine-perf/budget.example.json
npm run perf:record -- --ticks 600 --bodies 64
npm run perf:overhead
npm run perf:report -- --file artifacts/engine-perf/record/capture.json
npm run perf:compare -- --before baseline/capture.json --after candidate/capture.json
```

`audit` writes a revisioned inventory, source fingerprint, repository revision,
implementation/verification paths and resolved budgets. An implementation being
listed does not imply that it is selected, available on the current device, or
faster. `record` exercises a dynamic CPU Scene; it does not measure game FPS.
`bench` compares uninstrumented, stopped-recorder and recording runs, alternates
their order, and requires the same physical replay fingerprint. Small timing
differences can be noise. The default registry includes both physics solvers;
only executed and instrumented work produces measurements.

## Budgets

Copy `budget.example.json` to a task-specific file and pass `--profile FILE`.
Set FPS, simulation/physics frequencies, resolution, device, p95 or another
percentile, minimum samples, time fractions, and absolute metric limits. Fractions
reserve independent time budgets; CPU and GPU overlap, so these limits are not
added together. Defaults are proposed targets, not hardware capability claims.

Each metric is `within`, `exceeded`, `missing` or `insufficient`. A report fails
when a required metric lacks enough samples, a sufficiently sampled metric
exceeds its budget, capture data was overwritten, observed resolution differs
from the target, quality settings changed, or the page was hidden. Optional
metrics remain visibly missing. Report/compare commands return nonzero on
failure. A passing time budget does not prove visual fidelity or physical accuracy.
The existing GPU/physics correctness fixtures remain necessary.

## Runtime capture

```ts
import {BrowserRuntime, EngineTrace, exportChromeTrace, traceReport} from '@rom4/game-engine/browser';

const trace = new EngineTrace({
  source: 'client', capacity: 65536,
  budgets: {fps: 60, tickHz: 60, physicsHz: 120, width: 1920, height: 1080},
  triggerMs: 50, postTriggerFrames: 30,
});
const runtime = await BrowserRuntime.create(canvas, spec, {profiling: true, trace});
// After the workload: persist these outside the frame loop.
const capture = runtime.stopTrace()!;
const timeline = exportChromeTrace([capture]);
const report = traceReport(capture);
```

The exposed `__GAME_ENGINE__` bridge supports `startTrace(options)`,
`traceCapture()` and `stopTrace()`. A stopped recorder performs no clock reads.
Set `profiling: true` at renderer creation for GPU timestamps: a device feature
cannot be enabled after its creation. Unsupported GPU timestamps stay missing.

For an existing Scene, set `scene.trace = trace`. For a standalone compound solver,
set `solidWorld.trace = trace`. For a standalone renderer, call
`renderer.setTrace(trace)`. Kernel programs accept `{trace}` in run options;
`EngineKernel.run` accepts those options as its fourth argument. CPU spans include
tick/frame identifiers. GPU durations remain counters tied to their submission
frame; the tool does not invent GPU execution positions on the host clock.
Stopping a capture excludes later GPU callbacks; allow normal asynchronous
readbacks to finish before stopping when complete GPU coverage is required.

The recorder overwrites its oldest records at capacity and reports the exact
count. Triggering on a long RAF interval retains recent context and stops after
the configured number of subsequent frames. An overwritten capture is partial,
even when it remains useful for diagnosis. Snapshot/export/report sort and
allocate on demand; keep them out of frame/tick loops.

## Existing game through Chrome DevTools

Start a separate Chrome instance with a dedicated profile and local debugging
port, open the existing game, connect and enter the scene. Then:

```powershell
npm run perf:capture -- --cdp http://127.0.0.1:9222 --url http://localhost:3007/ --seconds 15 --device "AMD RDNA3"
```

This attaches to exactly one matching page, reads its existing
`__THEGAME_AGENT__.rendering` telemetry, collects RAF intervals and long tasks,
and leaves the world, camera, settings and input untouched. `--cpu-profile`
also saves `cpu.cpuprofile` for DevTools. CPU profiling adds overhead and is a
separate diagnostic mode, not an equivalent performance baseline. CPU/GPU frame
IDs deduplicate delayed samples. Sampling overhead is recorded as
`capture.probe.ms`. Before/after renderer state, raw samples and visibility are
saved in `browser-evidence.json`.

Live game trajectories are uncontrolled: `compare` refuses to treat these
captures as controlled A/B evidence. Controlled captures must declare matching
`metadata.device`, `workloadId`, `qualityHash` and `controlledReplay: true` and
must use matching budgets. Those declarations need an actual replay/quality
oracle; setting the boolean alone does not establish equivalence.

Open `trace.json` with Perfetto or Chrome's trace viewer. Open `.cpuprofile`
with Chrome DevTools. Native renderer integration can be checked separately:

```powershell
$env:ENGINE_TRACE='1'
$env:RENDER_STABILITY_OUTPUT='artifacts/engine-perf/native'
node tools/render-stability/verify.mjs
```

That fixture uses diagnostic GPU readbacks and is a correctness/integration test,
not a live FPS benchmark.

## Server, workers and clock alignment

Use one `EngineTrace` per process/worker. Wrap synchronous work with
`trace.measure(name, category, callback, {tick})`. Record queue depths, RTT and
pending input with `trace.sample(metricName, value, {tick})`. Record causal
message endpoints with `trace.flow('input', 'session:sequence', 's'/'f', context)`;
propagate that correlation ID through the existing protocol.

```powershell
node tools/engine-perf/cli.mjs merge --inputs client/capture.json,server/capture.json,worker/capture.json
```

Separate clocks require a measured synchronization exchange.
`traceClockSync(localSend, remoteReceive, remoteSend, localReceive)` returns the
remote-to-local offset and uncertainty. For a remote recorder, use
`originMs: localOriginMs + remoteToLocalMs` and that `clockUncertaintyMs`.
Repeat exchanges and select a low-RTT sample; asymmetric transport still creates
uncertainty. Without calibration, merged tracks explicitly warn against drawing
network latency or critical-path conclusions. No production server endpoint or
network protocol is automatically changed by installing this tooling.

Performance tracing never enables `PhysicsCauseTrace`. Force/energy provenance
can change the selected execution path; validate physical causes separately
from measuring normal production throughput.

## Mesh conversion A/B

Save the compiled baseline before editing mesh conversion, then rebuild the
candidate. The same frozen geometry, neutral/mixed colours, sparse colour
changes and 16/32-bit index sizes run against both implementations:

```powershell
Copy-Item dist/procedural/mesh.js artifacts/engine-perf/mesh-before.mjs
# Make the candidate change, then npm run build.
node tools/engine-perf/mesh-packing-benchmark.mjs --before artifacts/engine-perf/mesh-before.mjs --browser
```

Omit `--browser` for a Node run. Three warmup rounds precede ten alternating
AB/BA rounds. Every output stream must match byte for byte. Source hashes and
runtime version accompany raw timings. This measures complete mesh conversion,
not game FPS; coloured meshes and late colour changes are retained as controls.
