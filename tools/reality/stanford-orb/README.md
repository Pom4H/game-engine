# Stanford-ORB RealityGap experiment

This benchmark is the renderer's external reality feedback loop. It measures the production WebGPU path against held-out Stanford-ORB car captures while keeping calibration views separate.

## North Star

Minimize held-out `RealityGap` without violating the runtime guards.

Current committed baseline:

```text
RealityGap = 0.23563216891992333
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

CI then renders the held-out captures, computes RealityGap, measures the GPU/runtime budget, and attaches the combined observation to the exact commit in `refs/notes/causality`.

To see the experiment history:

```bash
git fetch origin refs/notes/causality:refs/notes/causality
npm run reality:history
```

The history is derived from Git; there is no manually maintained experiment log to drift from the code.

## Interpretation

For `stanford-orb` notes, the automatic verdict is:

- `accepted`: RealityGap improved relative to the committed baseline and the measured CI guards passed;
- `rejected`: RealityGap regressed, a regression was reported, or a measured CI guard failed;
- `neutral`: the measured RealityGap equals the baseline;
- `incomplete`: enough evidence was not produced to decide.

A rejected note is valuable. It prevents the same renderer idea from being rediscovered and retried without new evidence.
