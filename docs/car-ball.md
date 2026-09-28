# Car / Ball

An executable car-football recipe over the existing engine. The integration branch
is `codex/adaptive-core` (PR #26), including the source-bound console/recording from
#27 and structural replication from #28. main and production are unchanged.

## Run

```sh
bun install --frozen-lockfile
npm install --prefix tools/docs --ignore-scripts
bun run arena
```

Open `http://127.0.0.1:4173/docs/arena.html` twice. The first two connections receive
server-owned seats. Additional connections spectate (eight total). No account service,
external renderer, external physics library or engine runtime dependency is added.
The normal `/docs/` TypeScript playground remains available with its existing scenes.
The generated portable static site alone cannot host a match: the authority worker
and HTTP host must be running.

For separate computers, use a trusted HTTPS reverse proxy in front of the loopback
host and set `ARENA_PUBLIC_ORIGIN=https://<your-arena-host>` before starting. Preserve
that Host header and disable proxy response buffering for SSE. Use the same HTTPS
origin on both clients. Plain HTTP on a LAN IP is not sufficient for WebGPU's secure
context requirement (https://gpuweb.github.io/gpuweb/#navigator-gpu). The default is
loopback only; localhost remains suitable for the two-tab developer test. This is a private-room developer host, not public Internet deployment,
a production authentication system, matchmaking or anti-cheat. Do not expose it
without an appropriate authenticated perimeter.

## Controls

| Action | Keyboard / mouse | Standard gamepad |
|---|---|---|
| Accelerate / reverse / brake | W / S | Right / left trigger |
| Steer / airborne yaw | A / D | Left stick X |
| Jump, hold for height, second jump | Right mouse | A / bottom button |
| Directional second-jump dodge | Direction + right mouse | Stick + A |
| Boost | Left mouse | B / right button |
| Powerslide / free air roll | Shift + A / D | X / left button + stick |
| Air roll | Q / E | Shoulder buttons |
| Air pitch | W / S | Left stick Y |
| Ball / car camera | Space | Y / top button |
| Diagnostics and recordings | Ё / Backquote | On-screen button |

Touch buttons expose driving, boost, jump, slide and camera. This is a Rocket-League-
style control vocabulary with independently tuned constants, not numerical parity.
A held jump adds bounded lift; a second jump is available for 1.25 s and cannot be
repeated until landing. Boost is finite and refills at 34 arena pads (six full, 28 small). Match rules
include countdown, whole-ball goal detection, kickoff, five-minute timer and overtime.

## One authority, independent presentation

`CarBallArena` is ordinary TypeScript with no browser, socket or GPU imports. Cars use
`Vehicle` and the existing `PhysicsWorld` integrator. A 120 Hz game tick uses two
substeps. `ArcadeVehicle` adds forces/torques to the same body; it never writes a
second car pose for rendering. Cars currently have rigid chassis and a four-wheel suspension supporting static oriented surfaces. They are NOT fully coupled deformable car bodies in this demo.

The ball is a closed subdivided octasphere with 67 mass nodes (66 on the surface) and
320 distance/volume constraints solved by the existing `StructuralBody`. Its compliant
volumes approximate an elastic filled ball; there is no gas-pressure equation.
`StructuralRigidContacts` transfers contact response between surface nodes and
oriented boxes, with reciprocal rigid-body momentum. There is no extra rigid ball
mass/proxy. This contact adapter is nodal: general triangle/triangle contact and
continuous collision detection are not claimed. Very fast or small/thin features
need a richer contact model.

The existing debug host now supports an explicit arena recipe in its Node worker.
Server-selected numeric fields include both cars, ball nodes, wheel phases, controls
acknowledgements, boost, score, pads and match phase. One immutable `Publication` is
encoded once for all viewers, at up to 60 Hz with UDP/WebTransport (30 Hz only in the explicitly selected SSE diagnostic mode). Existing bounded SSE outboxes and
`Replica` history/clock are reused. Only complete absolute snapshots may replace
unsent snapshots. Input has a server-owned seat, sequence and jump-edge counter;
stale inputs are neutralized, departures release the seat, epoch resets fence an old
match. The client never receives authority from a body-supplied seat or peer ID.

Browser network reception/decoding stays in the existing worker. Rendering samples
one timeline for poses, deformation and wheel state. Wheel spin is unwrapped so
fast rotation does not reverse through shortest-angle interpolation. The render
mesh has stable topology and a persistent GPU vertex buffer; only revised vertices
and bounds upload. Materials and triangle topology are not retransmitted each frame.

The default realtime path now requires browser WebTransport datagrams over native
HTTP/3/QUIC (UDP), using the same `@webtransport-bun/webtransport@0.3.0` boundary as
`thegame`. There is NO automatic HTTP/2 or SSE fallback. Join, restart and archive
requests remain reliable HTTP; these requests never block the datagram input timer.
`ARENA_TRANSPORT=sse` explicitly selects the older diagnostic transport, shared with
the ordinary editor. It is not advertised as competitive networking.

The server validates a private join token over one bounded reliable QUIC hello.
Continuous controls are 28-byte datagrams at up to 60 Hz. One absolute **774-byte**
snapshot contains both cars, the SAME-tick soft ball nodes, pads and match state.
No fragmentation, retransmission of stale snapshots, delta-baseline dependencies or
schema/JSON text in the fast packets. At 60 publications/s this is 46,440 bytes/s
per viewer of application state; QUIC/IP/TLS overhead is additional. Node coordinates
are millimetre-grid int16 offsets from the shared float32 ball center: local tests
measure maximum component error about 0.50001 mm. Float32 is used for continuous
fields, uint32 for discrete channels, float64 for authority time/epoch. Range overflow
is an error rather than silent wrapping. The versioned layout is negotiated once.

Each application outbox retains one active and one latest pending send, expiring
pending state after 40 ms (client) / 50 ms (server). Native queues also have hard caps;
these are local queue limits, not an end-to-end latency guarantee. Browser reception
and binary validation stay in the worker. Pose quaternions use shortest-path spherical
interpolation; world angular velocity uses exponential rotation integration instead
of incorrectly treating its components as Euler rates.

Wheel support is now a prepared ray query against actual static rotated box colliders
plus the floor. The same collision geometry supplies the visible floor-wall-ceiling
ramps. Suspension and tyre forces resolve in the contact tangent/normal frame. A
configurable arcade adhesion acceleration and alignment torque keep contacted wheels
on walls and ceilings without teleporting the chassis. Four wheel contacts held for
20 ms reload the jump; chassis/roof contact alone does not. The first jump impulse
uses the support normal. This is not dynamic soft-ball flip-reset or general mesh/
moving-platform support; a custom WheelSupport query can supply other geometry.

Six full boost pads award up to 100 and respawn after 10 simulation seconds; 28 small
pads award 12 and respawn after four seconds. Server-owned pickup/cooldown state is
replicated in the same snapshot. Pitch, yaw and roll remain independent local axes.

There is still no client prediction/reconciliation or full solver rollback. Default
presentation delay is 35 ms plus actual network/processing delay, not instant local
response. Loopback native acceptance and synthetic loss tests cannot establish WAN
quality, competitive FPS performance, or numerical equivalence to Rocket League.

## UDP launch / TLS

`bun run arena` installs the isolated native package under `tools/transport` on first
launch. Root engine/math code has no new runtime dependency. Locally, the host uses
UDP port 4433 (`ARENA_QUIC_PORT` overrides it) and creates a ten-day P-256 certificate
under ignored `.local/arena-quic/`, pinned by the trusted localhost bootstrap. OpenSSL
is required (`OPENSSL_PATH` overrides discovery); no TLS verification bypass is used.
Never publish that private key or include `.local` in a deployment archive.

For a remote room configure `ARENA_PUBLIC_ORIGIN` for HTTPS page/control access and
`ARENA_QUIC_URL=https://your-host:4433/arena`, `ARENA_TLS_CERT` and `ARENA_TLS_KEY` for
the native endpoint. Open/forward **UDP**, not merely TCP, on that port; ordinary HTTP
reverse proxying does not carry this separate QUIC socket. Use a browser-trusted TLS
certificate for remote access. Room ownership tokens are not a production account,
matchmaking or anti-cheat system. The private-room security perimeter remains required.

## Console / recording

The same safe `consoleSession`, drawer and renderer recorder as the DSL editor are
used here. Commands include `inspect scene`, `watch ball`, `watch car0`, `replay 2`,
`live`, `record start`, `record stop`, `record export` and `record trace`. There is no
arbitrary eval of remote commands. Game runtime values are read-only; source-bound
editing remains in the ordinary DSL editor.

The replay slider samples server history without resimulating a world. The renderer
recording tab stores actual canvas images with CPU/GPU frame association; scrubbing
those images does not change the simulation or the replay playhead. Recording adds
capture overhead and is opt-in. This developer arena enables renderer profiling.
Native Chrome call-stack capture remains `tools/chrome-trace.mjs` / the render harness,
not a second VM profiler in the console.

## Verify

```sh
bun run typecheck
bun run build
node --test test/car-ball.test.mjs test/arena-network.test.mjs test/arena-surfaces.test.mjs test/datagram.test.mjs
node --test test/network-buffer.test.mjs test/network-structure.test.mjs
node tools/docs/build.mjs
node tools/docs/arena-qa.mjs
```

Set ARENA_TRANSPORT=webtransport for the native UDP test (the unconfigured QA retains the explicit SSE diagnostic fixture). The last command needs native Chrome/WebGPU (`CHROME_PATH`); it opens two actual
clients, drives with browser input, compares common authoritative frames and visible
node positions, and captures the arena and common recording UI. Evidence is written
to `artifacts/arena/`. Unit and loopback tests do not substitute for visual acceptance.
