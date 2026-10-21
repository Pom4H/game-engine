# Explicit renderer canvas target

`WebGPURenderer.createForTarget(target, options)` accepts an `EngineCanvasTarget`
from `@rom4/game-engine/browser` (also exported by `render/webgpu`). It creates
the same renderer and pipelines as `create(htmlCanvas, options)`.

```ts
const viewport = {cssWidth: 1280, cssHeight: 720, pixelRatio: 1};
const renderer = await WebGPURenderer.createForTarget({
  canvas: transferredOffscreenCanvas,
  viewport,
  assetBase: hostDocumentBaseURI,
  createLabelCanvas: (width, height) => new OffscreenCanvas(width, height),
});
```

The host owns the stable, mutable `viewport` object. Update it before rendering
or calling `resize()` when the CSS viewport or pixel ratio changes. The original
pixel-ratio clamp to `[1,2]`, dimension rounding, and `setResolution()` behavior
remain unchanged. The explicit target never reads `window`, `document`,
`devicePixelRatio`, or CSS canvas properties. The existing HTML `create()` entry
point keeps its lazy CSS/DPR reads and canvas defaults.

An optional `assetBase` resolves material fetch URLs against the host document's
base URI, including when a worker module is served from a different directory.
Only the URL passed to `fetch` changes; texture cache keys, retention, and error
messages retain the authored URL. The HTML adapter captures `document.baseURI`;
an explicitly constructed `SurfaceTextures` without a base keeps its original
fetch arguments.

`createLabelCanvas(width,height)` must return a real Canvas2D surface of the
requested size. The engine retains the existing raster commands: 1024×128,
58px Georgia, centered text, middle baseline, and the same color conversion and
940px maximum text width. Fonts must be ready in the rendering realm before
labels are requested. The factory changes the backing surface, not typography.
Use a bounded font-load/check barrier in a worker, and verify the actual glyph
raster against the host before transferring a visible canvas. In the preserved
Chrome 156 startup probe, the specific Georgia `fonts.load()` completed while
`self.fonts.ready` remained pending; an unbounded wait on that promise prevented
renderer startup.

This API does not move the renderer to a worker by itself. The application owns
OffscreenCanvas transfer, worker lifecycle, viewport messages, scene admission,
and scheduling. Input, audio, pointer controls, and `BrowserRuntime` remain host
responsibilities. A render worker can still miss its frame deadline through its
own allocations, driver work, or GC; this target abstraction is not a 60fps or
freeze-free guarantee. Native HTML/Offscreen image and glyph comparison is a
separate verification requirement.

The [native record](render-evidence/canvas-target-20261022.json) compares an HTML
canvas with an actual transferred OffscreenCanvas in a DedicatedWorker on AMD
RDNA3 / Chrome 156. Eight case pairs match complete PNG, HDR, depth, geometry and
draw counts: dry, wet/night, mirrored, rebased, overlapping pages, real Georgia
labels with four image-material channels, and 640×360 → 1280×720 resize. Both
524,288-byte glyph rasters and text widths match exactly; the long supported
label exercises the existing 940px fit. The [worker image](render-evidence/canvas-target-20261022.png)
shows the rendered labels. The five canonical cases also match retained prior
outputs. All checks report zero GPU/runtime errors.

Relative, root-relative and absolute HTTP URLs are tested through authored
Scene materials. Blob loading is tested separately through `SurfaceTextures`;
the existing Scene schema still rejects blob asset URLs. Raw successful and
failed attempts, exact bundles, cleanup and reproduction scripts are preserved
locally in `artifacts/canvas-target-native-20261022`; final attempt `r6` passed.
The full Engine check passed 1,041 tests with 19 skips and no failures. These are
compatibility and correctness proofs, not whole-game frame-time measurements.
