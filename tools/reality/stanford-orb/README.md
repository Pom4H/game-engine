# Stanford-ORB RealityGap experiment

This benchmark is the renderer's external reality feedback loop. It measures the production WebGPU path against held-out Stanford-ORB car captures while keeping calibration views separate.

## North Star

Minimize held-out `RealityGap` without violating the runtime guards.

Current committed baseline:

```text
RealityGap = 0.23563216891992333
tolerance  = ±0.003
```

Runtime guards used by CI include `completedFps >= 59`, `submittedFps >= 59`, real-time simulation ratio, and GPU p95 `<= 16.67 ms`. Frame-time gates are defined by the workflow and may be stricter for individual tiers.

`manifest.json` is the split contract. `scene004` test views 0/2/4 are calibration, 1/3 are held out, and scene002/scene006 are stricter novel held-out views. Held-out data must not change material, exposure, albedo, camera calibration, or any fitted renderer parameter.

## Experiment protocol

A renderer hypothesis is declared in the commit before CI runs:

```text
Causal-Experiment: stanford-orb
Causal-Observation: <measured mismatch>
Causal-Hypothesis: <proposed physical/rendering cause>
Causal-Intervention: <the one thing this diff changes>
Causal-Prediction: <expected held-out effect>
Causal-Guard: completedFps >= 59
Causal-Guard: gpuP95Ms <= 16.67
```

Before the expensive render, CI fetches `refs/notes/causality` and rejects an exact previously evaluated `experiment + hypothesis + intervention` fingerprint unless the new commit explicitly references that experiment with `Causal-Supersedes`.

CI then renders the held-out captures, computes RealityGap, measures the GPU/runtime budget, and attaches the combined observation to the exact commit in `refs/notes/causality`.

To see the experiment history:

```bash
git fetch origin refs/notes/causality:refs/notes/causality
npm run reality:history
```

The history is derived from Git; there is no manually maintained experiment log to drift from the code.

## Interpretation

For `stanford-orb` notes, the committed baseline tolerance is part of the statistical decision boundary:

- `accepted`: RealityGap improves by more than the baseline tolerance and the measured CI guards pass;
- `neutral`: RealityGap delta remains inside `±tolerance`; this is treated as noise / no demonstrated improvement;
- `rejected`: RealityGap regresses by more than the tolerance, a benchmark regression is reported, or a required measured guard fails;
- `incomplete`: enough evidence was not produced to decide.

A rejected or neutral note is valuable. It records a tested path so the next iteration starts from evidence rather than rediscovering the same renderer idea.
