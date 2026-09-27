# Network projection / paused editor verification — 2026-09-27

## Exact tested code and evidence

Final implementation: `3d35d5caab19066789d4bcd348a2f48b17e2f904`.
Stacked on DSL editor `1238321e6e04e18f0cc7866d8f847060a4e4cb41` (PR #24).
No merge/deploy of main, thegame, saves or the production server.

- Final read-only workflow: https://github.com/Pom4H/game-engine/actions/runs/36328385440
- Job: https://github.com/Pom4H/game-engine/actions/runs/36328385440/job/108645457565
- Network report, publication samples, two real PNGs, full regression log and exact source: https://github.com/Pom4H/game-engine/actions/runs/36328385440/artifacts/10935100821
- Existing HUD browser report and screenshots: https://github.com/Pom4H/game-engine/actions/runs/36328385440/artifacts/10935001169
- Artifact digests: network `2a5103a142a2104da149bb651b456644745b71f9847462e8936c887ff51f8ed2`; editor `b5cf9c2bc854e94c43a2b00ad3b5be2af79834dc0e1c4a29e024786834e9ab64`.

Final source archive was downloaded and compared against locally tested source/tools: no differences. Temporary checked-apply source transports and their write workflows are absent from the final tree. The permanent workflow has contents:read only.

## Acceptance

Typecheck and build passed on the native Windows runner, Bun 1.4.2 / TypeScript 7.
**51 focused tests passed:** 15 projection/clock/replay/LOD tests, 4 environment worker tests, one real HTTP/SSE two-client test and 31 existing DSL tests.
**9 native network/editor checks passed**, followed by **37 existing native HUD checks passed**. Both reports contain zero captured page exceptions; network renderer errors are also empty.

Network browser checks use actual Node authority worker + loopback HTTP/SSE + browser receive worker + existing WebGPU renderer:

- Zero physical bodies and zero physics steps on the presentation client.
- Server pause fixes an acknowledged tick while renderer continues.
- Server step advances exactly one tick.
- Two-way paint edit preserves the authoritative pose and the same presentation entity.
- Domain dump reports the exact paused tick and is explicitly not restorable.
- Server replay leaves authority time unchanged; reading dump also leaves the selected replay pose/playhead unchanged.
- Real server-computed flight: tick **977**, simulation time **16.2833333333 s**, vehicle COM height **1.5116394347 m**. Camera follow preserves vertical displacement. No client-side force integration or scripted flight pose.
- Environment maps complete in a bounded worker pipeline without a failed worker.

Inspected actual screenshots: `network-replay.png` shows server tick 45 and renderer tick 12 simultaneously, with the paused server and functioning DSL/HUD. `network-airborne.png` shows the server-computed airborne pose. Geometry quality was not improved in this change; the authored finite floor can leave the camera view during the long runway run.

Full engine suite: **143 pass / 3 fail / 0 skipped** (146 tests). The same file-qualified failures were present on PR24 baseline (124 pass / 3 fail), the first network source (139 pass / 3 fail) and final source:

- clearcoat.test.mjs:22 — coat roughness blur;
- clearcoat.test.mjs:28 — normal-variance floor;
- vehicle-interaction.test.mjs:112 — source FBX triangle preservation.

No inherited tests were weakened or skipped. Overall CI and draft PR remain red; the new focused/browser gates are green.

## Real render bottleneck found and removed from the hot path

First network source `4bfaa9181a05fbd9cea562f7c41e40279af5c299`, run https://github.com/Pom4H/game-engine/actions/runs/36327203482, artifact https://github.com/Pom4H/game-engine/actions/runs/36327203482/artifacts/10934277592 . This source was created by the one-time checked integration within the run; the triggering SHA is different and is not passed off as the tested SHA.

The functional network test passed, but procedural environment cubemap regeneration on camera/probe origin-cell changes blocked the render thread. Final code keeps the same evaluator in a dedicated worker, with one active input, one replaceable pending input and one complete ready cubemap. Scene/content/seek epochs reject stale jobs. All nine mips become visible together. The previous complete result remains available while a new origin is being computed.

Same Windows native Chrome runner; same editor viewport **1440x900**, actual render canvas **816x597**, **6066 triangles**, 13 draws, 8 geometry meshes. These are separate observational runs, NOT alternating paired render trials. Profiler retention differs: 422 CPU frames before, last 1024 CPU frames after (of 1622+ total). Therefore do not derive a universal speedup or display-FPS claim from this table.

| CPU work | First network run | Final run |
|---|---:|---:|
| Render-thread mean frame time | 34.294 ms | 1.203 ms |
| Render-thread p95 | 73.3 ms | 2.4 ms |
| Environment p95 on render thread | 72.5 ms | 2.0 ms |
| GPU p95 | 3.647 ms | 3.384 ms |

Final retained CPU max **7.8 ms**; GPU max **3.995 ms**. This is NOT a measurement of cold loading, all browser scheduling, all network decoding, server simulation, or combined CPU work across workers. The omitted early frames are not claimed stutter-free.

Final baker counters: 195 jobs started, 191 completed, 864 pending replacements, one active / zero pending at inspection, no failure. Four jobs were canceled across explicit edits/seeks. Network renderer submitted 1614 frames and skipped five RAF submissions while its two-frame GPU cap was occupied.

Resolution remains **256px × six faces × nine mips**, **4194288 half-float bytes** per full output. The entire fixture output is SHA-256 identical to an independently executed prior evaluator: `2c3060f3caeed7ac3dd31389c443e6aa4b844ac24f62e71053e78be631e78739`. The independent golden was obtained from the pre-extraction method, not by declaring the new evaluator its own oracle.

This trades synchronous availability for bounded background-update latency, NOT lower map resolution. Initial scene bake, measured HDR processing, final GPU uploads and general scene/material preparation are still real costs. No total no-freeze guarantee, instantaneous reflection change or universally constant frame rate is claimed.

## Shared publication measurement

Node v24.21.0, Windows x64; 16 recipients, 128 entities, 30 publications. Four warmups/path; **11 alternating paired samples**. Old reference repeats capture and JSON encoding per recipient; new path shares a Publication. This compares deliberately repeated work with shared work, NOT against thegame's existing batched implementation.

- Median repeated publication CPU: **31.2559 ms**.
- Median shared publication CPU: **2.0105 ms**.
- Capture and encode counts: **480 -> 30**.
- Output to all recipients remains **4341264 bytes**, exactly the same.
- Exact SHA-256 in both variants: `1605250dfc8ae9a55f99dfceee1ec9e64fe9576d9482a8225d73bd6c8835e34a`.

No server-capacity, bandwidth, graphics or full-game FPS speedup is implied.

Population aggregation fixture: **100000 synthetic xyz positions -> four height-aware cells -> 420 encoded bytes**. Sum of counts stays 100000. These are NOT 100000 simulated NPC brains or a measured real population renderer.

## Remaining work / scope

The transport-independent typed whitelist and replay buffer are real. The supplied transport/authority is an opt-in trusted localhost SSE debug adapter, not a complete production WebTransport/QUIC client/server, WAN acceptance, authenticated multiplayer editor or arbitrary-code sandbox.

Only the selected projection is recorded. Motion currently covers already installed entities and Euler transforms/scale. Full deformed topology/mesh creation, structural-node state, sound events, unwrapped wheel spin, prediction/reconciliation, complete save/restore/fork and real population LOD handoff require additional contracts. Domain inspection is not an automatically restorable memory checkpoint.

LOD currently supplies tested 3D projected-size selection, hysteresis and prepared geometry-revision handoff. It does not yet implement terrain seam stitching/geomorph, far-to-near population handoff, shared terrain samples at every render LOD or shadow-LOD integration. Heights are preserved, but complete seamless LOD rendering is not certified.

Raw heap capture is opt-in and disabled in CI. No heap was captured or analyzed in these tests; no raw heap is attached. The feature writes only a private local worker heap file, which can contain sensitive data and blocks that paused isolate. See `docs/network-projections.md` for limits and launch commands.
