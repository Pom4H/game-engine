# Winter street — native engine revision (v3)

This scene records a complete 48-second film of one winter street with a BMW M3, a walking pedestrian, persistent snow impressions, tyre spray and falling snow. Frames come from the production WebGPU renderer at 1920 × 1080; the movie exports 30 frames per second from a deterministic 60 Hz simulation. Capture is offline and does not establish real-time performance at that resolution.

The visual target is the supplied winter-street reference. The current scene uses actual geometry, materials, lighting and engine simulation. Its procedural pedestrian and source M3 still limit realism; neither the documentation nor successful automated checks establish photographic equivalence to the reference.

## Complete edit

| Time | Take | Visible mechanism |
|---|---|---|
| 00–08 | Street arrival | Walker on the right, wet street on the left, snow-covered architecture and warm shops |
| 08–16 | BMW M3 | Imported geometry, coherent rolling wheels, wet contact and native spray |
| 16–24 | Pedestrian | Planted-foot locomotion, terrain-aware placement, articulated winter clothing |
| 24–30 | Boots close-up | Surface compression and the persistent trail created by real foot contacts |
| 30–38 | Snowbanks | Irregular piles, granular material detail and wind-driven falling flakes |
| 38–48 | Evening | The same street under its evening lighting preset, followed by the engine title |

Every take reconstructs the authored scene and advances it to the correct point on the same 48-second timeline. The evening take changes the lighting preset. The glass laboratory and square are absent from this edit; engine glass functionality remains covered by its existing tests.

## Engine and scene ownership

| Concern | Native engine | Scene authoring / movie tools |
|---|---|---|
| Character movement | `AnimationSystem`: timing, stance anchors, terrain sampling, two-bone IK and resulting transforms | Character geometry, garment shapes, joint bindings, starting pose and route parameters |
| Car movement | Native vehicle motion and wheel rotation, physics contact bodies | Imported M3 parts, route velocity, wheel radius and contact bindings |
| Snow contact | `SurfaceContactSystem`, `SnowFootprints`, `SnowSurface`: contact detection, persistent records, bounded adaptive tiles and mesh deformation | Surface IDs, material appearance, optional geometry budgets |
| Water contact | Surface bounds and water-state queries, wheel contact, bounded particle pool and ballistic spray | Authored road/puddle geometry and initial water depth |
| Lighting and materials | WebGPU shading, many-light grid, shadow mapping, reflections, texture loading/sampling/cache ownership | Lamp positions, intensities, material descriptors and image asset URLs |
| Sound | `renderAmbience` and `renderFootsteps`: filtered wet tyres, spatial response and contact-timed crunch | Camera telemetry, mix levels, original score and final film assembly |
| Set and direction | Generic geometry/batching APIs | Building layout, actual shop interiors, initial snow dressing, cameras, cuts and titles |

The complete simulation bindings now live in `SceneSpec.animation` and `SceneSpec.surfaceContacts`. `new Scene(spec)`, scene URL decoding and `BrowserRuntime.reset()` restore the same actors and contacts automatically. Movie playback advances `scene.step()` and reads the results; it no longer runs a parallel gait solver, snow-tile updater or tyre-spray simulation.

A minimal authoring fragment is:

```js
spec.animation = {
  walkers: [{
    id: 'walker', root: [-20, 0.163, 5.02], speed: 0.86,
    bindings: [{entity: 'coat', joint: 'pelvis'}],
  }],
  vehicles: [{
    id: 'car', velocity: [2.65, 0, 0],
    parts: [{id: 'car-body', origin: [-27, 0, -1.4]}],
  }],
};
spec.surfaceContacts = {
  snow: [{surfaceId: 'walk-1', seed: 701}],
  wheels: [{entityId: 'front-wheel-contact', radius: 0.346, lateral: [0, 0, 1]}],
};
```

Referenced entities must exist in the scene. Wheel contacts reference physics bodies; a deformable snow surface references a horizontal environmental box or plane. Validation rejects missing references, duplicate transform ownership, invalid rig joints and geometry budgets. Authored configurations are copied before use. The scene limit is 128 animated actors, 128 snow-surface bindings and 512 wheel bindings. Removing an entity also removes its native animation/contact dependencies.

The engine executes animation before physics, then surface contacts. Footprint geometry and exported footstep sound records share the resulting contacts and timestamps. The film uses one 90-tile snow surface, at most 28 detailed tiles, 256 retained footprint records and 96 spray particles. These are explicit budgets, not an ever-growing collection of decals or particle entities.

## Rendering and materials

