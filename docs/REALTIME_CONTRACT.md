# Real-time, ownership and visual-quality contract

Status: target architecture plus a first verified streaming-lifecycle patch.
This is NOT a claim that the whole engine is freeze-free, leak-free or AAA-ready.
The existing causal/render, emergent-execution and server-authority contracts
remain authoritative. Do not add a second world, replace the kernel wholesale,
weaken a physics assertion, or substitute generated pictures for renderer evidence.

## One world; bounded projections

```text
.world / SceneSpec -> validated world -> EngineKernel
                         input -> plan -> simulate -> commit -> publish
                                                            |
                                            versioned committed projections
                                          render / audio / network / tooling
```

Authoring/compiler services are outside the interactive loop. TypeScript tooling
and Rust/WASM kernels are implementation choices, not real-time guarantees.
A worker proposes a result with entity generation and source revision; only its
owner may validate and publish it. Stale results are released, not committed.

Preserve rigid/structural physics, material/deformation/fracture, water and
weather, causal audio/acoustics, vehicles, animation/IK, ConversationFaceRig and
speech articulation, acting, networking, replay, infinite-world visibility,
World Interaction IR, and the existing opt-in Rust/WASM kernels. Game-specific
NPC beliefs/economy and world-generation rules remain outside generic scheduling.
Keep numerical-parity gates for every accelerated backend.

## 1. No unbounded work on the presentation path

The frame must not await network, generation, shader compilation, GPU readback,
AI/NPU decisions, or a worker acknowledgement. It consumes a complete committed
projection and an already resident visual representation.

A work item needs an owner, cancellation/generation token, source revision,
maximum admitted bytes, bounded work quantum, publication boundary and fallback.
Use bounded worker queues and bounded main-thread publication/upload quanta.
A time check BETWEEN two monolithic 40 ms jobs is not a 2 ms scheduler.
A Promise does not move synchronous work off the main thread.

Keep desired detail separate from actual resident detail. While refinement is
pending, use the existing/coarser representation, with an explicit maximum staleness
and visual floor. Prediction and hysteresis must reduce churn, not duplicate truth.
Physics residency is separate from render visibility. Do not let a camera see a
mountain and thereby activate every distant contact, NPC or economic process.

Simulation preserves fixed steps and deterministic ordering. Catch-up must be
bounded and observable; skipping causal events or varying solver iterations from
wall-clock timing is not an acceptable optimization. If authoritative work exceeds
its admitted budget, report overload and use a specified protocol/admission policy.
Do not conceal simulation lag behind repeated frames. Coarse safety collision must
be ready before a body enters an area; missing render detail must not remove it.

## 2. Ownership is explicit, including failure paths

Every resource has one owner and a lifecycle: reserved -> producing -> ready ->
resident -> retiring -> released. Account for CPU payloads, WASM live allocations,
GPU allocations, staging buffers, in-flight uploads, snapshots, audio voices,
worker messages and caches. A tile-count bound is NOT a byte bound.

Reserve bytes BEFORE starting work. Cancellation keeps its reservation until
completion or an acknowledged worker termination. GPU retirement has a separate
bounded queue tied to submission completion; never reuse an in-use allocation.
A fixed number of snapshots needs reader leases/generation IDs, not blind reuse.

Cleanup must cover success, cancellation, failed/partial install, scene replacement,
device loss and shutdown. A failed disposer is observable and fails the lifecycle
gate; calling a disposer once is not proof that a faulty adapter freed its memory.
Do not depend on GC/finalizers to release GPU/native resources. Rust ownership does
not by itself rule out retained collections or reference cycles either.

## 3. Quality may scale only inside an accepted envelope

Define named profiles with hardware, resolution, frame target, scene/seed,
trajectory and minimum quality. For a 60 Hz target the nominal frame interval is
1000/60 ms; that is a target, not a measurement of this engine.

The render plan must cover material/lighting consistency, geometric detail and
instancing/visibility, shadow stability, reflections/refraction, water/volumes,
antialiasing/temporal reconstruction, tone mapping and authored composition.
Features already implemented stay in place; missing ones remain explicit work.
Warm and cold shader/pipeline behavior both need evidence. No synchronous pipeline
creation on the interactive critical path; no blocking readbacks for profiling.

