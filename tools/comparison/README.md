# Before / after physics film

A 66-second, 1920×1080, 30 fps comparison of three physical corrections. Each
case plays the old simulation immediately followed by the corrected simulation.
The baseline is PR #1 commit `89b232adad8c09b84d2849d7641248af0dc8832b`.

## What changes

1. Horizontal glass contacts call the material failure law before the manifold
   solver. Both contact friction and restitution use current body properties.
2. Dynamic fracture transfers authored mass, linear momentum and angular momentum
   into the fragments. Random motion is projected to zero net momentum and uses
   an explicit energy budget. Inertia still follows the backend's box approximation.
3. Horizontal contact friction uses the surface's effective coefficient, so two
   otherwise identical sliders react to their different surface coefficients.

The film is a demonstration of these physical fixes, not a claim that the full
kernel/module refactor or every item in the architecture review is complete.

## Comparison controls

- Exactly the same serialized scene, seed, fixed 60 Hz simulation step and camera
  for both versions of every pair.
- The player imports `Scene` from the baseline/corrected build respectively and
  renders both through the same corrected production `WebGPURenderer`.
- The shared renderer removes an unrelated visual defect: procedural snow and
  puddle masks previously appeared even with no snow/water state. Thus presentation
  does not change between the before and after simulations.
- Footer values and motion traces are measured from the running browser simulation.
  The summary card reports the measured final values in `metrics.json`.
- No collision, fracture or stopping outcomes are scripted in scene files.
- Each nine-second case holds its initial frame for 2.6 s, shows 4.5 s of slowed
  motion, then holds its final state. The displayed slowdown is identical per pair.
- Procedural impact/fracture sounds come from the actual captured simulation
  events. Onsets follow the slowed visual timeline; individual voices retain their
  original pitch and duration. There are no recorded glass samples or added music.
- The narrated version uses the macOS Milena synthetic Russian voice. The
  effects-only version contains exclusively procedural simulation sounds.

## Reproduce on macOS

Requires Node 22+, Bun, installed Google Chrome, ffmpeg with libx264/AAC, and the
macOS `say` command with the Milena voice.

```sh
# Both worktrees must have dependencies installed and dist built.
bun install
bun run ci
node tools/comparison/scenes.mjs
node tools/comparison/metrics.mjs /absolute/path/to/baseline-worktree
node tools/comparison/capture.mjs /absolute/path/to/baseline-worktree preview
node tools/comparison/capture.mjs /absolute/path/to/baseline-worktree all
node tools/comparison/assemble.mjs all
```

Outputs are in `artifacts/comparison/`. `capture.mjs` also accepts a single segment
such as `momentum-after`. Scene specs live in `examples/comparison/` and can be
loaded by the regular engine CLI. The composition player itself has no runtime
package dependencies and uses Chrome DevTools Protocol for frame capture.

## Timeline

| Time | Content |
|---|---|
| 00:00–00:06 | Introduction |
| 00:06–00:15 | Horizontal glass, before |
| 00:15–00:24 | Horizontal glass, after |
| 00:24–00:33 | Moving glass, before |
| 00:33–00:42 | Moving glass, after |
| 00:42–00:51 | Surface friction, before |
| 00:51–01:00 | Surface friction, after |
| 01:00–01:06 | Measured results |

## Validation

`bun run ci` includes the original 13 tests and five new regressions for material
failure on horizontal contacts, effective friction, fracture mass/momentum,
angular/scatter budgets, and finite slab behavior. The recorder checks WebGPU
validation errors after every segment. Event logs are saved next to the clips.
