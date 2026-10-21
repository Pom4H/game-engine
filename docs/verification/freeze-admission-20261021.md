# Bounded cold admission verification — 2026-10-21

The candidate moves copied triangle validation/packing, GPU mesh uploads and
render-only entity/binding preparation into explicit admission steps. Whole
replacement cohorts retain their previous publication until preparation succeeds.
The [API and ownership contract](../staged-triangle-admission.md) specifies scalar,
byte, resource and final publication limits. This is a structural correctness and
image-compatibility result; sustained 60 FPS without freezes is **not established**.

## Regression checks

| Check | Result | Retained raw evidence |
| --- | --- | --- |
| Current complete `npm run check`, after r30 retention/owner fixes | **980 passed, 19 skipped, zero failed; 999 total**, 66.0997 s | [Current full log](../../artifacts/freeze-engine-full-check-texture-final.log) |
| Complete `npm run check` before the later r30 texture-retention fix | **979 passed, 19 skipped, zero failed; 998 total**, 83.164 s | [Full log](../../artifacts/freeze-engine-full-check-final.log) |
| Later r30 texture-retention fix: material URL, entity/triangle admission, labels, buffer ownership and residency checks | **72 passed, zero failed**, 0.460 s; build passed | [Current affected checks](../../artifacts/entity-retain-boundaries-affected.log) |
| Affected material URL, entity/triangle admission, buffer ownership, residency and frame identity tests | **70 passed, zero failed**, 0.443 s; build passed | [Affected checks](../../artifacts/entity-preparation-affected.log), [build](../../artifacts/entity-preparation-build.log) |
| First full candidate check | 978 passed, 19 skipped, **one failed**, 75.112 s | [Original failure log](../../artifacts/freeze-engine-full-check.log) |

The first full run exposed a real optional-receiver regression: precomputing the
texture URL set evaluated public material getters even when `surfaceTextures`
was absent. Collection again evaluates those arguments inside the optional call.
The existing receiver/getter-order test passes in both the affected and final
complete runs. The failed raw run has not been replaced or removed.

The subsequent actual Game r30 boot exposed another real integration defect:
`queueMaterialLoads` retained only live Scene URLs and cancelled an initial
detached terrain texture, despite collection respecting its preparation pin.
Both retention boundaries now include prepared URL pins. Only the live URL set
drives the ordinary load loop, so retention cannot fan out detached loads outside
their one-request-per-step budget. A new regression uses actual `SurfaceTextures`
with delayed fetch/decode, interleaves both live retention boundaries while the
Scene is empty, checks that the request stays un-aborted, and verifies no first-use
object allocation/binding after readiness. Async error strings also include the
original failure message. The current 999-test complete run and textured native
record below include this follow-up. Earlier logs remain attributed to their own
snapshots.

The new tests exercise full original-double/packed-byte equality; scalar/upload
credits; cancellation and synchronous reentry; async validation/OOM rejection;
texture load readiness and source/handle changes; positive/mirror residency;
same-ID replacements; offscreen entity cache adoption; and exactly-once resource
cleanup. Disposed Scene tickets clear both entity and Scene-owner roots. No
nondeterministic WeakRef collection assertion is used as proof of released memory.

## Native image and first-use resource proof

The [textured native entity report](../../artifacts/freeze-textured-entity-native-20261021/report.json)
compares the previous synchronous compact/GPU path with the actual worker
transport, segmented copied validation/upload tickets, detached entity preparation
and explicit complete binding adoption. A real authored blob terrain image is
decoded, mipmapped and retained while empty-Scene `queueMaterialLoads` and
`collect` interleave during detached preparation. It ran on native headless WebGPU at
**1280 × 720**, AMD `rdna-3`, `isFallbackAdapter: false`.

| State | Full PNG | Full HDR | Full depth | Draw/triangle geometry | After-path hot object allocations / binds |
| --- | --- | --- | --- | --- | --- |
| Dry | Exact | Exact | Exact | Exact | 0 / 0 |
| Wet/night | Exact | Exact | Exact | Exact | 0 / 0 |
| Mirrored | Exact | Exact | Exact | Exact | 0 / 0 |
| Rebased | Exact | Exact | Exact | Exact | 0 / 0 |

Each HDR target contains 7,372,800 bytes and each depth target 3,686,400 bytes.
Both paths draw 296 triangles in ten draw calls; GPU error arrays are empty.
The staged cache intentionally contains twenty meshes versus ten in the baseline:
one prepared normal and one prepared mirror per part. Unused mirror resources
remain pinned until their owner retires. This difference is not a leak or memory
improvement claim. Before/after PNGs, actual bundles and harness sources are
retained alongside the report.

The 12.478 s harness elapsed time is numerical
image/resource verification, **not FPS, latency or a paired speed measurement**.
It does not establish whole-world car/flight behavior, arbitrary callback trace
parity, native foreground focus or an upper bound on frame time.

The earlier [non-textured entity report](../../artifacts/freeze-entity-native-20261021/report.json)
is retained with its 23.951 s harness elapsed time and CPU-test overlap. Its four
image comparisons passed, but did not exercise the pending authored-texture path
which later failed actual r30 boot. It is not substituted for the new textured
proof.

The earlier [mesh-admission native proof](../../artifacts/freeze-admission-native-20261021/report.json)
is preserved separately. It covers the same four image states before detached
entity admission, with a 12.525 s harness elapsed time. Its original
[cache-count contract failure](../../artifacts/freeze-admission-native-20261021/first-cache-count-contract-failure.json)
is also retained: the initial assertion incorrectly expected one cached mesh per
part despite intentionally prepared mirrors. The final stronger check requires
exactly one mirror per part; image/depth/geometry comparisons were retained.

