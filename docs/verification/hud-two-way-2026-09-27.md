# Two-way HUD acceptance — 2026-09-27

Verified implementation/QA: `6a2cbfc46e8907a18a78386e182230dd59b600bf`.

- [Native Windows job](https://github.com/Pom4H/game-engine/actions/runs/36324602596/job/108634810166)
- [Evidence: browser-report.json, 13 PNGs, regressions.log and exact source archive](https://github.com/Pom4H/game-engine/actions/runs/36324602596/artifacts/10933453100)
- [Portable static site](https://github.com/Pom4H/game-engine/actions/runs/36324602596/artifacts/10933597873)

The portable site records the same implementation SHA in build.json. Extract it,
run `node serve.mjs`, open the printed localhost address in a WebGPU browser.
No deployment to game.rom4.ru/docs or main was performed.

## Verified

Engine typecheck/build and **31 DSL tests passed**. Native Chrome 153 on the
self-hosted Windows runner completed **37 browser checks**, with no captured page
exceptions or renderer errors. The report contains the raw inspection, not an
inferred GPU model (adapter identity is unavailable in that report).

The checks cover all 15 editable demos plus:

- HUD exposure -> actual source -> changed canvas pixels; the same physical body.
- Code -> HUD numeric value and renderer material value.
- 25 rapid edits: the last compiled value wins.
- Real mouse label scrub across asynchronous compiler replies preserves DOM input
  identity; Ctrl-Z from a HUD number input restores the gesture's starting source.
- Per-value reset, domain search, color picker, vector component.
- Enum selection changes snowfall. A source-bound checkbox removes actual wing
  parts; undo restores both wings before the takeoff simulation.
- Material/camera/control edits use the live path; a construction change rebuilds.
  Vehicle-control hot edit preserves the evolved body and simulation tick.
- Derived metrics are read-only. Syntax errors disable stale controls without
  deleting the last usable world. A timed-out worker can compile the next program.
- 390x844 viewport fits the parameter panel; tested numeric inputs have >=40px
  height and the source link opens the code pane. This is Chrome mobile emulation,
  not Safari or a physical iPhone compatibility claim.
- Shared source opens without creating a runtime; typing still requires Apply.

PNG `hud-two-way.png` shows the exact code literal, its highlighted matching HUD
row, and the real renderer. Geometry quality is unchanged by this UI pass.

## Regressions retained

Full engine suite: **124 passed / 3 failed / 127 total**. The control snapshot
`2744416386fc486c7df5d4d7a435310567174011`, run 36323370403, has the same counts
and the same three file-qualified failures:

- test/clearcoat.test.mjs:22
- test/clearcoat.test.mjs:28
- test/vehicle-interaction.test.mjs:112

No old test was disabled or weakened. The full workflow remains red because of
those failures, although the native two-way UI acceptance step passed. This is
not certification of every renderer/physics subsystem.

## Earlier failed browser attempt

Run 36324321937 passed the first 33 checks and failed the shared-link navigation
fixture: a hash-only Page.navigate was same-document navigation, not a fresh
page load. The final fixture uses a different query to actually open a new document
and additionally tests that editing imported source does not grant execution.
The failed artifact is retained; it is not described as a successful full run.

## Scope

Reuses existing semantic AST binding IDs, SourceDocument, worker/compiler,
planProgramEdit/applyLiveProgram and BrowserRuntime. No new engine runtime
dependency or alternate renderer/physics implementation. This establishes tested
two-way control behavior, not an FPS speedup, complete thegame demo migration,
BeamNG parity or hostile-code sandbox security.
