# Persistent aggregate triangle streams

`WebGPURenderer.prepareTriangleStream({capacityTriangles, color})` is an explicit
opt-in live render resource. It does not change the immutable triangle-mesh API,
its validation, or the ordinary renderer cache. A page contains 1–20,000
triangles, preserving the existing 60,000-index part boundary.

```ts
const cold = renderer.prepareTriangleStream({
  capacityTriangles: 8000,
  color: [46, 71, 82, 255],
});
// Spend the caller's shared cold-admission credits/deadline between steps.
while (!cold.ready) cold.step(65536);
const stream = cold.commit();
// Use stream.primitive with Scene.prepareRenderEntity({renderOnly:true,...}),
// then renderer.prepareEntity/adoptPreparedEntity for bounded object prewarm.
stream.update(packedPositionNormalF32, activeVertexCount);
// Remove all associated Scene entities before releasing the live resource.
stream.dispose();
```

The example's loop describes successive admission steps, not a recommendation
to synchronously drain cold work in a render frame. GPU validation/OOM scopes
close within each cold step; `ready` waits for their asynchronous acknowledgments.
One step allocates one resource or packs/uploads at most 64 KiB. The two private
CPU vertex banks are allocated separately in cold preparation. Native allocation
and driver execution time are measured properties, not a JavaScript time bound.

`commit()` transfers ownership to the returned controller. Disposing the cold
lease afterward does not destroy its live stream. `stream.dispose()` is
idempotent, releases its residency pin, destroys all four GPU buffers, and clears
private CPU banks and owner references. Renderer disposal also releases pending
and live streams. Resources from one renderer cannot be rendered by another.

## Packed update contract

`update(vertices, vertexCount)` takes a `Float32Array` with six scalars per vertex:
position XYZ, then normal XYZ. `vertexCount` is a multiple of three, including
zero, and cannot exceed the page capacity times three. Only that active prefix
is read; the caller retains its source and can immediately reuse it. Every
scalar is checked finite and copied before visible state changes. The source
view is never retained or exposed through snapshots.

For multi-page atomic updates, call `stage(vertices, vertexCount)` for each page.
It validates/copies/uploads its alternate bank and returns an owned update
ticket. Stage all pages before calling any ticket's `commit()`. Commit tails do
no GPU work or external callbacks and swap only private references/fixed bounds;
run them in one synchronous publication. If any staging call fails, dispose the
earlier tickets and every page keeps its previous complete frame. There is at
most one pending update per page. Settled/stale tickets cannot commit a later
update. CPU/GPU banks remain pooled; each explicit staged update has one small
ownership token, while convenience `update()` needs no token allocation.

For live admission, `prepareUpdate(vertices, vertexCount)` instead returns a
`TriangleStreamUpdatePreparation` with `step(maxBytes=65536)`, `ready`, `commit`,
and `dispose`. Creating it only reserves the alternate bank. The caller must
keep the borrowed active source prefix stable and attached until `ready` or
disposal; a producer's whole-frame lease can provide that ownership. Each step
validates/copies at most `min(maxBytes,65536)` bytes **or** uploads one block of
that size. All finite validation finishes before the first GPU write, and the
source reference is cleared as soon as its complete private copy is ready.
Each upload closes validation/OOM scopes within that synchronous step. There
are at most 16 pending error acknowledgments per update; later steps poll while
those credits are held. `ready` waits for every acknowledgment, and a rejected
write causes a later step to throw with its cause while retaining the prior
visible frame. Cancellation releases the source and reservation; late error
acknowledgments cannot affect a later ticket. Stage all pages to `ready` before
their fixed-work commits. Neither the byte cap nor GPU acknowledgments bound
native driver time or promise a wall-clock frame deadline.

Each source triangle gets identity indices, its exact source order, the fixed
RGBA byte color, UVs `(0,0), (1,0), (0,1)`, and zero authored variation. The stream
does not weld vertices. Equality with an indexed immutable mesh is therefore
defined over the complete expanded indexed vertex/attribute sequence, not equal
vertex/index buffer lengths. The material vertex shaders consume attributes
without a `vertex_index` builtin. Materials, shader passes, triangle winding,
draw ordering, and entity IDs must still be preserved by the caller.

