# Native Chrome profiling

Use Chrome Performance for the timeline, sampled JavaScript stacks and screenshot
filmstrip. Do not build a second sampling profiler or wrap the engine's maths.

For the running editor: open DevTools → Performance, enable Screenshots, leave
JavaScript samples enabled, Record → interact → Stop. Select a range, then use
Call tree / Bottom-up and the filmstrip. Source maps map samples back to source
when the build provides them. A recording is not an exhaustive log of every call.

## Existing render harness

Keep the existing scene and views arguments and add `CHROME_TRACE_SECONDS=5` to
the environment. In PowerShell: `$env:CHROME_TRACE_SECONDS='5'`.
Then run `node tools/render-harness.mjs <scene.mjs> <views.mjs>` as before.

Deterministic stills and `render-hud.json` are captured first, unchanged. The
harness then records 5 seconds of normal simulation/rendering from the last view
through its existing CDP connection. It resumes/pauses the existing runtime; there
is no second simulation and no per-frame remote polling. Normal BrowserRuntime
profiling is already off by default. The trace helper is imported only on request.

Open `artifacts/render.trace.json` with Performance → Load profile. Set
`CHROME_TRACE_PATH` for a different output. Existing captures are never overwritten.
Default duration 0 means disabled; maximum is 30 seconds. A 16 MiB Chrome buffer
and 64 MiB streamed-file limit bound capture storage. Reported buffer loss is an
error, not a silently complete profile. CDP waits are bounded and streams closed.

The harness uses its own temporary browser profile and loopback debugging port.
Do not expose CDP to the internet or attach it to a personal browsing session.
Traces can contain code URLs and scene images; keep them local unless sharing is
intentional. No automatic trace upload, extension or production endpoint is added.

## Verification and scope

`node --test test/chrome-trace.test.mjs` exercises recording, chunk decoding,
cleanup, overflow, size limits, existing files, start failures and timeouts.
`node test/chrome-trace-native.mjs` verifies Chrome sampling of main + worker
functions and actual filmstrip events on an isolated Canvas2D fixture. This is NOT
an engine render or an engine performance benchmark. Its artifacts are under
`artifacts/chrome-trace-native/`.

Native capture itself costs CPU/memory; compare performance with recording off.
Filmstrip is not guaranteed lossless video or a rewindable physics checkpoint.
Browser traces do not provide a complete shader call stack or replace optional
WebGPU timestamp queries. Existing GPU diagnostics are not deleted as "duplicates".
The Ё-console recording controls and a WebGPU end-to-end capture remain separate
integration work; this change provides the native collector in the existing harness.

References: Chrome Performance reference and Performance extensibility API;
CDP Tracing (`ReturnAsStream`) and IO domains. Custom engine tracks, if needed,
should use native `console.timeStamp` at coarse boundaries, not a second timeline.
