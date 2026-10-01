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

The [paired native FHD capture report](../../docs/render-evidence/snowy-arcade-fhd.json) records the same camera and time before/after. Its previews are downsampled to 960 × 540 and encoded as lossless WebP. This is desktop GPU evidence, not an iPad throughput benchmark or a claim of matching a photographic reference.

| Before | After |
| --- | --- |
| ![Before](../../docs/render-evidence/snowy-arcade-fhd-before.webp) | ![After](../../docs/render-evidence/snowy-arcade-fhd-after.webp) |
