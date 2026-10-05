# Native speech / expressive winter tea performance

**Experimental; not a replacement for the accepted VTL scene.** The TypeScript
synthesizer generates deterministic audio, but the complete dialogue currently
fails independent speech recognition. The scene contracts pass; its new faces
and cinematography still require a completed hardware render and visual review.

## Continuous skin and fixed speech lab

The experimental branch now uses a single CC0 anatomical skin mesh with our
own procedural flexes, shared acoustic lip area, and a real lower-lip contact
attachment. It replaces the earlier independent lip/brow pieces in this
experimental scene only. See `../face-lab/README.md` and the fixed 48-clip speech
laboratory. Historical ASR/render statuses below describe their pinned commits,
not validation of the new skin. Native intelligibility is not yet accepted.

## What is implemented

`src/audio/native-speech.ts` compiles pronunciation, coarticulation, pressure and
pitch into `VocalMotorFrame`. The frame contains the 44-section oral area function,
nasal port and visible mouth aperture in explicit units. `NativeSpeechStream`
produces samples in arbitrary-sized blocks without resetting phase, turbulence
or the absolute clock. It calls `src/audio/native-tract.ts`, a native TypeScript
44-section oral / 28-section nasal pressure-wave network. No C++, VTL process,
WASM, neural speech or audio samples are used by this path.

`src/animation/expressive-face.ts` projects the same motor frame into the mouth.
The elliptical mouth aperture has the same area as the terminal acoustic section,
including actor scale. This does not claim that the complete visible tongue and
skin mesh is the authoritative three-dimensional acoustic boundary. Editing an
arbitrary render vertex does not change the sound.

Independent left/right expression layers drive eyebrows, mouth corners and eye
narrowing, while gaze and deterministic blinking remain separate. The two heads
have different jaw/chin/cheek geometry, noses, ears, eye colours, and seeded skin
detail (stubble or freckles). The layering principle was informed by Valve's
public Source facial-animation implementation, not by copying Valve models,
assets, code or animation curves:

- https://github.com/ValveSoftware/source-sdk-2013/blob/master/src/game/client/c_baseflex.cpp
- https://github.com/ValveSoftware/source-sdk-2013/blob/master/src/game/server/baseflex.h

This is not a port of the complete Source flex/blendshape system, and matching
Half-Life's visual quality has not been established.

## The scene

`scene.mjs` and `stage.mjs` reuse the original winter-city block and pedestrian
clothes. A single scene plugin advances the whole performance at 60 Hz. The
42-second script has thirteen turns, fifty-five English words, and twelve shot
identities. Anna warms her hands, accepts tea confidently, takes a sip, recoils,
teases Mike, suggests going inside, and carries the cup toward the shop.

The choreography, hand targets and teapot stream are authored; arm/leg poses
use the existing two-bone IK. This is not a dynamic fluid simulation or a full
biomechanical simulation. Cup ownership is `table -> mike -> both -> anna`.
All moving geometry is explicitly registered with the scene render partition.

Pronunciation is a hand-authored, limited dictionary. Unknown words fail rather
than silently producing arbitrary phonemes. This is not a generic English TTS
front end.

## Synthesis and playback

From a checkout of this branch:

```sh
bun install --frozen-lockfile
bun run typecheck
bun run build
node tools/tea-performance/audio.mjs
node tools/tea-performance/serve.mjs
```

The server prints the local player URL. The WAV is generated in TypeScript;
Python is needed only for the independent ASR tests and research-table importer.
The player synchronizes fixed simulation steps to the audio playback clock.

Default output: `artifacts/tea-performance/` containing `dialogue.wav`,
`plan.json`, `speech-evidence.json`, and `expected.txt`. `TEA_OUTPUT` selects a
different directory. Audio quality is experimental; the file is not presented
as a natural or fully intelligible NPC voice.

## Hardware render

The `Tea Performance` workflow follows the existing self-hosted runner selector
and rejects software WebGPU adapters. It first executes the complete-scene
contract tests, then captures eight inspection views. A workflow dispatch with
`mode=video` records the full 42-second performance.

For the established Windows rendering machine:

```powershell
$env:CHROME_PATH = "$env:ProgramFiles\Google\Chrome\Application\chrome.exe"
$env:TEA_REQUIRE_HARDWARE = '1'
$env:TEA_WIDTH = '960'
$env:TEA_HEIGHT = '540'
$env:TEA_FPS = '20'
$env:TEA_OUTPUT = "$env:USERPROFILE\game-engine-renders\tea-performance\local"
node tools/tea-performance/audio.mjs
node tools/tea-performance/capture.mjs storyboard
node tools/tea-performance/capture.mjs video
```

Capture writes directly to the specified local directory. There is no GitHub
Actions artifact or release publishing. Small review previews in the hardware
job log come only from actual captured engine PNGs. Evidence records source
commit, adapter, image/video hashes, motor-plan hash and scene telemetry.

A queued GPU job is **not** a passed render gate. No new MP4 should be called
verified until its real output has been inspected.

## Independent evidence and unresolved work

At commit `21a2e3bb490aa5d6b9b4b6c690ab570e7c701a3c`:

- Native speech physical/reference suite: 15/15 passed. Build/typecheck passed.
- Full-recording unprompted Whisper `base.en`: WER **0.9272727273**, above the
  unchanged maximum of 0.25. Recognized text is not a usable dialogue.
- The 42-second performance contract job passed; the self-hosted hardware job
  had not acquired a runner at the time this status was recorded.

Evidence:

- https://github.com/Pom4H/game-engine/actions/runs/37241774682
- https://github.com/Pom4H/game-engine/actions/runs/37241774655

`diagnose-asr.py` additionally recognizes every turn independently with no prompt
and no previous-turn decoder context. It uses the transcript only after decoding
to measure errors. This diagnostic does not replace or loosen the whole-recording
gate, and every turn is reported, including failures.

Numerical checks cover pressure-free silence, passive scattering, propagation
speed, block parity, immutable plans, finite output, measured open vowel areas,
and acoustic/visible aperture equality. Scene checks inspect all 2521 fixed-tick
states for finite poses, invariant limb lengths, held-prop hand contact,
continuous cup ownership, and render-mover registration. They do not establish
subjective naturalness, complete collision-free body motion, or visual fidelity.

Remaining work before replacing the accepted scene: intelligible consonant and
vowel transitions under independent recognition; visual inspection and repair
of the full hardware-rendered performance; stronger geometric tests of the sip,
feet, lips/teeth and moving facial skin; and performance profiling for live audio.

## Physical approximations and data provenance

The glottal cycle is prescribed geometrically; airflow is solved from pressure
and airway impedance. Voice pitch is an input, not an emergent tissue oscillation.
Turbulence is an empirical source, not resolved three-dimensional vortices. The
tract has passive propagation/terminal losses but no complete vocal-wall
admittance model. During changes of area, power-normalized wave coordinates are
preserved: the quasi-static approximation excludes acoustic work by articulators.

Vowel area vectors are numerical MRI measurements from Story (2008), Tables I/II,
DOI **10.1121/1.2805683**, one adult male speaker's 2002 acquisition:
https://pmc.ncbi.nlm.nih.gov/articles/PMC2377017/

`native-vowels.ts` stores all 44 sections for eleven vowels, their published
lengths and calculated formants. The original speaker's pharyngealized/yawny
settings are not universal phoneme anatomy. Normalizing these vectors onto a
voice's fixed tract length is an explicit approximation. Schwa is an authored
mean, not a measured twelfth vowel. The research-only `fetch-reference.py`
retrieves and verifies numerical tables; it is not a runtime dependency and does
not redistribute the article.
