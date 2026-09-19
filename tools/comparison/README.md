# Full architecture comparison film

156 seconds (2:36), 1920×1080, 30 fps, Russian synthetic narration and procedural
simulation audio. Eight immediately adjacent before/after pairs cover the seven
primary findings of the PR #1 review. Baseline: `89b232adad8c09b84d2849d7641248af0dc8832b`.

## Coverage and timing

| Review finding / experiment | Before | After | Evidence |
|---|---:|---:|---|
| Horizontal contact bypasses fracture | 00:06 | 00:15 | Same impact: intact glass vs 44 shards |
| Fragments lose parent momentum | 00:24 | 00:33 | Horizontal momentum, before/after fracture |
| Horizontal contact ignores effective friction | 00:42 | 00:51 | Two coefficients, measured slider distances |
| Kernel is disconnected from Scene.step | 01:00 | 01:09 | 30 Hz extension: calls and resulting body displacement |
| Commands are invisible to later phases | 01:18 | 01:27 | Actual producer command, commit count and publish read |
| Winter traffic state is global and proximity-based | 01:36 | 01:45 | Surface state maps, contact and airborne controls |
| Renderer retains removed resources | 01:54 | 02:03 | Live entities and owned GPU buffer counts |
| Scene validation accepts invalid body/mesh data | 02:12 | 02:21 | Three real validation calls and field errors |

Intro 00:00–00:06; results 02:30–02:36. Contact/friction experiments jointly cover
one review finding, so there are eight experiments for seven findings.

## What actually runs

The player imports Scene/EngineKernel/validateScene from the baseline or current
build, with matching scene specs, seed and 60 Hz time step in each pair. Commands,
field data, resource counts and errors come from that code; they are not animated
mock results. GPU load injects 20 uniquely sized temporary boxes, on the same tick
schedule, and lets each Scene remove them after 0.12 seconds. For the kernel case,
the old version can register an isolated EngineKernel module but has no Scene.use
hook; the new version registers the same module on Scene. No explicit kernel.run
is added to the old Scene loop, which is the disconnection being demonstrated.

The phase probe starts with value=0, simulate returns set(value,1), and publish
reads the context. The old kernel ignores the extra commit option; the new kernel
applies it between batches. This is an observable integration/API comparison.

Both physical simulations use the same corrected production WebGPU renderer to
isolate physics. It removes phantom snow/puddles at zero environmental state.
Only the GPU lifetime chapter switches to each version's own renderer, because
that chapter measures renderer ownership. Snow state maps have one fixed color
scale (trackMelt 0..0.002); the baseline's single scalar is repeated across cells
for a comparable map, explicitly labeled on screen. The new map is the actual
24×7 field. The renderer also reads that field and horizontal contact friction
samples it at the contact location.

Each 9-second segment holds its initial state for 2.6 seconds, shows 4.5 seconds
of slowed simulation and then holds its result. GPU graphs sample actual cache
counts each recorded frame, including the holds. Diagnostic chapters use
narration; impacts and fractures have sound synthesized from captured events.
Sound event onsets follow slowed time, but individual sounds retain their pitch.
There is no background music. Narration uses macOS Milena, a synthetic voice.

## Implementation boundaries

- Built-in modules schedule the weather, winter, physics, events, fracture,
  cleanup and clock services. Scene remains their state owner and command reducer;
  this is not an ECS or worker-thread rewrite. Third-party modules return spawn,
  remove, velocity or resource commands and consume detached read snapshots.
- Same-phase resource hazards require an explicit `after` dependency. Commit runs
  after command-producing batches. Nested DTOs are frozen; Maps/Sets disable their
  normal mutators. This is a programming contract, not a hostile-plugin sandbox.
- Winter is a bounded grid (at most 64×64 per surface) for the existing horizontal,
  axis-aligned surfaces. Supported sliding work is estimated from load, friction
  and speed; the contact tolerance is 2.5 cm. This is not a calibrated tire or heat
  transfer solver. Airborne bodies at a one-metre gap contribute zero work.
- GPU counters count renderer-owned live resource handles, not driver memory in
  bytes. Shared geometry survives while referenced. Removal destroys buffers and
  field textures; driver reclamation timing is outside the engine's control.
- Snapshots are diagnostic state, not full rollback checkpoints. This change does
  not introduce a replay protocol, event subscription bus or worker backend.

## Reproduction (macOS)

Requires Node 22+, Bun, Google Chrome, ffmpeg/libx264/AAC and `say -v Milena`.
Build the baseline worktree at the exact commit above before recording.

```sh
bun install
bun run ci
node tools/comparison/scenes.mjs
node tools/comparison/metrics.mjs /absolute/path/to/baseline-worktree
node tools/comparison/capture.mjs /absolute/path/to/baseline-worktree preview
node tools/comparison/capture.mjs /absolute/path/to/baseline-worktree all
node tools/comparison/verify.mjs
node tools/comparison/assemble.mjs all
```

Outputs: `artifacts/comparison/emergent-engine-full-comparison-1080p.mp4` and
`emergent-engine-full-effects-only-1080p.mp4`. The second has no spoken commentary,
so the diagnostic chapters are intentionally quiet. Per-segment `*-events.json`
and `*-evidence.json` contain captured browser evidence. `chapters.json` contains
the narration and timecodes. The older 66-second physical-only film is retained.

The test suite has 24 tests, including scene extension cadence, phase visibility,
ambiguous hazards, nested mutation, invalid authoring input, localized supported
winter work, cache destruction, contact laws and fracture conservation. Original
winter assertions now inspect the contacted and untouched cells rather than
requiring an entire road to acquire one large scalar track value.
