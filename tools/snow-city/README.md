# Snow city stream

The M3 FBX parts and the original procedural pedestrians are reused here. The
winter demo under `tools/winter` remains intact; its files matched the saved
October 2 stash during the recovery audit.

Cars use the native drivetrain, wheel contact and suspension, with routes across
96 metre city blocks. Controller heading and attached cameras use the complete
body orientation. High throttle, gear changes, deliberate sliding and recovery
inputs affect the physical simulation. Contact work deforms panels; a bounded
reduced structural impulse keeps the cage stable. This is an approximate soft
body presentation, not a full vehicle crash solver.

The park has 48 cm of deformable snow. Its fine surface records footprints and
snow angels independently of the coarse weather grid. Snowball throwing,
rolling, lifting and destruction retain their native scene mechanics.

## Shared physical state

Build the engine and regenerate the authoritative physical recording with:

```sh
npm run snow-city:record
```

`record.mjs` computes 128 seconds at 60 Hz using native physics; wheels internally
use 120 Hz. `timeline.bin` stores physical states and camera decisions, with soft
presentation snapshots at 10 Hz. Browser render workers restore the assigned
state without replaying preceding seconds. Engine and scene source fingerprints
are checked by `test/snow-city-regressions.test.mjs`; regenerate after changes.

The current streaming mode repeats this physical visit in translated procedural
districts every 128 seconds. The city geometry is unbounded, but the stream does
not yet run a continuously evolving population across the entire infinite city.
The explore view runs the native simulation rather than the stream recording.

Rendered resolution and frame rate still depend on actual worker capacity. A
1920x1080/60 output profile does not establish sustained 60 FPS. Measure both
segment generation and uninterrupted player playback before claiming that rate.

## Recovery verification, 2026-10-03

- Engine typecheck/build and all 211 native tests passed with test concurrency 2.
- Meshwork typecheck and 66 tests passed, including variable range ordering,
  retry priority, AAC packet ownership, and playback windows for short fragments.
- PC, Safari MacBook and iPad each produced real H.264/AAC Full HD segments with
  all 120 assigned frames at 60 FPS. This proves encoding correctness, not a
  sustained 60 FPS live stream.
- The same 40-frame wing-camera sample fell from 10.8 seconds to approximately
  2 seconds after fixing distant reflection-map rebuilds. The late-frame probe
  also eliminated 1,680 redundant simulation ticks.
- The final 45-second ordered Full HD run measured 21.71 newly playable frames
  per wall second on the PC and Safari MacBook. With the iPad reconnected, a
  subsequent Full HD run reached 25.26 FPS on all three devices, without encoder
  failures. The earlier 12.65 FPS measurement
  preceded the Windows/Bun MP4 allocation repair; this is not a controlled
  single-worker versus two-M1 scaling benchmark. Auto starts from 1080p/10 FPS
  and adjusts the target to measured capacity. Sustained Full HD/60 is unproven.
- Live production is now paced to a 20-second lead. Previously the fast mesh
  advanced the rolling playlist faster than playback, causing stalls and scene
  skips even when rendering capacity exceeded the target frame rate.
- The final 110-second 1080p/10 player check advanced continuously at normal
  speed, without HLS errors, pauses or timeline skips. PC and MacBook continued
  supplying valid video while the iPad was absent. Auto was then enabled at the
  same Full HD profile; the stable stream/chat URL and mobile layout passed QA.
- Live capture, desktop/mobile layout and shared chat were checked on the stable
  `https://this.host/watch/11952965-b7ea-4ae2-88c8-66da8d6eaa2a` URL. Scene changes
  and the browser release update were picked up by the devices automatically.

Machine-local evidence is under the Meshwork checkout's
`.meshwork/lan/snow-next-evidence/` and `.meshwork/lan/physical-evidence/`.
