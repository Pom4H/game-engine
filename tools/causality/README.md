# Causal development ledger

Git is the development source of truth. The commit graph already contains the prior state (parents), the intervention (diff), identity/time, and the exact code that CI evaluated. This directory adds the two missing pieces: a machine-readable declaration of *why* a change exists and post-CI evidence of *what it caused*.

## Commit = intervention

Every PR HEAD must describe one causal step with Git trailers:

```text
render(reality): broaden the clearcoat response

Causal-Experiment: stanford-orb
Causal-Observation: held-out highlights are sharper than the measured captures
Causal-Hypothesis: the clearcoat lobe is too narrow
Causal-Intervention: increase only clearcoat roughness response
Causal-Prediction: held-out RealityGap decreases while the 60 fps guards stay green
Causal-Target: RealityGap < parent baseline
Causal-Guard: completedFps >= 59
Causal-Guard: gpuP95Ms <= 16.67
```

Required trailers are `Causal-Experiment`, `Causal-Observation`, `Causal-Hypothesis`, `Causal-Intervention`, and `Causal-Prediction`. `Causal-Target`, `Causal-Guard`, `Causal-Depends-On`, and `Causal-Supersedes` may be repeated.

`WIP`, `fixup!`, and `squash!` are not accepted as causal evidence on a PR HEAD. Intermediate local commits are fine; before pushing a hypothesis for CI, squash/fix them into one interpretable intervention.

The contract also fingerprints `experiment + hypothesis + intervention` against prior notes. Re-running the exact same causal experiment is rejected before the expensive Stanford render. If new evidence really justifies repeating a prior intervention, say so explicitly with `Causal-Supersedes: <sha>`.

## CI = observation

CI evaluates the exact PR head commit, not GitHub's synthetic PR merge commit. `tools/causality/record.mjs` joins the declaration with RealityGap and performance artifacts and emits `game-engine.causal-evidence/v1`.

The evidence is attached to the evaluated SHA with `git notes` in `refs/notes/causality`. This avoids rewriting the commit after measurements exist. The code commit stays immutable while the measured effect becomes durable Git metadata.

Fetch and inspect the ledger:

```bash
git fetch origin refs/notes/causality:refs/notes/causality
npm run causality:history
npm run reality:history

git notes --ref=causality show <sha>
```

## Causal model

```text
parent commit = prior state
    │
    ├─ observation
    ├─ hypothesis
    ├─ prediction
    │
    ▼
commit diff = intervention
    │
    ▼
CI on exact SHA
    │
    ├─ RealityGap
    ├─ frame/GPU budget
    └─ regression gates
    │
    ▼
git note = observed effect + verdict
    │
    ▼
next hypothesis
```

This makes rejected and neutral hypotheses first-class history. A future engineer or agent can query what was tried, on which state, what changed, and what happened instead of rediscovering the same path.

## Verdict semantics

A verdict is only as strong as the experiment whose outcome can actually be evaluated.

For `stanford-orb`, CI has an objective metric and tolerance, so it may classify a result as `accepted`, `neutral`, `rejected`, or `incomplete`.

For other experiment classes the generic recorder uses `observed`. A failing unrelated CI gate is stored as an observation, but it is not automatically treated as proof that the declared intervention caused that failure.

## Rules

1. One pushed experiment commit should represent one interpretable intervention. If several independent causes change at once, the measurement cannot tell which one caused the effect.
2. Predictions are written before CI. Do not rewrite them after seeing the result.
3. An exact previously measured hypothesis + intervention is not rerun implicitly. Change the causal claim, or reference the prior experiment with `Causal-Supersedes`.
4. The held-out benchmark never feeds calibration or authoring decisions directly.
5. A result is evidence for one Git state, not a timeless claim. Follow-up commits create new states and new evidence.
6. Baselines advance only after an accepted experiment; a baseline update must reference the evidence it promotes with `Causal-Depends-On`.
