# Offroad integration audit — 2026-10-25

The requested scope includes water, dry/wet snow, ice, mud and sand; their
interaction with tyres and suspension; spray, dust and clumps; and persistent
snow/dirt on the vehicle. An implementation in the shared Engine is distinct
from its connection to the canonical Game authority and presentation.

| Capability | Current evidence | Remaining work in the Game |
| --- | --- | --- |
| Local water, soil moisture, ice, seasonal snow | `src/environment/soil-hydrology.ts`; Game `world-hydrology.ts` replicates the authority field | Verify mixed surfaces and transitions under each wheel |
| Wet tyre grip, mud/ice grip scale, mud resistance | Game `runtime/dynamics.js` samples hydrology at the actual wheel contact before solving combined forces | Dedicated speed/depth/tread/load aquaplaning law is absent |
| Snow support, compaction, tracks, melting | Engine `snow-matter.ts`, `snow-surface.ts`; Game `snow-physics.ts`, `snow-volume.ts` | Unified loose snow/slush ejection driven by authoritative tyre work |
| Water/mud spray | Engine `surface-contacts.ts`: contact velocity, depth, lateral fan, ballistic lifetime, bounded particle pool | The render-only Game projection does not step this Scene system; no verified production tyre-spray binding |
| Dirt and snow on bodywork | Engine `surface-state.ts`, material shader: contact-work dirt, upper/rear snow, shedding, melting, wetness drying | Bind one authority-owned coating state to all vehicle body parts; validate local-space masks, dirt drying and washing |
| Loose sand and deep mud | Material grip and resistance paths exist | Load-dependent sinkage, displaced material, persistent ruts and tyre tread evacuation are incomplete as a unified model |
| Water rendering on bridge ramps | Engine `water-surface.ts`; Game `HydrologyView` samples its real static support | Controlled GPU bridge fixture passes visual review; broader terrain/vehicle coverage remains separate |

## Existing adjustable bounds

- Global performance profile: `engineBudgets({fps, tickHz, physicsHz, limits})`.
  Missing measurements do not pass a budget gate.
- Water-cell tessellation: `WaterSurfaceCell.segments`, integer 1–16; maximum
  `4 * segments²` faces including shoreline clipping. The Game uses two
  segments on raised supports: eight film faces (sixteen at a shoreline) and
  at most nine new support samples per cell.
- The Game caches at most 2,304 support samples per visible hydrology tile,
  invalidates them on geometry revision, and releases unloaded tiles. A valid
  wire frame contains at most nine tiles with 256 cells each.
- Engine spray pool: `SurfaceContactsOptions.particleCapacity`, default 96,
  range 1–2,048. Presence of this bound does not establish a Game integration
  or its measured frame cost.

## Acceptance for the full integration

One contact record must carry the local layer composition/depth, moisture,
compaction, contact normal/load, tyre velocity and slip. Physics, audio,
surface deformation, emitted particles and body deposition consume the same
authoritative causes. Presentation must not advance a second vehicle simulation.

Required replays include a stationary vehicle, straight rolling, braking,
cornering, partial puddle entry, mixed left/right surfaces and transitions
between water, snow, slush, ice, mud and sand. Compare fixed cameras and moving
cameras, preserve the same fixture and quality, and measure CPU/GPU/frame tails
with explicit particle/query/geometry bounds. The full offroad integration is
not yet reported as complete.
