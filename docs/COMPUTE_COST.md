# Computation cost before world-runtime integration

The unit for the CPU simulation is a physical substep. Let `B` be rigid bodies,
`D` awake dynamic bodies, `A_i` the number of X/Z hash cells covered by body
`i`, `Q` query cells visited, `C` candidate body pairs, `N` active structural
nodes, `E` structural constraints, `I` XPBD iterations, `S` simulation
substeps, `L` oversized bodies and `M` registered modules.

| Stage | Existing cost before this change | Cost with oversized-body path |
|---|---|---|
| Physics index rebuild | O(sum A_i) references and insertions per substep | O(sum for regular bodies A_i + B + L) |
| Dynamic broad-phase queries | O(D * Q + candidate references), with cached multi-cell queries when possible | O(D * (Q + L) + candidate references) |
| Narrow phase | O(C); sphere/box is constant work, oriented box/box tests up to 15 separating axes | unchanged |
| Ground support | Up to eight box corners and three solver sweeps over support points per dynamic body | unchanged |
| Active structure | O(N + I * E) per structural step, subject to activation/LOD | unchanged |
| Module plan | O(M) cache-key work per tick; dependency/hazard plan is built when modules change | unchanged |

The oversized path classifies an item when its covered cell count exceeds 64.
It stores one cell rectangle and scans those `L` rectangles per query. The
rectangle is compared with the **query cell rectangle**, so cached queries and
single-cell queries cannot miss a collider that the previous hash returned.
In a scene with many oversized objects, `D * L` may become more expensive than
duplicating them. The threshold is therefore a measured policy, not a general
guarantee of higher frame rate.

## Reproducible fixture

`node tools/profiling/spatial-broadphase.mjs` after `npm run build` rebuilds
an 8 m cell index 80 times with five 140 m surfaces and 100 small bodies,
then runs 8,000 queries per sample. The same isolated fixture was run against
the previous `SpatialHash` from main at
`09a5bdbf71210426c65cd1c95b0038d744f56eb5`, alternating old and new
implementations in one Node 24 process (eight samples per implementation).

| Metric | Previous | Oversized path |
|---|---:|---:|
| Median fixture time | 60.07 ms | 19.18 ms |
| Hash cells at the end | 676 | 144 |
| Oversized items | 0 | 5 |

This measures the broad-phase fixture, not a complete frame or GPU throughput.
The comparison uses exactly the same item positions and queries. A direct
cell-rectangle oracle checks candidate coverage, while the rigid-body test checks
that a large floor still resolves support contacts. Renderer work is measured
separately by `docs/RENDER_QUANTA.md`.

## Next integration boundary

PR #19 adds a world planner outside the local Scene. Its interest update is
O(subjects * observers + subjects log subjects); the current location scheduler
is O(locations log locations) when all candidates are due. Those costs are
separate from the per-Scene physics above. Capture their actual timings after
integration before changing the interest or scheduler algorithms.
