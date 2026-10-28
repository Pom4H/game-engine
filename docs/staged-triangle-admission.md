# Staged triangle admission

`prepareCopiedTriangleMesh(input)` is an explicit alternative to the synchronous
compact factory. Its caller owns stable indexed input channels until the ticket
finishes or is cancelled. The intended source is an unpublished transferred
worker result. The ticket does not adopt, freeze, or detach that input.

`ticket.step(maxScalars)` performs at most that many scalar reads/checks, including
index-range validation and bounds accumulation. Private Float64 blocks contain
at most 8,192 numbers (64 KiB); completing a large part does not concatenate them.
`done` remains false and `mesh` undefined until every channel has been copied and
fully validated. Only successful completion registers the factory identity and
an O(1) key from the existing `dynamic:N` sequence. `cancel()` clears unfinished
input/storage references; cancelled tickets cannot resume. Reentry is rejected.

The final mesh retains original doubles, signed zero and original-double bounds.
It has the same lazy frozen public array contract as `compactTriangleMesh`.
Reading those arrays, serializing/cloning the facade or calling public
`primitiveMesh` remains a complete, fresh-output slow path. Existing synchronous
factory, public freeze, getters/Proxy validation and primitive packing are
unchanged. The new certificate cannot be inherited, serialized or forged by
freezing an object.

`renderer.prepareMesh(mesh)` accepts only either explicit validated factory
identity. Its lease is manually pumped by the caller:

```ts
const ticket = prepareCopiedTriangleMesh(workerChannels);
// Each invocation belongs to the caller's shared admission credits/deadline.
ticket.step(scalarCredits);
// After ticket.done:
const lease = renderer.prepareMesh(ticket.mesh!);
lease.step(uploadCredits);
// After every part of the complete group is ready:
lease.commit();
// Publish the complete render-only Scene group in the same synchronous turn.
// Retain the lease while its unpublished/alternate geometry is still needed.
// Release it when the owning group retires:
lease.dispose();
```

Each upload step performs one GPU buffer allocation **or** packs and writes one
fresh block of at most `min(uploadCredits, 65536)` bytes. Credits must allow at
least four bytes. No `primitiveMesh`, whole-channel concatenation, shader
compilation, GPU completion wait or hidden draining microtask runs here. Queued
writes precede subsequent draws on the same GPU queue. Each cold step opens and
closes validation/out-of-memory error scopes synchronously. `ready` waits for
their asynchronous acknowledgements and every queued byte, not for GPU execution
completion. A rejection destroys unpublished buffers and cannot admit a cache
entry; late acknowledgements of a cancelled lease have no effect.
At most sixteen scope acknowledgements may be outstanding for one lease;
additional steps make no uploads while that credit is exhausted. The vertex stream,
color/UV/seed stream, index-width choice, padding and Float32 bounds preserve the
existing renderer's bytes and arithmetic.

`commit()` admits only complete resources into both mesh caches and retains a
residency pin. Collection therefore keeps prepared alternate orientations that
are not currently represented by Scene entities. Duplicate leases share the
complete cache entry. `dispose()` destroys all unpublished buffers, or releases
the committed pin without destroying resources still owned by the Scene/cache.
Retiring the last pin invalidates the next collection certificate so an otherwise
unchanged Scene cannot retain an unused mesh forever. Renderer disposal cancels
its remaining leases. Failed allocation/upload/cache admission cleans partial
ownership before a retry.

The caller must bound concurrent tickets, input/output bytes and retained leases,
and must fence source/albedo/disposal generations before whole-group publication.
These APIs provide bounded work quanta, not a hard real-time browser guarantee:
an individual WebGPU allocation/driver call is indivisible. Steady-state render
cost, worker failures and GPU scheduling still need their own readiness contracts.
Keeping old complete geometry
until publication preserves coverage; partial prepared parts must not become
visible. This foundation alone is not a 60 FPS or no-freeze result.

## Detached entities and bindings

`scene.prepareRenderEntity(spec)` accepts an explicit `renderOnly: true` entity
with already validated factory-owned triangle geometry. It snapshots the fixed
render schema and returns `entity`, `refresh(update?)`, `adopt()` and `dispose()`.
Body, light and physical surface registration stay on the ordinary `Scene.add`
path. Unknown metadata is outside this new snapshot contract. Each input has a
bounded number of scalar/vector/material fields and at most four asset URLs of
8,192 characters. Arbitrary caller getters can execute arbitrary user code; their
execution time is not a hard bound. Default `Scene.add` is unchanged.

The detached entity retains the canonical ID. It is absent from `scene.entities`,
physics and every render/probe query until adoption. `refresh` validates the
complete supplied pose/material update before changing any component, then
derives the ordinary surface under the current Scene environment. This allows
the final current weather and render-origin pose without waiting for motion to
stop. Duplicate ID validation happens at adoption. Disposing the ticket after
adoption releases the preparation owner and does not remove the Scene entity.

`renderer.prepareEntity(ticket.entity)` requires its mesh to be resident. A lease
starts at most one authored texture URL load per `step()` and waits for all
authored textures to be resident; a fallback texture cannot be published as ready.
The existing texture decoder/mip upload callbacks are a separate cold subsystem,
not claimed to be time sliced by this API. Empty or already resident labels are
supported. Cold glyph rasterization must be prepared separately; it is rejected
here rather than hidden in the small object budget.

After texture readiness, each step performs one fixed 400-byte uniform-buffer
allocation, one object bind-group creation, or one 400-byte upload. Error scopes
open and close in that same synchronous step. Ready/commit wait for their async
validation/OOM acknowledgements. Source mesh identity, mesh residency, authored
URLs and actual bound texture/label handles are fenced. Uniform-only material
or pose changes can reuse the complete binding and require only the ordinary
400-byte first-live update. The default uniform arithmetic/order is shared.

Whole-cohort publication follows this order in one synchronous turn:

```ts
// Every member is ready. Caller preflights IDs and caps this final Map tail.
ticket.refresh({position: currentLocalPosition, material: currentMaterial});
lease.commit(); // Detached exact-entity cache, old same-ID binding still intact.
// After all members commit, remove the old complete cohort.
ticket.adopt();
renderer.adoptPreparedEntity(scene, ticket.entity); // No allocation/bind/upload.
// Repeat the adoption tail for every member, including offscreen members.
// Afterwards, afterRender or the cohort owner may release preparation owners:
lease.dispose();
ticket.dispose();
```

Explicit cache adoption is required for offscreen members too. Their first future
appearance must not allocate resources after an unused lease was cancelled.
Before activation, disposal destroys only the unpublished binding; after
activation the renderer owns it until Scene collection/replacement/disposal.
Labels, texture URL requests and meshes remain pinned while a lease owns them.
Same-ID old GPU objects remain alive until complete new binding activation.
Cancellation, GPU errors and late acknowledgements cannot publish partial work.

Native `Map` publication still has a finite O(member count) tail. Callers must
cap both complete-cohort size and total publication credits; this API does not
claim an O(1) atomic map swap or split visible cohorts over multiple frames.
