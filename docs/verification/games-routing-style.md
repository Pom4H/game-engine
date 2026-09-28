# Game code review and canonical /games route

Base: `6bfb8c51228c99dad1cc91c647194a0643c5bb8a` on `codex/adaptive-core`, PR #26.
Reviewed neighboring PR #29 at `3794338bd17bc45192c53c4f411d07f19cd7a649`.
No main merge or production deployment. This is a selective application of a
reviewed design principle, NOT an integration of all of #29.

## Which changes help the game

PR #29 consolidates per-entity renderer state and resolves classification from one
structural pass. The same idea simplifies our passive game adapter: bind entities,
wheel roles, scaled offsets and projection offsets once when installing the view.
Each sampled frame then updates those bound records, instead of reconstructing
identities from strings and looking them up again. Ordinary typed records suffice;
no new registry, scheduler, effects library or decorative game DSL is added.

CarBallArena's authoritative recipe already directly steps PhysicsWorld and
StructuralBody. Removing SceneSystemRuntime in #29 therefore does not remove any
of that recipe's current code. Stateful physics must remain cadence-driven, not
marked incremental merely because user input is unchanged.

A wholesale merge needs reconciliation: #29's renderer lacks our DynamicMesh
revision upload and passive-presentation registration path; its Backquote overlay
would coexist with our existing console/recorder. Its test suite also changes the
old clearcoat and M3 expectations; a green result there is not evidence that our
unchanged full suite passed. This patch does not import those expectation changes,
replace the renderer, or claim that #29's memory/Gantt features are integrated.

The duplicate f64 basis-to-Euler function in the arena and ordinary vehicle adapter
is now one pure function in physics/rotation.ts. Formula and evaluation order are
unchanged. Bindings live exactly as long as their fixed scene roster; a topology
replacement requires recreating the view. Material edits do not change entity refs.

## Measured equivalence, not an FPS claim

Local Node 22.16.0 / TypeScript 5.8.3. The project-declared Bun/TS7 versions are
unchanged; local availability is not a claim of having tested those versions here.

The original compiled adapter and changed adapter consumed 400 identical quantized
samples, including all three axes, singular orientation charts, wheel compression,
steering, backwards seeks and epoch/generation changes. All 997200 compared numeric
values (211 entity transforms and soft mesh position/vertex buffers over the run)
were exactly equal under the same JS runtime.

| Work inside CarBallView.apply | Before per sample | After per sample |
|---|---:|---:|
| scene.entities.get | 54 | 0 |
| semantic wheel-name regex exec | 20 | 0 |

This is 21600 versus zero scene lookups and 8000 versus zero regex executions for
that fixture. Installation still resolves and stores bindings. There is a small
fixed-memory cost; neither the whole renderer nor end-to-end FPS was benchmarked.
Runtime source diff across the three modified src files is +31/-27, net +4 lines.
This is less repeated work and one shared formula, not a reduction in total LOC.
The 146-line authoritative game recipe, solver, wire layout and network are unchanged.

Reproduce after building the original base into a separate directory:

```sh
node tools/games/compare-presentation.mjs /path/to/base/dist
node --test test/game-presentation.test.mjs test/games-site.test.mjs
```

## Public layout

- `/games/`: game catalogue; `/games/car-ball/`: the actual arena.
- `/docs/`: the existing code editor and documentation.
- `/engine/`: one compiled engine for both clients.
- `/shared/`: one console, recorder and receive/decode worker for both clients.

Game source is under tools/games/car-ball, shared browser code under tools/shared.
Old /docs/arena.html, .mjs and .css are removed, not aliases or duplicate copies.
A shared staticSite handler serves both the development host and portable archive.
The game module graph contains no /docs dependency. The server authority/control
endpoints and QUIC transport contract are unchanged. Static downloads still need
an actual running authority to play a room.

The HTTP test builds an isolated site, follows all 82 game module/worker imports,
checks script MIME, shared paths, slash redirects/query retention, absent legacy
paths, path containment, HEAD/method handling and compiler/game CSP. It starts the
actual dev host and generated portable host and verifies identical public files.
The dev-host route test explicitly uses diagnostic SSE; it is not UDP acceptance.

## Local validation

Typecheck, engine build, site build and syntax pass. Four new tests pass. Existing
DSL/HTTP plus selected arena/route/presentation integration: 39/39 pass.
Full before: 237/240; full after: 241/244. Exactly the same three failures remain:
clearcoat roughness, clearcoat normal-variance floor, imported M3 triangle count.
No pre-existing assertion was weakened or disabled.

The existing native workflow is updated to exercise /games/car-ball/ with the real
QUIC/WebGPU clients and to retain the original editor/recording acceptance. Read
that run's result before claiming native acceptance of this patch.