## Source provenance

The textured report lists eighteen selected sources: nine Engine runtime files,
two harness files and seven Game integration files. Read-only SHA-256 checks
match **all eleven listed Engine/harness files** against the current candidate.
Five Game files still match; `entity-admission.ts` and `the-engine-projection.ts`
have later compatibility/publication-boundary changes and no longer match that
snapshot. Those Game files are context records, not a claim that the fixture
directly exercises their complete production integration. The coordinating run
will repeat proof after the remaining Game freeze. Runtime sources were not
edited for this documentation update. Selected Engine hashes recorded by the
textured native report are:

| Source | SHA-256 |
| --- | --- |
| `src/procedural/mesh.ts` | `3e3b238a48e0f2e76e6aaf18da39781c63929a15dd13d9cbe3785e66764ecaff` |
| `src/scene/validate.ts` | `a11c5a5af9f3ee7f6604c3beb2a6acc2e7816c6b596087ecf640450ae12b98ce` |
| `src/render/radiance.ts` | `0617b65b7c1690148f11ef1535fb03c35c5e607daf7361fcb310dc9d79ae6107` |
| `src/procedural/copied-triangle.ts` | `680432fc0d3b460ab2175141a2ca7e5c51b22b6aa7371dda4e82c8518cdfb30e` |
| `src/render/mesh-preparation.ts` | `6980b3c8141e6da8c0c7a72b636b3d8e38ffeffcf0de0aed2416db1945d7b40b` |
| `src/render/webgpu.ts` | `2a3182be80bc1f04cf92d821959cbadf149e8c86fa71bbd9b2c4e9405f35e1ba` |
| `src/render/surface-textures.ts` | `d63c129dc1569a31928b40e9efdb190fce75772ec580fadd4c776c0c1ba8437c` |
| `src/render/entity-preparation.ts` | `d7ce7f528badbc951a2dcd351a8c5693a753212833a1839e81a6b79bb65a49ca` |
| `src/scene/render-entity-preparation.ts` | `b57e00a9c9d34eba43678b6921c819fde54866afbeb10a768cbf86d80c84e0c5` |

This is the report's selected-source manifest, not a claim that it enumerates the
entire transitive import graph. For example, `src/scene/scene.ts`, `src/index.ts`
and the environment worker are not separately listed in that native manifest.
The earlier mesh-only report has its own source snapshot; it is not attributed
to the final entity implementation.

## Related Game source/input proofs

The sibling [collision/controller admission record](../../../thegame/docs/verification/freeze-collision-admission-20261021.md)
documents saved-session, possession and cold source readiness ordering. The
[structural streaming report](../../../thegame/artifacts/freeze-streaming-structural-20261021/report.json)
records bounded source queues, installation/retirement ownership, source fences
and the remaining indivisible registry/interior/lift operations. These use the
same authority and world sources; they do not create another game/simulation.

The [worker/input proof](../../../thegame/artifacts/freeze-worker-input-20261021/report.json)
uses trusted W/D Chrome DOM events through production `GameInput`, the real-time
`FixedInputClock`, `GameNetwork.send` and actual motion encoding/decoding into a
memory wire. With only the worker finish handler delayed by 500 ms in the
diagnostic bundle, **31 automatic input rows** advance during the observed
503.5 ms worker wait. Neutral encoded input is observed **332.2 ms before** worker
completion. All eleven checks pass; no RAF, manual tick or fake clock drives the
test. This is not actual network transport, authority ACK, GPU/FPS or simulation
deadline acceptance.

The subsequent actual whole-Game [car r31 functional record](../../../thegame/artifacts/performance-transport-migration-freeze-functional-car-r31.json)
passes its same-body/seat, displacement, instruments and advancing authority/ACK
checks over 34.57 m and 120 measured frames. The
[raw renderer record](../../../thegame/artifacts/performance-live-migration-freeze-functional-car-r31.json)
reports full 1280 × 720, render scale 1, TAA/bloom enabled and no GPU errors.
Complete CPU test suites overlapped that run: it is functional integration
evidence, **not FPS or a no-freeze deadline acceptance result**. Later Game edits
remain subject to the source-provenance qualification above.

## Current limits

- Detached glass still uses synchronous raw geometry. The recorded largest
  one-vehicle case takes **9.6233 ms** in Bun `compileGameGeometry` plus **0.379 ms**
  for its numeric copy. It has 4,698 double-sided triangles / 183,222 scalars.
  There is no independent global debris-triangle admission cap. These CPU values
  are neither native browser measurements nor a full frame budget.
- The new entity lane waits for authored texture readiness, but existing
  `SurfaceTextures.load` decoding, shader/mip preparation and upload callbacks
  are not scalar/byte sliced by this change. Cold glyph rasterization is outside
  this lane and cannot silently fall back inside it.
- Uniforms are fixed at 400 bytes per object. Ordinary visible pose/weather
  updates, the final O(cohort size) native Map publication tail, its underlying
  allocation/rehash behavior and steady-state frame preparation are not hard
  wall-time bounded. Game caps complete cohorts and publication credits at 256.
- Individual WebGPU allocations/binding/destruction calls, browser/driver
  scheduling and garbage collection remain indivisible. No hard real-time or
  maximum-GC-pause guarantee follows from these work-credit limits.
- Authority physics, storage, world registry/interior hooks and collision cleanup
  need their own current-world deadline evidence. This report does **not** prove
  a loaded server maintains 60 Hz, or that driving/flying stays freeze-free.
  Whole-Game regression and actual native functional/performance results belong
  to the coordinating integration record, not these frozen-image fixtures.
