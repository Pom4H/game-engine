# Compact triangle storage

`compactTriangleMesh(input: CompactTriangleMeshInput)` creates a deeply immutable
triangle mesh backed by private Float64 channels. The explicit factory copies and
fully validates indexed input values before registering its identity. It never
adopts or detaches caller buffers. Positions, normals, indices, optional RGBA
colors, UV pairs and variation seeds retain their original doubles and signed
zero; GPU packing keeps the existing Float32/color/index conversion rules.

The intended path is `new Scene({version: 1, entities: []})`, followed by
`scene.add({id, mesh: compactTriangleMesh(channels), renderOnly: true})`.
Existing primitives, `freezePrimitive`, validation and compiler defaults retain
their previous behavior. Public freeze is not a validated-storage certificate.
`isOwnedValidatedTriangleMesh` recognizes only this factory's identity; wrapping
the result in a Proxy or serializing it does not transfer that certificate.

Each public channel is an enumerable getter. Its first read creates a dense,
frozen `number[]`; later reads return that same array. Reading every channel
retains both the typed storage and public copies, and can consume more memory
than the ordinary representation. Constructor cloning, serialization and mesh
spreading therefore stay explicit slow paths. The Game's seed inspection expands
only the optional seed channel; reflected meshes currently use the ordinary
mirror path. Physical/deformation consumers are outside the initial render-only
integration.

`primitiveMesh` always returns fresh, independently mutable `MeshData` arrays,
including for compact input. There is no persistent packed-data cache or public
view of private storage. `ownedTriangleMeshBounds` exposes only a frozen
six-number tuple of original-double extrema for exact radiance calculations;
GPU bounds continue to use packed Float32 positions. Factory keys consume the
same `dynamic:N` sequence as `freezePrimitive(mesh, true)`, preserving instance
cache key uniqueness and allocation order. These keys do not determine shader
variation seeds: the renderer uses the material's explicit seed or the stable
entity ID. Asynchronous geometry staging must preserve entity IDs and draw order;
it does not require reserving mesh keys to preserve shader seeds.

The ignored feasibility experiment at the Game workspace's
`artifacts/compact-triangle-prototype/` ran Node 24.21.0 / V8 13.6. For one
generated 2338-triangle chunk, five alternating receive-admission pairs measured
median 4.06 ms for ordinary reconstruction/freeze/validation/packing and 1.67 ms
for the copied compact factory/validation/packing. An 18704-triangle stress case
measured 39.51 versus 10.12 ms. Actual transfer/deserialization was excluded.
Fresh-process retained heap plus ArrayBuffers fell from about 11.26 to 5.29 MB
for that stress case; reading every public channel increased compact retention
to 18.78 MB. These generated inputs are not a measured saved-city distribution,
and these diagnostics establish neither frame-rate nor GC-pause guarantees.

The [native comparison report](render-evidence/compact-triangle-storage-20261021.json)
checks the production factory against ordinary meshes in four cases: dry,
wet night, mirrored geometry and a rebased origin. On AMD RDNA 3 hardware, the
1280×720 PNG, HDR and depth outputs, draw counts and callbacks matched exactly
with TAA, bloom, logarithmic depth (2000) and the depth prepass enabled; there
were no GPU errors. The run took 9.50 seconds. The retained
[dry image](render-evidence/compact-triangle-storage-dry-20261021.png) and
[wet night image](render-evidence/compact-triangle-storage-wet-20261021.png)
illustrate this quality check, which is separate from frame-rate acceptance.
