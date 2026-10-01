# Snowy arcade

`reference.scene.mjs` contains the scene used by the Meshwork worker. The default capture resolution is Full HD, 1920 × 1080, with 24 temporal warmup frames.

```sh
bun install --frozen-lockfile
bun run check
node tools/arcade/capture.mjs
```

Chrome with a hardware WebGPU adapter and ffmpeg must be available. On Windows, set `CHROME_PATH` to Chrome's executable. Set `ARCADE_WIDTH=3840` for a native 4K capture; the scene and simulation are the same.

Each canopy now has one continuous snow shell. Accumulation thins toward steep sides, with a seeded irregular front lip and geometric surface normals. The ground snowpack supplies the street's fine relief; repeated decorative ground clumps and overlapping canopy coatings are removed.

Snowfall uses integer particle seeds and absolute simulation time. It writes alpha-weighted particle velocity into the existing TAA motion target, accounts for camera motion, and avoids a long velocity trail when a particle wraps around the volume. Scene lights and distance fog control its brightness. Independent render workers use `setTimelineFrame(frame)` for matching TAA jitter and `resetTemporalHistory()` before warming a new range.

The live scene follows a closed 90-second camera rail. Position and look-at target are evaluated from simulation time, so different workers agree at segment boundaries. Calling `setCamera` selects a fixed inspection view; a scene reset restores the rail.

Two roads use seeded, bevelled granite setts with actual relief, wet material response and snow in the joints. Five rectangular glass lanterns illuminate the road. Each has four emissive transparent panes, an internal bulb, a square opaque cap and bottom, and metal corner ribs. Rays intersect the glass enclosure: the cap and bottom block vertical light, while the four sides transmit it. The same enclosure profile affects surface lighting, flakes and fog. Single scattering uses a [Henyey–Greenstein phase function](https://pbr-book.org/4ed/Volume_Scattering/Phase_Functions), finite-emitter equiangular samples and attenuation along both light paths. This is a bounded approximation with no volumetric shadows from surrounding buildings. The reflection probe refreshes one face per frame to limit worker load.

The visible fog has independent in-scattered radiance `[0.095, 0.112, 0.13]`, ground extinction of 0.32/m, and exponential height falloff of 0.25/m. The first 2 m are clear; extinction then increases linearly over 16 m along the viewing ray. At camera height 2.55 m, horizontal visibility is about 83% at 8 m, 26% at 18 m, 3.4% at 30 m, and 0.16% at 48 m. This preserves the foreground while the street disappears progressively into the haze. The exact height column is modulated by the integrated distance ramp; the sky, surfaces, flakes and lamp scattering use that same view ramp. Moon illumination remains 0.18. [720p travel evidence](../../docs/render-evidence/snowy-arcade-travel.json) contains hardware captures at 0, 20, 45 and 70 seconds, plus ordered two-worker video playback. These two previews are native 1280 × 720 lossless WebP:

| Start of the route | Far end of the route |
| --- | --- |
| ![Start](../../docs/render-evidence/snowy-arcade-travel-start.webp) | ![Far end](../../docs/render-evidence/snowy-arcade-travel-far.webp) |

The [paired native FHD capture report](../../docs/render-evidence/snowy-arcade-fhd.json) records the same camera and time before/after. Its previews are downsampled to 960 × 540 and encoded as lossless WebP. This is desktop GPU evidence, not an iPad throughput benchmark or a claim of matching a photographic reference.

| Before | After |
| --- | --- |
| ![Before](../../docs/render-evidence/snowy-arcade-fhd-before.webp) | ![After](../../docs/render-evidence/snowy-arcade-fhd-after.webp) |
