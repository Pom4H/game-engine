# Integrated product slice

> **Engine-first freeze:** this branch is not currently a gameplay-integration target.
> Existing Chess, Car/Ball and Thegame-lite routes are retained only as engine
> regression/stress harnesses. New gameplay waits for the rendering, networking,
> audio and physics gates in [ENGINE_FIRST.md](ENGINE_FIRST.md).

Base: `codex/adaptive-core` at `2db7720705c87c70ebc3572e7f7956abdfe0e0b0`.
This change keeps that branch's Vehicle, source editor, native QUIC room, passive
presentation, dynamic mesh upload and common console/recorder. It is not a wholesale
merge of `refactor/causal-runtime` or a completed migration of `Pom4H/thegame`.

## Launch

```sh
bun install --frozen-lockfile
bun run build
node tools/docs/build.mjs
bun cli serve
```

`/` is the product site; `/modules/` lists 13 source areas and their existing executable
examples; `/docs/` remains the original source-bound engine editor. `/games/chess/`
runs without physics/GPU. `/games/car-ball/?mode=local` starts the existing authoritative
arena in a local worker. `/games/car-ball/` still requires `bun run arena` and the
native network boundary. Local mode is explicit; it is never a fallback from a failed
remote connection. Two people share a local chess board; there is no chess AI/account
service. Car / Ball is the engine's arcade game, not numerical Rocket League parity.

```sh
bun cli check examples/chess/project.ts
bun cli inspect examples/chess/project.ts --preset endgame
bun cli perft 4
bun cli --schema
```

`check` validates active modules/dependencies/preset parameters without calling their
factories. Importing authored TypeScript is trusted code, not a hostile-code sandbox.
The browser compiler runs in a killable worker with CSP-denied network access. It
uses syntax transpilation plus runtime domain validation, not a full TypeScript
language-service semantic check. Editor typing analyzes literals only; Apply executes
source and installs a checked candidate. Parameter changes rewrite the same AST ranges.
Ordinary chess moves do not overwrite the authored initial FEN.

## Composition and computation

`src/core/project.ts` does installation-time ordering and ownership. Module instances
are returned directly, not wrapped in a per-tick generic dispatcher. Presets cannot
activate missing modules. Dependencies must be explicitly selected; creation reads
only declared dependencies. Invalid configuration runs no factory. Completed starts
are rolled back on subsequent startup failure; disposal is idempotent and reverse order.
A failing factory must release any resources it created before throwing.

Chess is event-driven. The arena keeps its existing 120 Hz/two-substep solver, one
rigid owner per car and one nodal owner for the ball. Explicit default configuration
is tested against the unchanged default arena trajectory. The local worker uses the
same complete projection and bounded one-active/one-replaceable-pending handoff; no
physics runs in the presentation client. Editing physical settings starts a new epoch.

Pure EngineKernel projections may opt into incremental execution. Version cells and
read sets are prepared at registration; stable inputs skip both evaluation and context
cloning. Stateful physics remains cadence-driven. Seen versions advance only after a
successful batch commit; this is not rollback for a host reducer that partially mutates
and then throws. Exact named channels and `*` are supported, not hierarchical aliases.

These are specific avoided operations, not an absolute zero-cost/zero-allocation or
FPS/no-stutter claim. Startup checks, scheduling, snapshots, networking, the renderer
and enabled diagnostics all have costs.

## Tracing

The causal-runtime branch's owner/kind/refs/cause/capability record shape is retained
in a scoped `RuntimeTimeline`, with a hard ring capacity even when spans never close.
Late ends cannot overwrite reused slots; evicted parent IDs remain explicit orphan
references. Disabled timelines store no records. CpuProfiler can feed this timeline
from the same nested measured execution boundaries; GPU timestamps remain in the
existing renderer recorder, never inferred from CPU durations.

In local Car / Ball, use the existing Ё console: `trace on`, `trace show`, `trace off`.
Timing is collected in the authority worker, not from message round-trip time. This
slice does not yet integrate #29's complete memory registry, every causal impact/audio
row or its Gantt UI. There is no second Backquote panel.

## Inherited regression expectations

The prior full suite had three failing tests. No material, mesh, shader or solver
algorithm was changed to make those tests pass:

- Local clearcoat probes already use parallax-corrected direction. The test now checks
  that actual path and the roughness-selected mip, rather than demanding its removal.
- Base and coat already share the current normal-variance filter. The test compares
  the two expressions and their finite positive parameters rather than pinning a
  superseded literal pair. Coating still uses its own material roughness.
- Original FBX provenance says 9,798 triangles. The instantiated packed assembly is
  11,922; the current grille has 22 horizontal slats, not 12 old vertical slats. Both
  provenance and current assembly expectations are locked separately. Existing tests
  for semantic imported parts, physical/render shell separation, glazing and fracture
  remain. This corrects test scope; it is NOT renewed proof of full original FBX parity
  or visual approval of the current M3. The original FBX was not re-imported here.

## Current development order

The active product order is now:

1. rendering quality, determinism, streaming and frame-budget evidence;
2. generic authoritative networking, replay, backpressure and impairment testing;
3. physically/semantically driven audio with deterministic offline regression;
4. unified physics with complete cause provenance and reality-oriented validation;
5. only then new game code.

Existing game routes must not receive new gameplay systems during this phase. They may
change only when an engine subsystem needs a reproducible acceptance fixture.

## Evidence and remaining work

Run `bun run check`, `bun run docs:test`, `node tools/product/qa.mjs`. The browser test
uses native Chrome/WebGPU, actual source workers, pointer/keyboard input and the local
authority. Screenshots and `browser-report.json` stay in `artifacts/product/`. Existing
GitHub artifact storage quota must not determine test success. Source is ordinary Git.

The website's initial arena card comes from native run 36387640678 / source 6bfb8c5,
not a new render or a synthetic recreation. It is illustrative, not current acceptance.

Remaining in the active phase: render/environment quality and regression evidence; reconciliation of the complete
#29 renderer/memory/Gantt work where it strengthens the engine; generic network impairment/replay/backpressure validation;
audio causality/regression; unified physics provenance, contacts and real-world validation; selectable built-in Scene systems;
and a unique live view for every engine entity. Full Thegame/gameplay parity is intentionally deferred until these gates pass.
