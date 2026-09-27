# DSL playground: source ↔ inspector ↔ real renderer

```sh
bun install --frozen-lockfile
bun dev
# http://127.0.0.1:5173/ (also /docs/ and /playground/)
```

`bun run build:playground` creates a static `site/` directory. Serve the directory
via HTTP(S), not file://: the opaque compiler frame and WebGPU require a proper
browser context. This change does not deploy/replace game.rom4.ru/docs and does not
merge the stacked Vehicle PRs into main. The CI artifact is the built application;
the browser-evidence artifact contains actual WebGPU/UI screenshots and checks.

## Two-way editing

The left TypeScript document is the only authored configuration. The right inspector
is built from TypeScript AST provenance, including literal const initializers,
alias imports, object spreads, vectors, negative numbers and shared factories.
Sliders, numeric fields, checkboxes, colors, camera gestures and driving keys edit
exact source spans. They do not reserialize the file or maintain a second config.
Comments, surrounding formatting and identifier references survive. Editing a shared
const deliberately affects every consumer, with a shared-use label. Computed
expressions/function parameters are read-only in the inspector and navigate to code;
there is no regex-based attempt to guess an inverse for arbitrary JavaScript.

Code typing is debounced; dragging is throttled and serialized, NOT delayed until
pointerup. Valid intermediate inspector revisions may render while the newest
revision compiles. Stale responses never overwrite current source/bindings. One
slider drag is one transaction in the same undo/redo history as text edits. Source
map edits are rejected when version/span content no longer matches.

Shader appearance, camera, render resolution and Vehicle controls reconcile in
place: no new Scene or loss of pose/tyre wear, and unchanged lighting/materials do
not get invalidated on steering edits. Construction/geometry changes atomically
replace a validated program (and restart that scene). A syntax/validation error
keeps the last valid scene. A live physics value is not an author edit: force, FPS,
slip, wear and allocation counts remain read-only diagnostics and are not written
into source on every physical tick.

Selecting an inspector object or clicking its coarse mesh bounds navigates to its
source call. Selection is bounds-based, not a claim of exact GPU triangle picking.
Camera orbit/zoom writes literal camera vectors; calculated/shared camera vectors
that cannot independently represent the gesture require editing their expression.
Follow-camera motion is a projection and does not rewrite initial camera position.

## Execution boundary and cost

The engine entry points are `@rom4/game-engine/dsl` (data constructors) and
`@rom4/game-engine/dsl/runtime` (the existing Scene/module adapters). No TypeScript
compiler or editor state is imported by the engine runtime entry point.

A persistent compiler worker inside an opaque-origin iframe holds the TypeScript
compiler. A separate disposable worker executes each compiled scene-construction
program. It is terminated after the result, so timers/promises cannot persist as
unowned simulations. The iframe/worker CSP denies network access. Only serializable,
validated data enters the renderer document; user functions never run per frame
there. Execution has a two-second watchdog and bounded source/output/scene budgets.
This is not a claim of a hard browser heap quota against intentional allocation OOM.

The renderer/GPU device lives once per document. FixedClock owns bounded stepping;
Scene and existing physical/structural modules own simulation. Reset/new example
releases old entities/projections. Shader/control edits reuse the same runtime.
Pause, step, reset, source .ts export, state JSON and a real canvas PNG are provided.
Sound is opt-in and currently uses the engine's procedural collision audio, not the
full thegame vehicle-audio rack/combustion migration.

## Migration ledger

Source inventory: Pom4H/thegame `702bc303569a1802e80689948205a1847c03dde4`,
`docs/DOCUMENTATION_SITE.md`, `src/docs/full/labs.ts`, `src/docs/models.ts`.
The deployed website could not be fetched in this environment; inventory is grounded
in repository source, not an assertion about the exact live site's deployment SHA.

There are 11 runnable new-engine examples. This is **not complete feature parity
with all 22 original labs**. New native counterparts are not wrappers around the
old GameRenderer, static screenshots or decorative fallback algorithms.

| Original lab | Native playground coverage / remaining work |
| --- | --- |
| full-vehicle | Vehicle, wheel drive, spring/damper, contacts, wear, crash; no original ABS/moving terrain/multibody parity |
| full-character | Native locomotion and IK example; original character motor/jump/stamina not migrated |
| full-audio | Native impact audio only; AudioEngine/VehicleSoundTracker/vehicle rack not migrated |
| full-city | Not migrated: real city/roads/traffic generation must first become engine modules |
| full-building | Not migrated: actual building/interior generator, not replacement boxes |
| full-transport | Not migrated: seating/doors/boarding and dependent rig |
| full-network | Not migrated: production CausalPublisher/Receiver and channel controls |
| full-storage | Not migrated: real Bun worker/SQLite/fencing endpoint |
| full-hud | Not migrated: game-specific panels, authority snapshots/actions |
| kernel | Native ModuleScheduler rate/conflict and live plan; original tier/tick controls not fully mirrored |
| spatial | Native SpatialHash query/cache and exact-distance visualization |
| interest | Not migrated: production interest/hysteresis planner |
| causal | Not migrated: causal queue/dependency runtime |
| storage | Not migrated: encodeRecords/lease/token model |
| population | Not migrated: production needs/economy model |
| vehicles | Native reduced steering/suspension; original rack/ABS/differential lab not mirrored |
| animation | Native solveTwoBone reachability and locomotion |
| damage | Actual engine glass fracture, reduced chassis damage, isolated node/beam static-contact lab |
| rendering | Actual WebGPU light/material/coat/camera/resolution controls |
| audio | Impact synthesis available; original ExhaustSynth lab not migrated |
| network | Not migrated: sequence wraparound model |
| performance | Live measured RAF/renderer/physics counters; original synthetic trace is not called real FPS |

Added `wings` demonstrates emergent lift using the new Vehicle DSL; `wear` isolates
slip-work lifetime; `soft-body` is explicitly an isolated existing StructuralBody
lab, not a claim that the whole Vehicle now has coupled node/beam collision.

## Verification

`bun run test:playground` checks every example, AST bindings, comments/aliases,
shared undo, stale edit rejection, read-only expressions, real runtime hot updates,
unchanged geometry/lifetime, and error rollback. `tools/qa-playground.mjs` uses real
Chrome/CDP/WebGPU: it drags a native slider before pointerup, verifies changed source,
performs keyboard undo, edits code, changes GPU resolution, injects syntax errors
and an infinite executor, then opens all examples and captures desktop/mobile UI.
Full engine regressions remain a separate non-ignored CI job.
