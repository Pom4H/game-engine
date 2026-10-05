# Speech and facial-motion laboratory

The native voice is still experimental. These changes do not replace the
accepted VTL scene or establish Half-Life 2 visual quality.

## Continuous facial surface

`FaceSurface` uses the CC0 MakeHuman head data in `src/assets/face-reference.ts`,
with our own boundary labels, sparse geodesic binding and procedural flexes.
The mouth, eyelids, cheeks, chin and brow skin deform together. The two winter
characters retain separate identities and independent left/right expressions,
gaze and deterministic blinking. No Valve program code or assets are included.
See `licenses/face-reference.md` for the exact source and regeneration command.

The actual lip-loop polygon, not a hidden proxy ellipse, preserves the terminal
acoustic area under asymmetric smiles, rounding, actor scaling and closure.
The tea choreography now attaches the cup rim to the evaluated lower-lip vertex
rather than a guessed head-local point. This is still authored acting/IK and a
reduced acoustic model, not a full skin/tongue/airflow soft-tissue simulation.

`MeshStream` owns one fixed topology and reuses position/normal arrays. WebGPU
updates existing buffers by revision, recomputes bounds and retains the last
presented deformation for motion vectors. Multi-pass rendering does not upload
the same pose repeatedly. Removing a scene releases those buffers and invalidates
stale identity entries. Static primitives do not gain another GPU allocation.
Memory diagnostics report **typed-array bytes**, not a fabricated total of all
JavaScript, renderer and GPU memory.

The anatomical surface has 3,216 vertices / 6,258 triangles per head. It is a
CC0 data-backed model, not a head generated entirely from equations. Reference
positions are quantized; all motion is calculated at runtime in TypeScript.

## Fixed speech corpus

`tools/speech-lab/corpus.mjs` defines 24 immutable cases for each of two voices:
15 consonant/vowel syllables, five minimal-pair words, four short phrases.
Pitch, pressure and timing are held fixed for the syllable contrasts. Nonsense
syllables are acoustic diagnostics, not expected English transcripts.

```
bun run build
node tools/speech-lab/render.mjs
python3 -m pip install faster-whisper==1.2.1
python3 tools/speech-lab/recognize.py artifacts/speech-lab
```

Recognition sees no transcript prompt and no previous-case decoder context.
It reports all 18 real-word/phrase clips; the transcript is used only after
recognition to calculate edit distance. The 25% WER gate is not weakened.
The complete 42-second native dialogue remains a separate regression check.
Passing topology/physics tests is not passing speech intelligibility.

A silent motor state now closes its terminal lip section while lung pressure
is zero, rather than leaving the face in an open-schwa pose. This is a common
acoustic/visual articulation change, not a render-only mouth-closing override.

## Visual inspection

```
node tools/tea-performance/serve.mjs
# Open /tools/face-lab/player.html on the printed local origin.
```

The 14-second laboratory animates both faces with the same fixed pronunciation
cases, superposed smiles, surprise, a smirk, gaze shifts and blinking. It is
**muted** until speech intelligibility is accepted. Pause/replay is available.
The existing longer winter tea performance also uses the new continuous face.

For a real GPU capture, set `CHROME_PATH`, `TEA_REQUIRE_HARDWARE=1`, and run:

```
node tools/face-lab/capture.mjs
```

`FACE_LAB_OUTPUT` controls the output directory. The capture records the actual
adapter, source commit, PNG/video hashes, pose data and GPU resource counts.
Software WebGPU may be used only as explicitly labelled shader/geometry
validation; it is not evidence of hardware throughput or a passed hardware gate.
