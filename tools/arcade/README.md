# Snowy arcade / GPU reference scene

The scene is engine geometry, materials and point emitters. Neither the supplied
reference nor an AI-generated picture is projected into the framebuffer.

```sh
bun install --frozen-lockfile
bun run build
node tools/arcade/capture.mjs
```

Requires hardware WebGPU Chrome (`CHROME_PATH`) and FFmpeg on PATH. The
`Snowy Arcade GPU` workflow selects the Windows x64 self-hosted GPU worker.

`scene.mjs` authors the shops, curving awnings, columns, dormers, Cyrillic signs,
curtains, window displays, lamp, cobbles and snow cover. `textures.mjs` builds
five deterministic 1024px albedo/normal/ORM sets. Snowfall is the engine's native
weather renderer. The two views capture simulation times 3.00 and 3.75 seconds.

Capture uses native 3840×2160, 24 temporal-history warm-up frames and six-face
local reflections. `ARCADE_WIDTH=1920` requests a smaller **native** frame; it
is not an upscaler. The manifest checks the hardware adapter, dimensions, loaded
material maps and WebGPU errors and records CPU/GPU timings. These fixed-camera
capture timings are not a gameplay FPS benchmark.

Outputs are under `artifacts/`. CI also copies them to
`%USERPROFILE%/game-engine-renders/snowy-arcade` and publishes private prerelease
assets tagged with the exact commit. This avoids the exhausted Actions artifact
storage without deleting other projects' evidence.

## Renderer changes

`src/render/fog.ts` adds an analytic, finite-radius single-scattering
approximation from existing point emitters along the camera ray. It is
**unshadowed** and does not model multiple scattering. No extra screen overlay
or scene-specific light identifiers are used. Cloud radiance now follows the
incident night lighting instead of a fixed near-white color.

## Acceptance

An image and successful CI demonstrate a working renderer, not a 1:1 visual
match. Composition, material detail, lighting, snowfall and fog must be reviewed
against the supplied reference separately; artistic approval belongs to the
user. Do not replace this review with test counts or an AI image.