Adaptive quality may reduce only declared visual costs, with hysteresis and a
quality floor. It must not change authoritative physical facts. A faster blurred,
popping or wrongly lit frame does not pass because its average FPS increased.

## 4. Evidence required before declaring a profile supported

| Gate | Required evidence |
| --- | --- |
| Causality | Same inputs/seed/ticks produce the accepted state/event hashes; async results cannot create a second authority. |
| Physics | Existing analytical/state/energy and backend-parity checks stay strict. |
| Frame delivery | CPU/GPU timings separately, presentation intervals, p50/p95/p99/p99.9, worst frame, missed frames and spikes above 25/50/100 ms. |
| Responsiveness | Input-to-present latency, snapshot age, simulation lag and audio underruns; smooth stale frames are not a pass. |
| Ownership | Repeated scene/region cycles and fault injection; live resource counts/bytes return to the defined baseline, pending retirement is drained, hookErrors stays zero. |
| Memory | JS heap after controlled collection when available, WASM live bytes versus reserved capacity, GPU/application resource ledger, cache high-water marks and long-run growth. |
| Image and motion | Real hardware-rendered reference cameras plus video: temporal stability, disocclusion, shadow/reflection/water behavior, visual review, fixed exposure and matched quality. |
| Overload | Teleport/fast flight, cancellation storms, slow worker/network, failed generation, shader cold start, device loss and constrained memory. |

Lock scene, hardware, limits and baselines before evaluating a patch; do not relax
thresholds to make it pass. CPU and GPU may overlap, so do not blindly sum their
timings. Long-run memory checks need both allocator accounting and process trends;
WASM reserved linear memory need not shrink when live allocations are released.
OS/driver/browser stalls outside engine control remain separately reported.

Run unit/lifecycle checks in the sandbox first. GPU proof belongs on the existing
self-hosted Windows/Linux GPU workers, not GitHub-hosted or Apple runners. Missing
hardware evidence means UNVERIFIED, never a substituted image or a passing gate.

## First implemented slice: InfiniteWorld lifecycle

The patch keeps the public generation/residency abstraction and adds:

- real unsettled-task accounting, including cancelled tasks;
- release of late/cancelled payloads through the explicit release hook;
- one failed attempt per key until the next explicit update, not an automatic
  microtask retry loop;
- synchronous-error containment, partial-install rollback, independent cleanup of
  every value, and visible hookErrors;
- correct priority/distance/key ordering and atomic invalid-input rejection;
- deferred publication until install succeeds, with same-key generation safety.

`uninstall` detaches; when `release` is supplied it is the payload disposer.
Resource-owning adapters must be migrated to that split. Existing adapters without
`release` retain legacy uninstall behavior and are NOT certified against late-result
GPU/native leaks. Plain garbage-collected data may omit the release hook.

Local evidence: 24 focused lifecycle tests passed with Node 22.16.0 and strict
TypeScript 5.8.3 compilation of the streaming modules. Five selected regressions
failed against the original source blob 8e9c0070421d96787402306836de46f1a0e41394.
The 200-cycle test balances 800 explicit resource acquisitions/releases; it is NOT
a process-heap/GPU leak soak. Project TypeScript 7/full-package build and GPU gates
were not run in this environment. The standard test/*.test.mjs suite picks up the
new tests after the normal project build.

## Remaining work, in dependency order

1. Inventory resource-owning adapters and apply release/ownership accounting;
   add byte reservations and measured lifecycle/heap/GPU soak tests.
2. Split generation, main-thread install and upload into bounded quanta; integrate
   scheduling with existing EngineKernel/SimulationTier rather than a second world.
   The present InfiniteWorld still invokes synchronous install callbacks and may
   drain many immediately resolved jobs in one microtask chain.
3. Fix presentation/simulation coupling: BrowserRuntime.frame still calls Scene.step
   synchronously; FixedClock caps six steps, not their wall-clock duration. A timer
   cannot preempt one expensive tick. Isolate or incrementally bound real work.
4. Add revisioned immutable publication and asynchronous GPU resource/pipeline
   readiness with a bounded retirement path and safe visual fallback.
5. Run the locked visual/performance/physics/audio/network profiles, preserve the
   minimum visual quality and fix measured violations before claiming AAA readiness.
