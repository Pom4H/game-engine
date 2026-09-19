# Render quanta

The renderer is profiled as stable execution quanta rather than one opaque
"render ms" number. Profiling is opt-in: normal production rendering does not
run CPU timers, timestamp queries or readback. The names below are part of the profiling contract and are
intended to remain comparable across refactors.

## CPU timeline

| Quantum | Work |
|---|---|
| `lifecycle` | reconcile entity/mesh/texture ownership and release dead GPU resources |
| `resize` | recreate size-dependent render targets and bind groups when required |
| `materials` | discover asynchronous material texture loads |
| `lights` | build the bounded light grid and upload light/cell buffers |
| `frame` | camera, sun, shadow/reflection matrices and frame uniform upload |
| `visibility` | classify mesh entities into opaque/transparent sets |
| `prepare` | build per-object uniforms and surface-field GPU uploads |
| `cull` | camera, shadow and reflection visibility tests plus ordering |
| `encode.shadow` | encode the directional shadow pass |
| `encode.reflection` | encode the planar reflection pass |
| `encode.main` | encode sky, opaque, transparent and snowfall work |
| `encode.bloom` | encode downsample + horizontal + vertical bloom passes |
| `encode.post` | encode final post-processing/present pass |
| `submit` | finish the command buffer and submit it to the GPU queue |

CPU `totalMs` is wall time from the beginning of `render()` through queue
submission. It intentionally includes small gaps between measured quanta, so the
sum of named quanta can be lower than the total.

## GPU timeline

When the adapter exposes WebGPU `timestamp-query`, the same frame contains
native GPU timestamp pairs for:

```
shadow
  ↓
reflection
  ↓
main
  ↓
bloom.downsample
  ↓
bloom.horizontal
  ↓
bloom.vertical
  ↓
post
```

GPU readback uses a four-slot asynchronous ring. `render()` never waits for
query results. `gpuLagFrames` reports how far the latest decoded GPU frame trails
the latest CPU frame. If every slot is busy, a frame simply has no GPU sample
instead of stalling rendering.

The `main` pass is deliberately not split merely for profiling. It contains sky,
opaque geometry, transparent geometry and snowfall. Artificially separating those
into load/store passes would change the workload being measured. Their relative
work is exposed through counters; deeper GPU diagnosis should use feature A/B
runs, Chrome/Dawn tracing, or a real architectural pass split.

## Work counters

Each profiled frame records:

- total / visible / opaque / transparent entity counts;
- camera-visible opaque and transparent counts;
- shadow caster and reflection object counts;
- main draw calls and submitted triangles;
- snowfall instance count;
- CPU→GPU upload bytes split into:
  - `uniformUploadBytes`
  - `surfaceUploadBytes`
  - `lightUploadBytes`
  - `frameUploadBytes`
  - `snowUploadBytes`

This makes a CPU quantum actionable. For example, a regression in `prepare`
can be separated into more CPU work versus a larger surface/uniform upload volume.

## Browser API

```js
// Open the runtime with ?profile=1, or create BrowserRuntime with {profiling:true}.
const engine = window.__GAME_ENGINE__;

engine.resetProfile();
// run a representative workload
const profile = engine.profile();

console.table(profile.cpu);
console.table(profile.gpu);
console.log(profile.latestCpu.work);
```

`engine.drain()` waits for already-submitted GPU work without producing another
render frame. This is useful at the end of a measurement window.

## CLI

```sh
game-engine profile examples/winter-street.ts \
  --warmup 2 \
  --duration 5 \
  --width 1280 \
  --height 720 \
  --out render-profile.json
```

The profile command uses the production browser runtime. It performs a warm-up,
drains the queue, resets profile history, runs a real-time measurement window,
pauses, drains again, and writes the renderer profile plus simulation/wall-clock
ratio.

## Perfetto / Chrome tracing

Every WebGPU render pass is labeled with the same stable quantum name
(`render.shadow`, `render.reflection`, `render.main`, and so on). Chrome/Dawn
traces can therefore be correlated with the built-in timestamp data without a
second renderer or benchmark-only pass structure.

The built-in profile answers "which engine quantum is expensive?". Perfetto is the
next level for "why is that quantum expensive?" — driver scheduling, command
submission, shader execution, GPU queue bubbles, browser work and CPU sampling.
