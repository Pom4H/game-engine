# InfiniteWorld: bounded work and payload ownership

See [the engine-wide contract](REALTIME_CONTRACT.md) and
[world visibility/ownership](INFINITE_WORLD.md).

```ts
const world = new InfiniteWorld({
  generate: (demand, signal) => worker.generate(demand, signal),
  install: (demand, payload) => scene.attach(demand.key, payload),
  uninstall: (demand, payload) => scene.detach(demand.key, payload),
  release: (_demand, payload) => payload.dispose(),
  onError: (demand, error) => diagnostics.report(demand.key, error),
}, {maxResident: 512, maxConcurrent: 4});
```

This is an adapter sketch, not a new worker implementation. Install, uninstall,
release and onError are synchronous, bounded callbacks. Put expensive generation
in an actual worker. Put GPU retirement behind a bounded submission-completion
queue; do not free allocations still used by the GPU.

- `maxResident` bounds tracked ready/loading entries, not bytes.
- `maxConcurrent` bounds ALL unsettled tasks, even after cancellation/dispose.
- `pending` counts wanted loading entries; `active` includes cancelled work.
- `failed` records keys blocked from auto-retry. A new explicit `update()` allows
  another attempt. Do not implement an immediate retry loop inside `onError`.
- `hookErrors` counts throwing cleanup/diagnostic callbacks. A nonzero value must
  fail the ownership gate, even though cleanup of other resources continues.

`release` is invoked once for each successfully generated payload, including
undefined payloads and obsolete/cancelled results. `uninstall` is only called for
an attempted installation, including partial failure. When release is supplied,
uninstall must detach, not destroy the same payload again. Release must not be
shared across world owners without an explicit reference/lease protocol.

An adapter without release remains source-compatible. It cannot rely on uninstall
for a result that was never installed; GPU/native owners MUST supply release.
A failed generate must clean up resources it allocated before throwing, because
no payload has been handed to InfiniteWorld in that case.

`dispose()` cancels and detaches synchronously. `await world.flush()` afterwards
waits for late tasks and their release callbacks. Never await flush in a frame.
A generator that ignores cancellation forever holds its slot forever: this is
backpressure, not permission to spawn unlimited replacements. The worker supervisor
must terminate/acknowledge stuck work; a Promise timeout alone is not termination.

These changes address lifecycle races and retry storms. They do not bound
an individual callback's runtime, upload bytes, input-plan size or total native/GPU
memory. Those remain explicit integration work in REALTIME_CONTRACT.md.
