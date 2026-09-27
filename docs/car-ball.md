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

For a trusted LAN, set `HOST=0.0.0.0` and `ARENA_PUBLIC_ORIGIN=http://<host-address>:4173`
explicitly before starting. Use that same origin on each client. The default is
loopback only. This is a private-room developer host, not public Internet deployment,
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
repeated until landing. Boost is finite and refills at six arena pads. Match rules
include countdown, whole-ball goal detection, kickoff, five-minute timer and overtime.

## One authority, independent presentation

`CarBallArena` is ordinary TypeScript with no browser, socket or GPU imports. Cars use
`Vehicle` and the existing `PhysicsWorld` integrator. A 120 Hz game tick uses two
substeps. `ArcadeVehicle` adds forces/torques to the same body; it never writes a
second car pose for rendering. Cars currently have rigid chassis and the existing
four-wheel suspension. They are NOT fully coupled deformable car bodies in this demo.

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
encoded once for all viewers, normally at 30 Hz. Existing bounded SSE outboxes and
`Replica` history/clock are reused. Only complete absolute snapshots may replace
unsent snapshots. Input has a server-owned seat, sequence and jump-edge counter;
stale inputs are neutralized, departures release the seat, epoch resets fence an old
match. The client never receives authority from a body-supplied seat or peer ID.

Browser network reception/decoding stays in the existing worker. Rendering samples
one timeline for poses, deformation and wheel state. Wheel spin is unwrapped so
fast rotation does not reverse through shortest-angle interpolation. The render
mesh has stable topology and a persistent GPU vertex buffer; only revised vertices
and bounds upload. Materials and triangle topology are not retransmitted each frame.

This implementation uses reliable HTTP/SSE over TCP. It is not QUIC/UDP, and head-of-
line blocking remains. There is no local prediction, server reconciliation, rollback
of the solver or competitive-WAN latency claim. Remote state interpolation has an
intentional delay. Wall/ceiling driving and curved wall transitions are not implemented;
wheel support remains the existing horizontal ground model. These are explicit
remaining gameplay/network limitations, not hidden alternate implementations.

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
node --test test/car-ball.test.mjs test/arena-network.test.mjs
node --test test/network-buffer.test.mjs test/network-structure.test.mjs
node tools/docs/build.mjs
node tools/docs/arena-qa.mjs
```

The last command needs native Chrome/WebGPU (`CHROME_PATH`); it opens two actual
clients, drives with browser input, compares common authoritative frames and visible
node positions, and captures the arena and common recording UI. Evidence is written
to `artifacts/arena/`. Unit and loopback tests do not substitute for visual acceptance.
