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

Downloaded final source/tools match locally tested files. Temporary checked-apply transports and write workflows are absent. The permanent workflow has contents:read only. Later commits only document evidence.

## Acceptance

Typecheck/build passed on native Windows, Bun 1.4.2 / TypeScript 7.
**51 focused tests passed:** 15 projection/clock/replay/LOD, 4 environment worker, one real HTTP/SSE two-client test and 31 existing DSL tests.
**9 native network checks and 37 existing native HUD checks passed.** Zero captured page exceptions in either report; network renderer errors are empty.

The network browser uses a real Node authority worker, loopback HTTP/SSE, browser receive worker and the existing WebGPU renderer. It checks zero client physical bodies/physics steps, pause at an acknowledged tick with the renderer still active, exact server single-step, two-way paint editing without changing pose/entity, inspection of the paused tick, replay without rewinding authority, and dump reading without moving the replay playhead.

Real server-computed flight: tick **977**, time **16.2833333333 s**, COM height **1.5116394347 m**. Camera follows vertical displacement. No client force integration or scripted flight position. Complete environment bakes execute in a bounded worker pipeline with no failure.

Inspected screenshots: `network-replay.png` shows server tick 45 and renderer tick 12 simultaneously. `network-airborne.png` shows the server-computed airborne pose. Geometry quality is unchanged; the finite authored floor can leave the camera view in the long runway run.

Full suite: **143 pass / 3 fail / 0 skipped** (146 total). Same failures on PR24 baseline (124/3), first network source (139/3) and final source:
- clearcoat.test.mjs:22 — coat roughness blur;
- clearcoat.test.mjs:28 — normal-variance floor;
- vehicle-interaction.test.mjs:112 — source FBX triangle preservation.

No inherited test was weakened/skipped. Overall CI remains red and PR draft; focused/browser gates passed.

## Render bottleneck removed from the hot path

First tested network source `4bfaa9181a05fbd9cea562f7c41e40279af5c299`: https://github.com/Pom4H/game-engine/actions/runs/36327203482 , artifact https://github.com/Pom4H/game-engine/actions/runs/36327203482/artifacts/10934277592 . Its triggering SHA differs because checked integration committed before testing; the saved source identifies the actual code.

Functional checks passed, but cubemap regeneration at camera/probe origin-cell changes blocked rendering. Final code executes the SAME evaluator in a renderer-owned worker: one active input, one replaceable pending input and one complete ready result. Scene/content/seek epochs reject obsolete work. All nine mips become visible together; previous complete radiance remains while the next origin bakes.

Same native Windows Chrome runner, same viewport **1440x900**, actual canvas **816x597**, **6066 triangles**, 13 draws, 8 meshes. These are separate observational runs, NOT alternating paired render trials. The profiler retains 422 CPU frames before versus the last 1024 after (frame counter 1622). No universal speedup/display-FPS inference is justified.

| Measured work | First network run | Final run |
|---|---:|---:|
| Render-thread mean | 34.294 ms | 1.203 ms |
| Render-thread p95 | 73.3 ms | 2.4 ms |
| Environment p95 on render thread | 72.5 ms | 2.0 ms |
| GPU p95 | 3.647 ms | 3.384 ms |

Final retained CPU max **7.8 ms**, GPU max **3.995 ms**. This excludes cold loading, browser scheduling gaps, server simulation, network decoding and combined work across workers. Early omitted frames are not claimed stutter-free.

Observed baker counters: 195 jobs started, 191 completed, 864 pending replacements, one active and zero pending at inspection, no failure. Renderer submitted 1614 frames and skipped five RAF submissions while its two-frame GPU cap was occupied.

Unchanged output size: **256px × six faces × nine mips**, **4194288 half-float bytes**. Golden SHA from an independently executed prior evaluator matches all fixture output bytes: `2c3060f3caeed7ac3dd31389c443e6aa4b844ac24f62e71053e78be631e78739`.

This trades synchronous availability for background-update latency, not reduced resolution. Initial scene bake, measured HDR processing, GPU uploads, scene preparation and GC remain real costs. No universal no-freeze or instantaneous reflection-update claim.

## Shared publication measurement

Node v24.21.0 / Windows x64; 16 recipients, 128 entities, 30 publications; four warmups/path and **11 alternating paired samples**. Reference repeats capture/encoding per recipient; new path shares one Publication. This is NOT a comparison to thegame, which already has publication batching.

- Repeated median CPU: **31.2559 ms**.
- Shared median CPU: **2.0105 ms**.
- Capture/encode counts: **480 -> 30**.
- Output across all recipients unchanged: **4341264 bytes**.
- Both exact hashes: `1605250dfc8ae9a55f99dfceee1ec9e64fe9576d9482a8225d73bd6c8835e34a`.

No bandwidth, server-capacity or whole-game FPS claim. Synthetic population fixture: **100000 xyz positions -> four height-aware cells -> 420 bytes**, count sum unchanged. Not 100000 NPC brains or a measured real population renderer.

## Limits

The typed whitelist/history layer is real; supplied transport is a trusted localhost SSE debug adapter, not production WebTransport/QUIC, WAN acceptance, full authentication or multiplayer editing policy.

Replay covers only selected fields. Motion handles installed entities and Euler transforms/scale. Dynamic fracture definitions, node buffers, sound events, unwrapped wheel spin, prediction/reconciliation, full save/restore/fork and real population handoff need additional integration. Inspection is not a restorable checkpoint.

LOD provides tested full-3D projected-size selection, hysteresis and prepared geometry-revision handoff. Terrain seam stitching/geomorph, shared terrain samples, shadow LOD and population far/near handoff are NOT yet connected. Heights survive the projection, but complete seamless LOD is not certified.

Raw heap capture is disabled in CI. No heap was captured, analyzed or attached. Opt-in capture writes a sensitive private local worker heap file and blocks that paused isolate; it excludes GPU memory and other processes. Launch/API/budgets: `docs/network-projections.md`.
