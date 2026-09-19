# Winter City — engine film

A reproducible procedural city sequence and a short engine promo, captured from the actual WebGPU renderer. The capture evaluates fixed simulation ticks and exports one fully rendered frame at a time. The delivery frame rate is **30 fps**; it is not a claim that this scene renders interactively at 30 fps on every device.

## Deliverables

- `artifacts/promo/winter-city-scene-1080p.mp4`: 27-second city reel (street, snow close-up, evening).
- `artifacts/promo/game-engine-winter-promo-1080p.mp4`: 64-second promo, seven continuous shots, stereo soundtrack and final engine title.
- `artifacts/promo/*-evidence.json`: GPU diagnostics for each complete take.
- `artifacts/promo/*-events.json`: simulation events, including the material fracture.
- `artifacts/promo/*-telemetry.json`: camera/vehicle transforms for spatial audio.
- `artifacts/promo/*-{start,mid,end}.png`: camera path review frames.

## Reproduce

Requirements: Bun, Node 22+, ffmpeg/ffprobe, Google Chrome with WebGPU on macOS. There are no downloaded media assets or runtime dependencies. Chrome's path is currently macOS-specific in `capture.mjs`.

```sh
bun install
bun run ci
node tools/promo/capture.mjs storyboard
node tools/promo/capture.mjs all
node tools/promo/assemble.mjs
node tools/promo/verify.mjs
```

Capture a single take with `node tools/promo/capture.mjs material`. Preview one scene with `node tools/promo/capture.mjs preview snowbank`. `player.html` is served by the capture script, importing the production `dist` entrypoints. All seven shots and their camera paths are declared in `shots.mjs`; city geometry is in `city.mjs`, vehicle lofts in `vehicle.mjs`, the material experiment in `laboratory.mjs`.

## What changed in the engine

- A continuous snow-bank primitive with grounded edges, coherent world-coordinate joins, irregular crests and finite-difference normals. Curb snow depth controls the bank height, quantized to avoid regenerating geometry at every simulation tick.
- Indexed authored meshes, tapered cylinders and toruses for original procedural cars, trees, wheels and street furniture. Runtime geometry is copied and frozen so cached geometry keys stay valid.
- Correct outward normals for polygon prisms on every extrusion axis, and inverse-transpose handling of normals under nonuniform scale.
- HDR lighting, directional shadow mapping, GGX material response, 4x MSAA, depth/normal screen-space occlusion, subdued bloom, atmospheric haze, ACES tone mapping, optional depth of field and a planar reflection pass for icy roads.
- Procedural brick, plaster, window treatment and text labels. Snow particles have world-space sizes. These are procedural surfaces, not scanned photographic textures.
- Fresnel-dependent transparency for glass; fracture fragments preserve authored roughness, metalness and emission.
- Shared neutral field/label textures, collection of unused label textures, cleanup of replaced render targets and immutable mesh-key caching.
- Lazy public module snapshots: internal command-only stages declare `context: 'none'`; external modules retain detached immutable contexts with committed state. This avoids cloning thousands of entity transform snapshots for each internal phase.
- `renderAmbience`: deterministic wind, vehicle harmonics and tyre noise, using camera-relative stereo, distance attenuation and a bounded Doppler approximation. Impact and fracture audio still comes from the engine's material event synthesizer.

## Direction and technical provenance

| Time | Shot | Visual purpose |
| --- | --- | --- |
| 00:00–00:10 | Arrival | Human-height approach, depth and scale of the street |
| 00:10–00:18 | Snow bank | Low camera, snow silhouette, toe detail and ice reflections |
| 00:18–00:28 | Passing car | Camera follows the moving source; rotating wheels and spatial audio |
| 00:28–00:37 | Winter square | Quiet fountain, benches, branches and a background of city blocks |
| 00:37–00:46 | Blue hour | Warm local lights, cold ambient light and snow particles |
| 00:46–00:53 | Material study | Actual impact/fracture at 0.25 simulation speed, labelled on screen |
| 00:53–01:04 | District | Continuous rise above the street and closing title |

The city's initial snow, ice, accumulated roof snow, old shoe prints and plough fragments are authored starting conditions/dressing. Vehicle movement is a directed kinematic path: contact bodies participate in winter simulation, while the visible assembly follows them and the wheels rotate by travelled distance. They are not an autonomous traffic system. The material study uses an unforced dynamic body and the engine's contact/fracture logic; it does not schedule fragment animation.

The soundtrack is generated locally: spatial procedural ambience, material events and an original sparse harmonic score. There are no third-party recordings, music, stock video, generated-image frames or external 3D assets. Renderer design ideas were cross-checked against the local TheGame project (`src/game/runtime/render.js`, `src/game/render/webgpu-renderer.ts`, `src/game/render/visual-state.ts`); no source code or assets were copied from it.

## Visual review and scope

Successive actual renderer screenshots were reviewed and used to fix floating snow edges, inward prism normals, oversized brickwork, mirrored signs, flat snow floating over car hoods, a camera entering a wall, overly sharp road reflections, an empty city vista, a lamp intersecting a bench and a foreground pole obstructing the square shot. Final review samples the start, middle and end of each camera move and extracts frames from the encoded delivery.

This is still a procedural engine demonstration, not photographic footage. The models remain simplified; planar reflections and ambient lighting are approximations, with no path tracing, volumetric snow transport or physically refracted glass. Snow-bank geometry visualizes the winter field; it is not a volumetric snow solver. The current large city is approximately 7,100 visible objects and 1.13 million triangles; the square is larger. Geometry instancing, view culling, asset LOD and scanned assets would be subsequent work for fidelity and interactive performance.
