# Audio foundation

Gameplay audio is frozen with the rest of gameplay. The engine audio contract is a
projection of engine events and sampled physical state.

## Current invariants

- identical event traces render bit-identical PCM;
- stable event identity seeds deterministic procedural detail;
- source position affects stereo projection, not the underlying cause;
- replaying a time window reproduces the same samples as the corresponding interval
  of a continuous render;
- no event means no event voice;
- offline rendering is the regression oracle for the browser/live path.

The snowy arcade/carriage scene may exercise this subsystem, but it is not part of the
audio API and must not introduce game-specific mixer semantics.

## Gate still to complete

Before gameplay is unlocked, the audio layer still needs explicit hard budgets for
live voices/DSP/work queues, generic source lifetime/ownership, physical telemetry
adapters for engine/tyre/contact/rotor/environment sources, and causal rows in the
shared runtime inspector. Replay must reproduce the same event/audio timeline without
advancing a second simulation.

Reference recordings are evidence for perceptual tuning only; they do not replace the
causal/deterministic tests above.
