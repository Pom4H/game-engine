# One development console, no second engine model

The `Ё` / physical `Backquote` drawer replaces the playground's sidebar and
separate diagnostic overlays. It contains the existing source-bound controls,
renderer/physics diagnostics, localhost server tools and a command line.
`Escape` closes it. The existing toolbar button works on touch devices.
Typing backticks in an input or the source editor does not toggle the console.

The implementation lives in `tools/docs`, not `src/core`. No runtime dependency,
new scheduler, world registry, command bus, remote listener or writable settings
store was added. Existing `BoundControls`, `SourceDocument`, AST literal edits,
`planProgramEdit` / `applyLiveProgram`, runtime readers and network commands remain
the execution paths. Their old sidebar/overlay placement is removed.

## Read versus author versus applied

```
inspect scene
watch scene.tick
watch profile.latestCpu.totalMs
inspect entities.car/body.position
bindings
set exposure 1.2
undo
pause
step
play
pause server
```

`set` resolves an exact existing binding ID or an unambiguous property key.
Its value is JSON. Computed expressions are read-only. Unknown/ambiguous bindings
are errors; the console never assigns arbitrary runtime object properties.
It changes TypeScript through the same transaction and Undo as the HUD.
The reply distinguishes queued source revision from applied revision; a later
compile error retains the last good scene. Imported code still requires Apply.

Read views are `scene`, `entities`, `render`, `profile`, `physics`, `network`, and
`editor`. Reads share a lazy cache within one HUD refresh. They are live views,
not a coherent historical CPU/GPU checkpoint: GPU results may describe an earlier
completed frame. The console does not call arbitrary methods or evaluate JS.

Watches update with the existing 250 ms HUD cadence, and do not sample while the
drawer is closed. No second timer or whole-world cloning was introduced. Existing
renderer profiling itself still has its existing cost. Watches (16), command
history (50), output rows (40), command size and recursive display depth/width are
bounded. Large objects are truncated; explicit getters are not traversed.

## Boundaries

This is the console shell plus existing panels, not a completed GPU debugger.
There is no invented render dependency graph, resource lifetime timeline or
restorable GPU/world checkpoint. Those require actual renderer instrumentation.
The existing localhost network adapter remains localhost-only; this change does
not add production remote access. Source changes and server commands retain their
existing pause, epoch and revision checks. No legacy API alias was added; the
existing editor automation surface remains the same surface used by its tests.

## Verification

`node --test test/engine-console.test.mjs test/dsl-playground.mjs` runs shell and
source-binding tests. `node tools/docs/qa.mjs` exercises the actual WebGPU editor,
console editing/Undo, watches, physical Ё key and Escape, then existing HUD tests.
The DSL workflow runs this branch too. Inherited engine test failures are not
hidden or weakened. This change makes no GPU performance or graphics-quality claim.
