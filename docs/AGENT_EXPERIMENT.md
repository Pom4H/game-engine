# Agent experiments

This is an **opt-in development tool**, not a new simulation runtime or agent-specific physics.
An agent can run a falsifiable experiment with one command, inspect the first failure,
follow committed causes, and compare CPU measurements. The engine's existing Scene,
World Interaction IR, and ScenePerformanceProfiler remain authoritative.

## One-command proof

~~~sh
bun run build
node tools/agent/experiment.mjs examples/agent/glass.experiment.json
~~~

Exit codes: 0 = assertions and replay passed, 1 = evidence failed, 2 = invalid invocation.
Artifacts go to artifacts/agent/glass/report.json and trace.jsonl by default.
Pass a second argument for a different output directory. CI preserves these files
even when a fixture fails.

Experiment configuration:

~~~json
{
  "scene": "./glass.scene.json",
  "ticks": 30,
  "traceCapacity": 4096,
  "tickBudgetMs": 5,
  "sampleEvery": 5,
  "assertions": [
    {"type": "entity-absent", "id": "glass"},
    {"type": "event-count", "event": "fracture", "min": 1},
    {"type": "interaction-count", "effect": "contact", "min": 1}
  ]
}
~~~

Scene can be a validated SceneSpec JSON file, a compiled .wscn binary,
or a .world source compiled by the existing Rust worldc executable.
The programmatic Node API also accepts SceneSpec directly:

~~~js
import {runAgentExperiment} from './tools/agent/experiment.mjs';
const result=runAgentExperiment(sceneSpec,{ticks:120,assertions:[]});
~~~

The experiment starts two independent Scenes from the same input: baseline
and observed. Each tick checks the authoritative snapshot, committed event
sequence and corresponding typed event records in World IR. The observed
run additionally samples CPU system costs and streams the original immutable
interaction records to JSONL, using a cursor. A ring overflow within one
tick fails rather than silently dropping causal evidence.

JSON report includes the first divergent tick and field, pass/fail
assertions, SHA-256 of per-tick snapshots, interaction/event counts,
contact-to-event examples, and sampled p50/p95 per-system CPU time.
The JSONL contains the full SI-unit records, whose causeId links lead
back to committed physical contacts; no fabricated causal explanation.

The optional maxP95Ms assertion measures **CPU simulation time on the
runner that executed it**, not GPU render time, total frame pacing, or FPS.
Only compare performance on the same runner/profile; don't treat a local
timing result as a cross-machine baseline. This tool does not substitute
for GPU/visual/audio release gates.

The agent's loop should be: state a physical hypothesis, encode a scenario,
run this command, inspect the first failure + cause, correct the physical law,
then rerun. No test-specific coefficient tuning.


## Self-hosted agent CI and repair loop

The agent CLI also creates **diagnosis.json**, derived from the actual
trace.jsonl records, their parent causeIds and measured CPU system costs.
It ranks investigation candidates, links real implementation files and
tests, and provides an identical retry command. These pointers are not
proof that a particular law is defective: the agent must inspect the
underlying physical model before editing it.

The Agent Experiment workflow runs only on [self-hosted, Windows, X64].
It never falls back to hosted CI; if the worker is offline, the job stays
queued. Other repository workflows retain their own runner policies.
