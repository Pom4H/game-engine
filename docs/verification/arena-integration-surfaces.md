# Unified QUIC arena and deforming wheel support

Integration baseline: `1a6d0a2e8b2c8d552d7507ebcc548dc628baf76c`, tree
`4f571b1abf5dab9f7ff10a4d7599f96a8822b013`, same `codex/adaptive-core` branch.
The concurrently completed native QUIC implementation was retained instead of
publishing a second transport, codec, input worker, quaternion module or clock.
Its port-selection fix and authority-side stale-epoch race regression remain intact.

## Changed behavior

- The single WheelSupport contract now returns contact velocity, physical owner and
  optional triangle/barycentric coordinates. Its prepared installed roster accepts
  static/moving/rotating OBBs and spheres. Rebuild on roster changes; live shape/pose
  changes invalidate cached bases/AABBs without recreating query objects per wheel.
- The arena queries actual deformed ball triangles. Suspension/traction uses their
  barycentric velocity and sends reciprocal force to the same mass nodes. No extra
  ball proxy or solver. Dynamic rigid support receives the opposite impulse.
- A brief four-wheel contact can reload a jump/flip; sustained contact/held input
  cannot generate extra edges. Roof contact is not wheel contact. The impulse uses
  the support normal. Fixed-surface arcade adhesion excludes moving/soft supports.
- Vehicle physical construction and visual parts use .72 match scale and a lower
  arcade chassis collider. The wheel footprint fits the ball. The construction
  change bumps the negotiated projection to car-ball/v3, not a legacy alias.
- Existing surface fixtures start at the equivalent scaled contact clearance.
  Every contact, propulsion, jump-normal, anti-repeat, roof-rejection, driven
  transition and 34-pad respawn assertion is preserved, not loosened.
- DatagramOutbox waits for Web Stream capacity BEFORE choosing its pending input.
  A stalled writer sends only the most recent state when ready. Teardown cannot
  leak a pending send or report an expected writer close as a transport fault.

Existing controls: independent pitch/yaw/roll, held jump, second jump/dodge, boost
and powerslide. Existing 34 authority-owned pads: six full (100, 10-second respawn)
and 28 small (12, 4-second respawn). Current server tick120Hz, two substeps; state
publication up to60Hz, browser input up to60Hz. No reliable fallback in UDP rooms.

## Local evidence

Sandbox Node22.16.0 / TypeScript5.8.3 with the existing local Node types. This is not
local verification of the package-declared TS7/Bun toolchain or the native addon.
Typecheck, build, editor build and browser-worker syntax pass.

Untouched baseline full suite:230/233. Unified full suite:237/240 with the SAME
three inherited failures (two clearcoat assertions and imported-M3 triangle count).
Seven added tests pass; the existing surface assertions are retained with the
construction-scaled initial clearances described above.

The driven300-tick arena fixture reports43 supported wall ticks and128 supported
ceiling ticks, with no per-tick position/orientation override. The deformation test
lands a car on the real ball; at reset its COM is2.2624899219401158m, all four wheel
owners are ball, and all four fixedSupport flags are false. A moving rigid support
receives the reciprocal wheel impulse within1e-9kg m/s in its focused fixture.
Independent three-axis torque and changing triangle-coordinate/velocity queries
are also checked.

The retained binary layout is774bytes (not the686-byte unpublished alternative).
The180-tick fixture's maximum JSON comparison is5936bytes; maximum absolute node
component error is0.0004999340262329399m. These are specific fixture observations;
774*60=46440B/s is application state payload per viewer, excluding QUIC/IP overhead.
Inputs remain the retained28-byte format with cumulative jump serials. Codec loss,
reordering, malformed packets and stale inputs retain their existing tests.
The new backpressure test offers100 controls while capacity is blocked and sends
only the latest when capacity returns. This is not a measured WAN latency bound.

## Native acceptance

The baseline1a6d0a2 had already passed the real two-browser QUIC/WebGPU and editor
steps in run36383286339. That evidence is not reused as acceptance for this patch.
The existing read-only DSL pipeline repeats real QUIC datagrams, browser driving,
matching deformed replay geometry and recorded canvas images on the new commit.
Its exact run, artifact and failures must be reported separately after completion.

## Limits

Rigid car chassis, compliant elastic-volume ball (no gas-pressure equation), nodal
soft/rigid contact and ray-based wheels. No general continuous mesh collision,
full tire carcass, universal moving-mesh support, client prediction/reconciliation,
whole-solver rollback, public matchmaking/security or competitive-WAN performance
claim. Presentation retains the existing35ms interpolation delay plus actual network
and processing delay. No zero-overhead, global frame-time reduction or RL parity.
