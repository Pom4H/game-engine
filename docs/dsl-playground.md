# Code ↔ HUD ↔ live engine

`bun dev` serves the standalone playground at `http://127.0.0.1:4173/docs/`.
Install the editor-only JS compiler first: `npm install --prefix tools/docs`.
The engine itself keeps its existing runtime dependencies (none). The isolated
editor compiler is TypeScript 5.8.3 because its browser JS API is available; the
engine build/typecheck continues to use the root toolchain.

`bun run docs:build` creates a static `.site` directory. No CDN, remote fonts or
old-game iframe is required. The downloaded site includes `serve.mjs`:
`node serve.mjs`, then open the printed address. WebGPU needs a supporting browser
and a secure context (`localhost` works); no image-generation or mock renderer fallback.

## One editable source

The TypeScript document is authoritative for authored parameters. HUD controls
are discovered from its actual AST, not a second settings JSON or string replace.
Number/range fields, vector components, colours, enums and composition toggles
patch the exact literal spans. Comments and unrelated code remain untouched.
A constant reference resolves to its declaration using lexical symbol lookup;
shadowed parameters and computed expressions stay read-only. The editor never
turns `roughness: base * scale` into a hard-coded computed number.

Each row links to its source location. Selecting a literal highlights its HUD
row. Orbit/zoom gestures edit the same `orbit(...)` arguments. Keyboard edits,
HUD and camera share a bounded undo/redo history. Rapid edits use rebased source
ranges; only the latest completed compiler request may install a scene.

This first editor uses a native textarea, syntax tokens from the TS scanner and
an AST property vocabulary. It is not a full TypeScript language-service IDE:
syntax diagnostics and domain validation are present; full semantic typechecking
of arbitrary user programs and completion are not yet implemented.

## Hot and structural edits

`@rom4/game-engine/dsl` exports `scene`, `assembly`, `vehicle`, `wheel`, `wing`,
`chassis`, `roadWheels`, `box`, `sphere`, `floor`, `orbit`, `humanoid` and the existing
M3/pickup definitions. Programs contain data, not executable tick closures.
`dsl/runtime` installs them into the same `Scene`/`spawnVehicle` used by games.

Camera, rendering optics, painted-material optics and vehicle inputs have a live
patch path. The physical body, simulation clock, damage/wear and force drivers
remain alive. Only changed leaves are applied: an exposure edit cannot rewind
engine input after a timeline event. Geometry compilers are reused per bounded
authoring session (at most eight live vehicle compiler entries).

Mass, springs, geometry, environmental initial conditions and topology changes
explicitly rebuild the experiment from its initial state. Removing an optical
parameter or changing alpha also rebuilds to restore unambiguous defaults. HUD
shows which path ran. This is not yet state-preserving hot topology surgery.
Reset/rewind always construct from the latest valid code, not an old preset.

Derived diagnostics (contacts, compression, wear, work, lift, frame timings) are
read-only. The same Vehicle part views feed those displays; reading a metric does
not advance physics. Source values are initial/authored state, not a dump of every
new physical position back into the code. The timeline is an explicit playback
control and is not written into the initial pose.

## Execution and lifecycle

Authoring runs in a restartable worker with one active and one replaceable pending
request, a 64k-character source limit and a two-second execution deadline. Programs
and primitives are validated before installation; budgets cap authored entities,
vehicles and mesh data. Syntax/runtime errors keep the last usable rendered world.
Replacement constructs/prepares first; cancelled/failed replacements are disposed.
One BrowserRuntime/GPU context is reused; no new renderer per slider movement.

Shared-link and imported-file code NEVER auto-executes. It requires Apply. This is
an editor for trusted local code, not a security sandbox for hostile multiplayer
mods. Worker isolation/time limits and our dev-server CSP are not capability security.
No user code executes on an authority server. Production deployment should use a
separate origin without privileged cookies; a static host must configure headers.

Sound is explicitly opt-in. No AudioContext is created on page load. Pausing,
changing examples, hiding or disposing the page stops/releases enabled sound.
Only current engine contact/ambient audio is supported; the old vehicle worklet
and material-synthesis laboratory are not claimed as migrated.

## Migration scope

Audited source: `Pom4H/thegame` docs catalog/core-play/models, full/catalog and
crash/catalog (default branch at the time of migration). The deployed docs URL
could not be independently fetched; the repository catalog is the inventory.

Fifteen editable programs: M3, pickup, driving/suspension, wings, tyre wear, wall,
dropped weight, two-car collision, glass fracture, material impacts, optical
materials, humanoid gait, snow/footprints, spatial index, module scheduler.
They use the new engine's real algorithms. Where the old system is richer, the
example is marked PARTIAL and its limitation is visible beside the renderer.

The in-app migration map is sourced from `tools/docs/examples.mjs`. Outstanding:
full city/traffic, building plans/interiors, boarding/doors, full character motor,
coupled soft-body/pole/mortar crash rig, engine/worklet audio and material studio,
causal replication, SQLite/worker host, interest/causal/population/storage/network
experiments, old performance trace and game HUD. They are not replaced with dummy
physics, oscillators, screenshots or the old application hidden in an iframe.

The old application and `game.rom4.ru/docs` are not modified or deployed by this PR.

## Acceptance

`bun run docs:test` runs real scene installation/step/disposal plus AST, history,
worker supersession/timeout, live-patch and compiler-reuse regressions.
`bun run docs:qa` runs the actual browser against the built site, exercising DOM
controls and the production editor paths. It asserts canvas pixel changes, stable
physical identity for hot edits, reset for structural edits, errors/undo, timeout
recovery, all native examples, airborne physics, mobile layout and imported-code
confirmation. Evidence is saved to `artifacts/dsl-playground/`.

The existing full-suite failures remain visible in CI; no inherited test is
weakened to make a green badge. CPU/GPU HUD numbers are explicitly labelled; they
are not presented as whole-game FPS or proof of a complete migration.
