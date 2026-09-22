# Agent instructions

<!-- usegit:start -->
## Causal Git memory and durable work

This repository uses usegit as design-time memory and durable execution state. A model invocation owns only the next decision; Git owns the work state.

1. Before editing, run `npx --yes github:Pom4H/usegit#experiment/causal-memory-v0 context`. Inspect `work.workerReady`, `work.queueBlocked`, `work.controlQueue`, `work.active`, `work.awaiting`, `work.stale` and `work.conflicts`; do not duplicate existing work.
2. Control agents preferably create batches of WORK with scopes, success criteria, evidence plans, priorities and dependencies. Low-uncertainty work with an objective oracle is routed to `work.workerReady`; ambiguous work stays in control.
3. Cheap workers only claim `work.workerReady`; prefer `npx --yes github:Pom4H/usegit#experiment/causal-memory-v0 claim-next` so workers self-schedule. Do not take control-queue work or improvise architecture.
4. If a worker finds conflicting evidence, architecture ambiguity, or repeated unexplained failure, run `npx --yes github:Pom4H/usegit#experiment/causal-memory-v0 escalate WORK-* --reason ...` and return the decision to control.
5. Never steal an unexpired lease. Before waiting on CI or another external event, persist the continuation with `npx --yes github:Pom4H/usegit#experiment/causal-memory-v0 await WORK-* --event ...`. A later fresh invocation resumes with `npx --yes github:Pom4H/usegit#experiment/causal-memory-v0 resume WORK-* --result ...`.
6. Work under an experiment with one falsifiable hypothesis. Create an experiment record when no existing experiment covers the change.
7. Keep one stable `Usegit-Change-Id` across revisions of the same conceptual change.
8. Every non-merge commit after the bootstrap commit must include `Usegit-Change-Id`, `Usegit-Experiment`, `Usegit-Intent`, `Usegit-Hypothesis`, `Usegit-Granularity`, and `Usegit-Decision` trailers.
9. Treat commit granularity as dynamic: one independently falsifiable causal unit. Implementation, its directly coupled test, and minimum documentation may belong together.
10. Preserve rejected and falsified hypotheses with their conditions. Do not silently retry equivalent failed work.
11. Pull requests are integration boundaries, not work containers. Do not create a PR per task or agent.
12. After an experiment changes state, run `npx --yes github:Pom4H/usegit#experiment/causal-memory-v0 next` and let accumulated evidence propose the next falsifiable step.

<!-- usegit:end -->
