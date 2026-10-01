# TheGame public transport migration

Source preserved from `Pom4H/thegame` at commit
`2ee0a9407909fcda1895127aa9437a2ca43bef9c`.

Relevant legacy sources:

- `src/game/runtime/transit.js`
- `src/game/runtime/rail.js`
- `src/game/runtime/timetable.js`
- `test/transit.test.js`
- `test/public-transit-regression.test.ts`

The unified model keeps the semantic causes instead of copying the old runtime:

- two bus loops: `B01`, `B02`;
- one tram line: `T01`;
- one metro line: `M01`;
- two scheduled services per route;
- capacities 68 / 68 / 84 / 180;
- service day origin at 08:00;
- route-local dwell, doors, cycle and headway;
- stable service identity;
- real resident identities as waiting/riding passengers;
- authoritative capacity, boarding and alighting counters.

`TransitAuthority` is deliberately independent of rendering and full vehicle physics.
A distant service is schedule/passenger state. Near a player the same stable
`serviceId` can be promoted into the engine's existing `Vehicle`/physics/audio
systems. Demotion folds physical state back into the service without replacing the
route, timetable, passengers or vehicle identity.

This preserves the old rule that public transit is not decorative traffic.
Passengers are world residents, and a player may eventually possess a resident
already waiting at a stop or riding inside a service.

The old runtime's road graph, vehicle class, cabin geometry and network packet
implementation are not copied. Those responsibilities now belong to the unified
world/vehicle/network layers and must be connected by adapters.
