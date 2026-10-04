# Winter tea performance

Two instances of the existing winter pedestrian perform the six-turn VTL tea
conversation in the original winter city's shopfront block. The 15.5-second
scene is shared by the browser player, WebGPU capture, and the engine CPU proof.

The sequence establishes eye contact, offers tea, pours it, transfers the cup
through a period of shared hand contact, and finishes with a sip and a smile.
Close cameras show the facial animation; the wider cameras show the actions.

## Generate the audio and capture

```sh
bun install --frozen-lockfile
bun run build
node tools/tea-scene/plan.mjs
```

Build the pinned VocalTractLab backend with the existing
`tools/npc-speech-demo/vtl-anatomy-reference.patch`, as specified in
`.github/workflows/winter-tea-scene.yml`. Then render the score:

```sh
python3 tools/npc-speech-demo/vtl-dialogue.py \
  /path/to/libVocalTractLabApi.so /path/to/resources/JD3.speaker \
  artifacts/tea-scene/plan.json artifacts/tea-scene
```

Use an installed Chrome/Chromium executable for the full WebGPU renderer:

```sh
CHROME_PATH=/path/to/chrome TEA_BACKEND=webgpu \
  node tools/tea-scene/capture.mjs video
```

`TEA_SOFTWARE_GPU=1` explicitly selects SwiftShader when the browser includes
it. Evidence distinguishes software and hardware adapters. A hardware-only
run can set `TEA_REQUIRE_HARDWARE=1`.

The engine CPU renderer is available without a browser:

```sh
node tools/tea-scene/capture.mjs video
node tools/tea-scene/capture.mjs storyboard
TEA_PREVIEW_TIME=10.8 node tools/tea-scene/capture.mjs preview
```

The default capture is 960 × 540 at 30 fps. Set `TEA_WIDTH`, `TEA_HEIGHT`, and
`TEA_FPS` for another size/cadence. Supported frame rates divide the fixed 60 Hz
simulation clock. The CPU proof uses the same geometry and animation, with the
CPU renderer's simpler shading. Final visual review should use WebGPU.

Files are written to `artifacts/tea-scene`, or to `TEA_OUTPUT`. For the existing
Windows render machine, an output directory can remain local:

```powershell
$env:TEA_OUTPUT = "$env:USERPROFILE\game-engine-renders\winter-tea-latest"
$env:TEA_BACKEND = "webgpu"
$env:CHROME_PATH = "C:\Program Files\Google\Chrome\Application\chrome.exe"
node tools/tea-scene/capture.mjs video
```

Outputs include `winter-tea-scene.mp4`, `poster.png`, and `video-evidence.json`.
The soundtrack is padded through the closing action. Rendering does not depend
on GitHub release or artifact publishing.

To play the same scene interactively after generating its audio:

```sh
node tools/tea-scene/serve.mjs
```

Open the printed local URL (port 4173 by default, configurable with `TEA_PORT`).
The player has play, pause and replay controls. Audio starts only after a click;
the audio clock also advances the shared fixed-step scene.

## Timing and ownership

- `plan.mjs` reuses `createVtlDialoguePlan()`. Only scene placement and stereo
  orientation change: a one-second introduction and an additional 1.8 seconds
  before the final two lines allow time to pour. The original six utterances,
  physical voices, phone durations, and prosody stay unchanged.
- `ConversationFaceRig` reads that plan's actual phoneme intervals. It supplies
  coarticulated closure, rounding, width and jaw targets with damped motion,
  independent blinks, gaze and expression. The head is modelled at the existing
  pedestrian's metre scale; curved eyelids deform with fixed outer attachments.
- `scene.mjs` is an authored performance, executed by a 60 Hz scene plugin.
  Gesture paths, small torso shifts and head attention feed the existing
  two-bone IK solver. The same head frame moves the face, hat and nose.
- The cup has one performance owner and passes through
  `table → mike → both → anna`. It is not registered to two actor skeletons.
  `ScenePlugin.renderMovers` declares visual outputs so moving features and
  props remain in the renderer's moving partition without artificial bodies.
- Camera changes happen inside the shared scene. The browser resets temporal
  history when the authored shot changes.

## Verification

```sh
bun run typecheck
bun run build
node --test test/animation.test.mjs test/kernel-depth.test.mjs \
  test/vtl-dialogue.test.mjs test/conversation-face.test.mjs \
  test/tea-scene.test.mjs
```

The performance tests inspect all 931 simulation states, visible sleeve
endpoints, invariant limb lengths, planted feet, cup/teapot grip contact,
continuous handoff, pouring alignment, actual cup-rim contact during the sip,
real mouth aperture under an injected
phoneme plan, and render-mover lifecycle. These checks complement visual review;
they do not measure subjective acting quality.

The `Winter Tea Scene` workflow rebuilds the physical voices, renders the entire
scene with the engine CPU backend, and checks the video/audio streams, frame
count, renderer errors and source hashes. Capture evidence records the actual
renderer and adapter, source hashes, motor-plan/audio hashes and scene telemetry.