- A world-space forward light grid selects lights per fragment, including fragments on large road meshes. The engine supports up to 256 selected point sources and 16 sources per grid cell; overflow is ranked deterministically. Lamp and shop lighting therefore follows actual position rather than the origin of a large mesh.
- The wet road uses a geometry-rendered planar reflection pass with material roughness and water state. Screen-space reflections add visible-scene detail on other reflective surfaces. Off-screen information is limited; this is not a ray-traced global-illumination solution.
- Generic `material.texture` supplies `url`, `sizeM`, `bumpStrength` and `albedoStrength`. The renderer owns asynchronous image preparation, GPU resources, world-space triplanar sampling and image-derived bump detail. Material texture choice remains authored data. HTTP(S) and relative asset URLs are validated.
- `environmental.snowMaterial` supplies the appearance of engine-generated banks and deformable snow. The underlying concrete or asphalt keeps its own material. There is no snow-image path hardcoded in the renderer.
- The street includes physical shop recesses, interior geometry and optical glazing, rounded initial snow deposits, road slush, tapered branches and snow-covered street furniture. Static material/spatial batching preserves dynamic actors, collision/weather identities, lights and transparent geometry.
- Depth-tested snowfall, HDR lighting, shadows, contact occlusion, bloom and tone mapping are native renderer features. The reference image is not used as a backdrop or substituted for captured frames.

## Assets and practical limits

- `assets/m3.json` is converted from the user's local `BMW M3.fbx`, whose SHA-256 is `9c03464b3407ff1ab45cf4b3b913ee108ed454e4d7e5a82da438667af8cc2d67`. It contains 19 material parts, 9,798 triangles and four separate wheels. `m3-provenance.json` retains the source information. Conversion removes authored steering and smooths paint, wheel and tyre normals while retaining the source silhouette. No new third-party download or license assertion is made.
- `import-m3.py` adapts the restricted binary FBX 7400 inspection reader from the user's local TheGame tools. It is an offline converter for this asset.
- `assets/snow-granular.png` and `assets/brick-weathered.png` are AI-generated material images. They were generated with the built-in imagegen tool and are sampled on engine geometry as surface detail. Exact prompts and provenance are saved in `assets/material-provenance.json`. There are no AI-generated scene frames or movie shots in the capture pipeline.
- The M3 remains a low-poly source model. The pedestrian is a procedurally authored articulated model, without a scanned human or motion-capture performance. Garment folds are geometry/material detail; no dynamic cloth solver is claimed.
- Snow uses a local heightfield compression and displaced-rim model, not a full granular-material flow simulation. Vehicle travel follows an authored kinematic route; this movie does not demonstrate a complete driving controller or tyre-force model.
- The wind, engine, tyres, snow crunch and music are synthesized. Footstep timing follows native contact records; the engine sound is not an authentic recorded M3 sample. No third-party audio samples are used.
- Automated verification checks capture completeness and engine evidence. The extracted frames still require visual inspection for framing, lighting, material quality and animation defects.

## Reproduce and verify

Requires Bun, Node 22+, ffmpeg/ffprobe and Google Chrome with WebGPU on macOS. The optional FBX conversion requires Python 3 and numpy. The engine has no additional runtime package dependency.

The same scene can also be opened directly in the production browser runtime,
without the movie player:

```sh
bun run build
node dist/cli.js serve tools/promo/street.scene.mjs
```

`street.scene.mjs` exports only the authored `SceneSpec`. Native playback, reset,
snow contacts and audio are handled by `BrowserRuntime`. The standard CLI serves
only texture files explicitly referenced by the scene, relative to its source
directory; no separate demo asset server is required for this entry point.

```sh
bun run ci
node tools/promo/capture.mjs storyboard
node tools/promo/capture.mjs all
node tools/promo/assemble.mjs
node tools/promo/compare.mjs
node tools/promo/verify.mjs
```

The final movie is `artifacts/promo-v3/game-engine-winter-promo-1080p.mp4`; `winter-street-sounds.wav` contains the scene sounds without the score. A single take can be recorded with `node tools/promo/capture.mjs m3`; a still can be rendered with `node tools/promo/capture.mjs preview footsteps`.

`compare.mjs` requires the preceding complete V2 movie and scene-only WAV under
`artifacts/promo-v2`. It produces `engine-before-after-1080p.mp4`: three pairs of
six-second excerpts, each showing V2 immediately followed by V3 (M3, walking,
then boot contact). This 36-second comparison retains each version's own scene
sound, without music, and adds only explanatory captions. Its metadata records
exact source intervals and hashes. When present, the final verifier checks that
the comparison references the current V3 movie and includes it in the manifest.

The verifier requires all six takes and 1,440 decoded final frames. It checks 1080p/30 fps, 48-second duration, stereo 48 kHz audio, GPU errors, the native animation → physics → surface-contact order, bounded snow/spray state, distinct grounded footstep records, simulation continuity, M3 provenance and wet-wheel activity. Its regression budgets are 2,200 draws and 4 million submitted triangles per inspected frame; the report records actual values rather than claiming these limits as performance measurements.

The verifier extracts the beginning, middle and end of all six takes from the final MP4 into `delivery-qa`. It writes `verification.json` and `capture-manifest.json`, which records SHA-256 hashes of the deliverables and material/model assets, the current Git revision/branch and whether the worktree was dirty when verified. `*-telemetry.json`, `*-footsteps.json` and `*-evidence.json` preserve synchronization and native-engine evidence. Prior captures remain under `artifacts/promo` and `artifacts/promo-v2`.
