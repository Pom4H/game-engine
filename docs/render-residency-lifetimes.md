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

Two independent residency candidates remain outside this change: direct public
primitive replacements without a structural revision can retain older GPU mesh
generations until structural collection; appearance-only label changes can keep
older label textures until that collection. Neither is addressed by changing
geometry membership or mutable public semantics in this patch.
