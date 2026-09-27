# Two-way HUD controls

The parameter HUD is a projection of the TypeScript document. An input edits its
AST literal range; the compiler then updates the same live engine. There is no
second writable settings object. `BoundControls` only holds DOM bindings and a
small reset baseline for the opened document.

## Interaction

- Numeric values: slider plus direct number entry. Drag the underlined label with
  a mouse to scrub; Shift makes the step 10x finer, Alt 10x coarser. Enter finishes
  number entry. One continuous scrub uses one undo transaction.
- Vectors: individual x/y/z inputs. Colors: picker preserving existing alpha.
  Enums and composition switches use select/checkbox controls.
- Search accepts the displayed label, domain group, source key or part context.
  Clearing search restores which groups were open. The counter shows visible/all.
- Each row displays its owner/source path, a source-line link and a per-value
  reset to the document's opening value. Selection in code highlights the row.
- Ctrl/Cmd Z and Shift-Z work from code and HUD. On a phone, the line link opens
  the code pane; numeric/touch controls have 40px targets.

The existing semantic binding IDs are reused. Keyed reconciliation leaves input
nodes attached across worker replies, preserving pointer capture and caret.
Vector edits patch only changed components. Referenced constants keep their
spelling and comments when not edited; shared scalar/vector values are rebased
immediately so fast consecutive edits cannot restore a stale component.

Computed expressions remain read-only. A control never replaces `base * scale`
with its current result. Syntax errors disable stale controls and keep the last
valid world. Source from a shared link/file requires Apply, including after typing.
Worker cancellation invalidates queued requests when selecting another document.
This is an editor for trusted code, not a sandbox for hostile mods.

## Live versus rebuild

Rendering optics, camera, paint and vehicle controls use the existing hot patch:
physical identity, clock and evolved wear are preserved. Geometry, mass, springs,
composition and environmental initial conditions explicitly rebuild the experiment.
Removing optical fields/changing alpha also uses the conservative rebuild path.
The HUD displays which operation occurred.

Contact forces, wear, compression and timings are diagnostics, not editable author
inputs. The diagnostics tab links back to the same parameter HUD. Physics outputs
are not continuously written into initial values in the TypeScript document.

## Reproduction

```sh
bun install --frozen-lockfile
npm install --prefix tools/docs --ignore-scripts
bun run docs:test
bun run docs:build
bun run docs:qa
```

`docs:qa` uses actual native Chrome/WebGPU and the production editor paths. It
checks source/DOM changes, canvas pixel differences, physical identity, pointer
scrubbing through asynchronous compilation, undo, search, colors, vectors,
composition, mobile layout and explicit approval of imported code. Screenshots and
reports are in `artifacts/dsl-playground/`. The workflow also retains the exact
source archive and full regressions even when a check fails.

No new engine runtime dependency, new physical model, render-quality improvement,
whole-game FPS claim or complete thegame migration is implied by this UI change.
