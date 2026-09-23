# Live look development

Run `bun run build`, then `node tools/look-dev/serve.mjs` and open the printed
localhost URL. The full commit is visible in the UI and every preset.

This is the ordinary `BrowserRuntime` / `WebGPURenderer`, the original
`tools/promo/city.mjs` street and its native weather/contact/animation systems.
No replacement renderer, reference-image texture or image-generation fallback.
The alternative hero composition is not selected by the look-dev UI.
This does not claim that current rendering reproduces the original MP4 yet.

Change exposure, sun direction/intensity/color, sky color, fog, shadow coverage,
material albedo/roughness/metalness/clearcoat, camera and fixed render resolution.
Only existing engine capabilities are exposed. Shadow coverage is not shadow-map
resolution. There are no cosmetic bloom/GI/SSR sliders disconnected from shaders.
Appearance edits pause simulation and patch the current scene; they do not rebuild
it, run a shader search or submit CI. Lighting/material edits conservatively
invalidate derived radiance caches. Camera/time/scene resets are explicit actions.

**Pin A** stores the chosen preset and its actual PNG (IndexedDB). Draft autosave
is separate and cannot promote itself to approved A. JSON and PNG export are
separate deliberate downloads. Import accepts validated data only, with no code,
URLs or new assets. A preset made by a different engine revision requires explicit
confirmation; startup never silently applies it. `-dirty` local versions are
identified; for a durable reproducible result use a clean committed build.

A/B switches in the same viewport. It is disabled after changing scene, camera,
time or resolution until the user restores A or pins a new baseline. Both
appearance settings and fixed pose/time are exported. Same parameters do not
promise bit-identical images between GPU/driver/browser versions.

A local MP4/image can be opened as a visual reference; the file is never uploaded.
It is explicitly labelled as reference, not a capture of the running engine.

## Publication and verification

The Pages workflow builds the triggering source commit, not the historical
foundation branch. A real-GPU smoke check verifies that moving the actual exposure
slider changes canvas luminance without advancing simulation or moving the camera.
It also checks approval persistence, A/B and renderer errors. `look-dev-proof.png`
and `look-dev-proof.json` contain the actual capture and machine-readable evidence.
This is an integration check, not an aesthetic score, FPS gate or user approval.

Actions artifact storage is not required. The verified static app is committed to
`gh-pages/look-dev/`, preserving history and unrelated published files. No force
pushes, removal of prior evidence, billing changes or automated Pages configuration
changes. When Pages is configured for `gh-pages / (root)`, the publisher explicitly
requests a Pages build and verifies the served manifest revision. If the site is
configured differently, the app remains in that branch and the workflow reports
that the owner must select Settings > Pages > Deploy from a branch > gh-pages /
(root). Its administration settings are never silently changed.

## Preserve quality after approval

Commit the user-exported JSON and matching PNG as an explicit approved baseline,
with the engine revision that produced them. Optimization proposals must retain
that fixed scene/pose/resolution and show before/after images. Do not replace the
baseline automatically because a metric improved. Missing geometry, materials or
lighting effects must be repaired in code; slider tuning cannot recover a missing
rendering capability. No baseline is user-approved by this implementation itself.
Stanford and performance tests remain independent; they do not choose this look.