Updates alternate two GPU vertex banks. Validation errors or synchronous upload
failure leave the previous bank, count, bounds, and revision visible. Each upload
call is at most 64 KiB; one update performs at most 360,000 scalar reads and 22
uploads for a 20,000-triangle page. After the complete synchronous update, active
count, exact packed-F32 bounds, and revision publish together. There is no GPU
completion wait or per-update promise/error-scope queue in these synchronous
convenience methods. The incremental admission API above adds bounded scoped
error acknowledgments. Ordinary device-loss
and uncaptured GPU-error handling remain applicable.

Static color/UV/seed and identity-index buffers upload once. Live updates create
no mesh buffers, bind groups, public mesh snapshots, or typed-array staging
views. A maximum page owns exactly 2,880,000 CPU bytes and 3,960,000 GPU bytes
(6,840,000 total, excluding fixed object metadata). Smaller pages scale linearly;
odd triangle capacities require two extra index-padding bytes. Callers must
bound their page count and retained idle pool. A per-page cap alone is not a
global frame-time or memory guarantee.

## Scene, snapshots, and caches

The primitive is a new identity-branded `kind:'triangle-stream'`. Arbitrary
objects, proxies, serialized clones, and public `freezePrimitive` inputs cannot
create its ownership certificate. It requires `renderOnly:true` and cannot own
physics or environmental state. Scene constructor cloning is deliberately
unsupported; use `Scene.add` or detached `prepareRenderEntity` after cold commit.
Changing counts/bounds/revision does not invalidate the resident mesh identity
or an already prepared object binding, so moving glass can finish admission.

The input contract is already packed F32. `primitiveMesh` returns independent
fresh current `MeshData` arrays; it does not promise original F64 authoring
coordinates. Pure `buildRenderFrame`/proxy snapshots capture a frozen current
triangle mesh and omit empty stream objects. Their optional packed meshes and
physical-primitive fields also remain independent after later updates. The
existing `entity` reference continues to identify the live Scene entity.

The private live `RenderFrameCache` keeps the explicit resource handle and an
observed `geometryRevision`, and never calls the public snapshot path. Visibility
invalidates cached bounds tests when revision changes even at an unchanged
transform. Empty streams retain warm residency/objects but have no pass roles,
so they issue no empty draw. Opaque opt-in streams also invalidate their radiance cause; ordinary
scene hashes remain unchanged. Explicit CPU mesh queries take fresh snapshots
on new revisions so they cannot retain stale triangles; that optional query work
is not part of the normal GPU render-frame cache.

For legacy aggregate transparency, render-only entities can opt into
`transparentSort: {anchor:[0,0,0], phase:'static-tail', ordinal:pageIndex}`. The
anchor affects only the primary transparent-camera distance sort, independently
of the actual model/culling transform. Equal-distance ties retain ordinary
statics, then these tails in ordinal order, then ordinary movers. Other passes
and actual mover classification remain unchanged. This preserves the former
raw aggregate's static/local-origin ordering when a held complete source frame
requires an origin-offset model transform. Scene/detached preparation validates
and freezes the metadata; public and cached frame records snapshot its values.

`test/triangle-stream.test.mjs` covers packed output/order, source isolation,
maximum-page bounds, failures/cancellation/reentry, cold GPU acknowledgments,
resource transfer, snapshot independence, visibility, queries, and detached
entity/GPU prewarm. `test/triangle-stream-update.test.mjs` additionally checks
incremental byte bounds, full validation before uploads, pending error credits,
two-page atomic publication, stale ACKs, detached sources and cancellation.
Native image/HDR/depth comparison and actual Game producer
integration are separate required evidence. These API tests do not establish
60 FPS or prove that all sources of render/input stalls are removed.

Native numerical/image evidence is retained in the ignored
`artifacts/freeze-stream-glass-native-20261021/r3/report.json`. Five complete
1280×720 comparisons against canonical F64 Game glass use incremental copy/upload
steps and GPU error acknowledgments. Dry, wet/night, mirrored, large-origin and
two-page overlap cases have identical PNG, HDR, depth, expanded attributes,
transparent order and draw counts. Four updates plus a zero-count expiry/render/
restore cycle create no new stream geometry buffers, object buffers or object
bind groups on native AMD RDNA3. This fixture checks quality and residency; it
does not measure producer-worker budgets, GC pauses, whole-world pacing or FPS.
