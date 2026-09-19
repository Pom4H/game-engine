# Winter street — M3 revision

A complete 48-second film on one winter street, recorded from the production WebGPU renderer at 1920 × 1080, 30 exported frames per second. This is offline frame capture, not a real-time performance claim. No generated photographic frames are substituted for the engine.

## The film

| Time | Take | Visible mechanism |
|---|---|---|
| 00–08 | Street arrival | Winter city, volume of snowbanks, world-space falling flakes |
| 08–16 | BMW M3 | Imported car geometry, rolling wheels, local puddles and contact-driven spray |
| 16–24 | Pedestrian | Planted-foot gait, winter clothes, persistent trail |
| 24–30 | Boots close-up | Actual deformation of the snow surface after each step |
| 30–38 | Snowbanks | Irregular snow geometry and depth through drifting flakes |
| 38–48 | Evening | The same street in evening light, end title |

The car and walker use a continuous 48-second simulation timeline across cuts. Evening changes the lighting preset. The former glass laboratory and square are absent from the edit; the engine's glass simulation tests remain available.

## Reproduce

Requires Bun, Node 22+, ffmpeg/ffprobe, Google Chrome with WebGPU on macOS. The offline FBX conversion additionally uses Python 3 and numpy. No new runtime packages are needed.

```sh
bun run ci
node tools/promo/capture.mjs storyboard
node tools/promo/capture.mjs all
node tools/promo/assemble.mjs
node tools/promo/verify.mjs
```

Output: `artifacts/promo-v2/game-engine-winter-promo-1080p.mp4`.
A single take can be captured with `node tools/promo/capture.mjs m3`; a still with `node tools/promo/capture.mjs preview footsteps`.

The verifier checks all 1,440 frames, stereo audio, duration, decode errors, GPU errors, complete captures, simulation continuity, footprint counts and wet contact during the M3 take. It extracts the start, middle and end of each shot from the final MP4 into `delivery-qa`.

## Assets and provenance

- `assets/m3.json`: converted from the user's existing local `BMW M3.fbx`, SHA-256 `9c03464b3407ff1ab45cf4b3b913ee108ed454e4d7e5a82da438667af8cc2d67`. The same file was previously used as a reference by the local TheGame project. It has 9,798 triangles and four separate wheels. The offline converter removes authored steering and applies crease-aware smoothing to paint, rims and tyres. It preserves the silhouette and material assignments. Source credit is retained in `m3-provenance.json`; no new third-party download or license assertion is made.
- `import-m3.py` adapts the restricted binary FBX 7400 inspection reader from the user's local TheGame tools. It is an asset-specific offline converter, not a universal FBX runtime loader.
- Street, pedestrian, clothes, snow, footprints and the soundtrack are authored procedurally in this project. No third-party audio samples are used.
- The M3 source is a low-poly asset. Smoothing, material changes and lighting improve its presentation; they do not turn it into a scanned production car model. The pedestrian is a procedural rig, not a motion-captured human.

## Engine changes

- `SnowFootprints`: bounded, immutable contact records. Airborne motion, persistent stance and bare ground cannot create extra marks.
- `SnowSkin` in the scene authoring tools rebuilds only contacted snow tiles. Each stamp depresses the surface approximately 22 mm and displaces a small rim. It is a local deformation model; it does not solve granular snow flow.
- `batchStaticScenery`: opt-in merging by material and spatial cell. It preserves transformed geometry/normals and leaves bodies, weather fields, lights, transparent geometry and local-UV window materials separate. The movie uses roughly 1,100–1,200 draws per visible pass instead of over 6,500 authored entities.
- World-space, wind-driven falling flakes with variable speed and projected physical size, depth-tested against scene geometry.
- Irregular snowbank noise replaces repeated sinusoidal ridges. Contact occlusion is tightened to avoid large halos around boots.
- Initial water depth and horizontal polygon puddle bounds feed actual wet-contact sampling and spray.
- Wet tyre sound uses cascaded low-pass filters and contact-modulated water noise. Footstep impact and snow grains share the exact timestamps used to deform the surface. Sound remains procedural; it is not a recording of an M3 engine.

`*-telemetry.json`, `*-footsteps.json` and `*-evidence.json` preserve the source data for audio synchronization and capture checks. The previous film remains under `artifacts/promo` and is not overwritten.
