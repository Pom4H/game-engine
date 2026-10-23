# Renderer residency cleanup

An entity removed and added under the same ID may stay outside every render
pass. Structural collection must release the old CPU `source` and `material`
references immediately, while retaining reusable GPU allocations. The existing
`uniformReady=false` condition requires preparation before its next draw.
Unchanged entities keep their source, material and prepared uniform identities.

Disposal releases the renderer's scene, collected entity, light, spotlight and
decoded measured-radiance references. Both owned surface-field textures are
destroyed, including the deformation texture. Shared field textures remain owned
by the renderer's global resources; repeated disposal does no additional work.
Switching back to a synthetic environment also releases the old decoded HDR
source, including when the synthetic environment cause is already cached.

`test/render-residency-lifecycle.test.mjs` verifies those boundaries using the
actual renderer methods and a fake GPU device. Together with the existing
material and environment lifecycle tests, all 10 checks passed; the Engine
typecheck passed. These checks establish cleanup and resource ownership. They
do not establish the source of the Game's reported 2.7 GB heap or a frame-rate
improvement.

Appearance-only label changes are now handled separately in `65962bb7`.
Committed GPU objects count ownership of glyph textures by texture identity.
A replacement retains its new binding before releasing the old one; failed
uniform/field/bind/upload allocation preserves the previous committed object.
Shared glyphs survive until the last user releases them. Empty shared fallback
textures are excluded, and an old same-key generation cannot destroy a newer
one. Unchanged prepared objects add no per-frame ownership work.

The actual-method 48-label reproduction retained 25,165,824 bytes before this
fix; after every committed replacement it retains exactly 524,288 bytes.
Seven new lifecycle cases join the existing material/post/environment tests:
65 focused checks pass, with build and typecheck. The offscreen A→B→A check
now explicitly preserves a still-bound glyph, reuses it on return, and verifies
final release rather than expecting premature destruction.

Seven native headless Radeon/RDNA-3 cases compare the unchanged deterministic
scene against `d020079`. All complete 1280×720 PNG, HDR and depth bytes match,
with the same draw calls/triangles and zero GPU errors. A/B labels visibly
differ, so this is not an empty-image comparison. Native label churn retains
13,631,488 bytes before versus 524,288 after; disposal releases all owned label
textures once. This is image/resource evidence, not FPS acceptance.

[Native report](render-evidence/label-lifetime-20261021.json) ·
[shared glyph](render-evidence/label-lifetime-shared-20261021.png) ·
[split glyphs](render-evidence/label-lifetime-split-20261021.png).

Direct public primitive replacements without a structural revision can still
retain older GPU mesh generations until structural collection. That independent
edge is not addressed by changing geometry membership or mutable public
semantics in this patch.
