# Immutable material-prism pose reuse — 2026-10-28

The actual two-car chassis CPU sample attributed5.03% of its self time to `Object.freeze`, entirely below `worldTriangle`, and9.57% inclusive time to that world-prism builder. This change addresses that independent geometry cost; it does not replace the structural solver or establish whole-frame/GPU performance.

`compound.ts` now captures the nine local material coordinates, physical thickness and three support IDs together. A changed material face first uses the predecessor world-corner construction, with the same scalar quaternion arithmetic but without temporary vector arrays. Its local normalized prism is prepared lazily only if the same material shape later needs another rigid pose. Thus continuously deforming sources do not pay for both a local and a world reconstruction on every publication.

Unchanged material geometry reuses its local face/edge directions under rigid motion. Pure translations additionally share already-frozen world directions. The public world prism, its vectors, plane records, bounds and support IDs remain immutable snapshots. In-place changes to any coordinate, thickness or support ID invalidate the proper generation; old query snapshots remain unchanged. Custom point transforms, unnormalized quaternions and material faces near world-coordinate precision limits retain direct world-corner construction. The latter prevents a sub-resolution face from surviving numerical collapse merely because its local reference is valid.

The original builder remains only in `test/fixtures/world-triangle-before-local-cache.mjs` as an independent predecessor oracle. It is not imported by production.

## Executed validation

`bun run typecheck` and `bun run build` passed. The focused command below passed52 tests/0 failures, including the existing structural strain/energy and contact tests:

```text
node --test test/world-triangle-local-cache.test.mjs test/triangle-prism-contact.test.mjs test/compound-ray-cache.test.mjs test/compound-query-reentry.test.mjs test/compound-query-filter-range.test.mjs test/structural-solid-contact.test.mjs test/structural-contact-volume.test.mjs test/structure-stress.test.mjs test/structure-bending.test.mjs
```

The four added regressions compare predecessor/current SAT, ray and rounded sphere results over240 rotated/translated/mutated sheet states at metre/millimetre/micrometre scales; verify immutable geometry and support IDs through nested queries and source edits; preserve custom/nonrigid/sub-resolution behavior; and compare a real rotated sheet impact. That impact has actual contacts, unchanged predecessor motion within1e-9 and no kinetic-energy growth above its initial24J. The log is `artifacts/world-triangle-local-cache-tests.log`.

## Component work and timing

`bun tools/qa-world-triangle-cache.mjs` executes seven alternating predecessor/current pairs of1,000 poses of the same24-face chart. Final median paired time ratios are:

| Input | Current/predecessor time |
| --- | --- |
| Rigid rotation |0.832|
| Pure translation |0.583|
| New material coordinates on every pose |0.915|

The shared host was doing other development work, and individual pairs vary. These are component CPU samples, not a controlled whole-physics A/B, browser IPC measurement or native GPU/FPS claim. Detailed timings/checksums are in `artifacts/world-triangle-local-cache.json` and `artifacts/world-triangle-local-cache-benchmark.log`. The initial eager-local candidate regressed changing material geometry; it was rejected and replaced by the lazy path before this checkpoint.

An isolated exact-work counter independently records steady-update `Object.freeze` calls per face: rotation35→30, translation35→20 and continuously deforming geometry35→31. Its artifact is `artifacts/world-triangle-freeze-counts.json`. No physical face, solver pass, contact or source attribute was removed to achieve these reductions.
