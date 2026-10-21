# Anatomical face reference

`src/assets/face-reference.ts` contains a cropped, axis-scaled and remeshed head
from MakeHuman's bundled `makehuman/data/3dobjs/base.obj`, plus our own sparse
binding and boundary labels. This is numerical graphical data, not application
source code. The procedural expressions and all runtime code are ours.

The character constructor uses a static adaptation of this surface from
`codex/tea-chaos-fast` commit `4703baa9b77c1d95a2959613f179bba83ecb3e77`.
It regenerates geometry on an authored edit; no native speech or runtime mesh
stream is required.

Source: https://github.com/makehumancommunity/makehuman/blob/master/makehuman/data/3dobjs/base.obj

Verified source Git blob: `d26635e9326e3cca30778fd7b9c00062b03cce09`.
Source SHA-256: `8e761e6624b8f54536409135d1636da63b32486a90d4897f84e121d144f6fb4c`.
Source credit: MakeHuman Team.

The bundled base mesh is released under **CC0 1.0 Universal**. The asset license
is reproduced in `face-reference-CC0.txt`. The MakeHuman application's AGPL
program source is not included or linked. Valve assets and program code are not
included either. The separation of speech, expression, gaze and blinking was
informed by Valve's public Source SDK facial-animation design.

The original importer lives at
https://github.com/Pom4H/game-engine/blob/4703baa9b77c1d95a2959613f179bba83ecb3e77/tools/face-lab/build-reference.py.
Rebuild the compact data from the exact reference OBJ with Python, NumPy/SciPy:

```
python3 build-reference.py PATH_TO_VERIFIED_BASE_OBJ src/assets/face-reference.ts
```

The importer checks the original blob before interpreting stable landmarks.
It extracts only the head, retains the outer skin, opens the existing oral/eye
boundaries, matches upper/lower lip samples, and derives geodesic skin weights.
The engine does not download models at runtime. This data-backed anatomical
model is not being represented as a head generated from equations alone.

