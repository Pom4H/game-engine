# Physically coupled acoustic wave + NPC pressure sensor

`src/scene/acoustic-coupling.ts` implements the first executable
cross-domain coupling through World v3's typed graph. It is **opt-in**.
The authoritative owner of rigid bodies and contacts is still `PhysicsWorld`;
the authoritative owner of pressure, velocity and hard acoustic boundaries
is the existing `AcousticWaveField` (TS or Rust/WASM backend).

A coupling is not a trigger for a fake sound, NPC intent, animation or shader.

## The causal physical path

    rigid collision in PhysicsWorld (sequential, contact material policy)
        ↓
    actual normal contact energy E = 1/2 m_eff v_n² (joules)
        ↓
    irreversible NORMAL kinetic-energy loss from measured impulse:
      ΔE = J v_n - J² / (2 m_eff)
        ↓
    acoustic radiation fraction bounded by planar interface impedances:
      Z_air = ρ_air c_air
      Z_solid ≈ sqrt(ρ_solid YoungModulus)
      T = 4 Z_air Z_solid / (Z_air + Z_solid)²
      T_pair = 1 - (1-T_A)(1-T_B)
        ↓
    acoustic packet E_acoustic = min(E_loss, E_loss*T_pair)
        ↓
    AcousticWaveField.injectEnergyPacket (physical pressure field)
        ↓
    staggered-grid wave FDTD, 3D CFL ≤ 1/√3, real hard obstacles
        ↓
    listener RMS sqrt(mean(p²)) from every acoustic substep, in Pa
        ↓
    World Interaction IR: contact → radiation; wave field → NPC hearing
        ↓
    optional AI policy (NOT implemented by this sensing layer)

### Energy and causal guarantees

- The acoustic energy source is bounded by measured, irrecoverable
  *normal* contact impulse work. For a perfectly elastic pair, no normal
  dissipation means no injected sound in this reduced-order model.
- Penetrating/fracturing contacts and aggregate static-ground manifolds
  are excluded. Their available energy already participates in other laws,
  and no credible single-point dissipation formula is available.
- Interface impedance estimates give a physically based **upper-bound
  approximation**, not a validated collision-to-sound radiation model. Real
  frequency-dependent radiation, resonant structural modes and membrane
  displacement still require dedicated physical coupling, not guessed
  calibration coefficients.
- A new source is superposed onto existing pressure by solving the exact
  quadratic increment in **compressional wave energy**. Its injected energy
  cannot exceed its dissipated normal-energy budget. Pressure energy later
  exchanges with the medium's velocity energy; no invalid claim that wave
  pressure energy alone is conserved during propagation is made.
- A contact outside the wave grid or with no exposed air cells adds no
  acoustic energy; a diagnostic counter records the failed source.
- Obstacles derive from authoritative `mesh`/`RigidBody`
  geometry; `renderMesh` and `renderOnly` never
  create acoustic obstacles. Dynamic geometry is reprojected every acoustic
  commit, so wall movement affects subsequent pressure.
- RMS pressure is sampled at **the acoustic CFL rate**, not aliased down
  from a lone 60 Hz sample. The listener must be an existing Scene entity.
  This is a sensory observation, not proof an NPC recognizes speech or reacts.
- The plugin is registered through the Scene scheduler in the *commit*
  phase after `destruction.resolve`. It cannot change the
  contact material decision, rigid motion, generated fracture fragments or
  the original EngineEvent audio stream.

## Native .world example

`examples/worlds/physical-hearing.world` declares:

    coupling contact_air {
      from: physics.contact.energy
      to: acoustic.source.energy
      min: 0.01J
    }
    coupling heard_pressure {
      from: acoustic.pressure
      to: npc.hearing.pressure
      min: 0.05Pa
    }

The Rust compiler verifies both dimensions and graph dependencies. The
runtime only realizes links when an actual energy-bearing contact or
pressure reading is observed; declaring them does not emit fabricated
sound or NPC states.

## Usage

~~~ts
import {Scene,AcousticWaveField,attachSceneAcoustics} from '@rom4/game-engine';

const scene=new Scene(worldBinary);
scene.enableWorldInteractions(2048);
const field=new AcousticWaveField({
  size:[40,10,20],origin:[-10,0,-5],
  cellSizeM:0.5,waveSpeedMps:343,densityKgM3:1.225,
});
const acoustic=attachSceneAcoustics(scene,field,{
  fieldId:'outdoor-air',
  listeners:[{entityId:'listener'}],
});

scene.step(1/60);
const rms=acoustic.sensor('listener')?.rmsPressurePa;
const causal=scene.worldInteractionGraph();
// source-effect 'acoustic-radiation' has causeId of exact contact.
// sensor effect 'hearing' measures RMS pressure in the existing field.
// Both annotate matching compiled couplingIds, without fake NPC actions.

acoustic.close();  // disables the plugin path
field.dispose();   // caller owns the physical medium
~~~

The field must be sized to include source and listener locations, and its
wave speed/density must reflect the chosen medium. Current medium parameters
remain fixed during simulation; weather-driven sound-speed variation is
future work and is not claimed here.

The plugin has a bounded `maxSubsteps` setting (default
512). If a very fine grid requires more than the cap at the current scene
rate, it throws rather than violating the 3D CFL condition. The field's
normal size limits and optional Rust/WASM zero per-tick-copy core still apply.
All graph observation is optional, deep-frozen and bounded by the existing
World Interaction IR journal.

## Tests and limits

`test/scene-acoustic-coupling.test.mjs` checks:
- exact energy injection on quiet and non-zero existing wave state;
- finite propagation and full-wall occlusion;
- compiled World v3 sources and NPC listeners;
- material and physics invariants vs a scene with no sound plugin;
- exact impact-energy bounds and causal parents in World Interaction IR;
- render-only sensors do not become walls;
- identical TS and Rust/WASM numerical acoustic pressure and RMS.

This is not a measured, full-audible-band production sound renderer.
The existing procedural audio synthesizer continues to be available for
headphones/video; no automatic double-mixing of the two approaches occurs.
Audio playback from the pressure field requires a sample-rate-correct
receiver/downsampler and air/boundary calibration.

## Performance profiling

The CI run executes `node tools/world-acoustics/benchmark.mjs` and stores
`artifacts/world-acoustics/benchmark.json` alongside the compiled Rust/WASM
wave kernel. It compares identical World v3 scenes with the same KernelProgram
dispatch: baseline without an acoustic field, CPU TypeScript wave solver and
Rust/WASM wave solver. Results include per-tick p50/p95 CPU times, isolated
acoustic system timing, fixed grid memory, CFL substeps, real injected energy
and peak measured NPC RMS pressure. These are full Scene physics CPU timings,
not graphical FPS, video latency or perceptual accuracy.
