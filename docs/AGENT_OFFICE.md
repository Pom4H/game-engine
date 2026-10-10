# Agent Office — causal activity observatory

A WebGPU 3D office driven by a bounded log of external facts. Geometry, characters,
lighting and render ownership belong to The Engine (Scene, procedural character
compiler, WebGPURenderer). Agent decisions stay in their own orchestrator.

## Run

~~~sh
bun install --frozen-lockfile
bun run office:demo     # synthetic replay at http://127.0.0.1:4176/
bun run office:live     # live mode; initially empty
bun run office:check
~~~

Demo input: examples/agent-office/replay.json. Every demo fact explicitly
says origin=demo. **These are not actual ChatGPT internal subagent events.**
To see real agents, instrument the agent orchestrator to send observed facts.

## Live ingestion

POST /api/events accepts one fact or up to 128 as an atomic batch:

~~~json
{
  "schema": "engine.activity.v1",
  "id": "run42.start",
  "atMs": 1791645000000,
  "actor": {"domain": "agent", "id": "builder"},
  "kind": "agent.started",
  "origin": "observed",
  "label": "Builder"
}
~~~

Other agent verbs: agent.task.started, agent.tool.started,
agent.tool.completed, agent.tool.failed, agent.task.completed,
agent.task.failed, agent.stopped. Each may include target, causeId and
incremental usage {tokens,costUsd,durationMs}. The HTTP viewer accepts
facts but cannot execute any agent or tool.

- GET /api/snapshot — bounded activity journal, dropped count and mode.
- GET /api/stream — SSE for newly committed facts.
- POST /api/events — observed events only (in live mode).
- Optional AGENT_OFFICE_TOKEN — HTTP Bearer token on event POST.
- Server binds **loopback only**. Use an SSH tunnel for remote viewing.

Example:

~~~sh
AGENT_OFFICE_TOKEN=secret bun run office:live
curl -X POST http://127.0.0.1:4176/api/events -H 'content-type: application/json' -H 'authorization: Bearer secret' -d '{"schema":"engine.activity.v1","id":"run42.start","atMs":1791645000000,"actor":{"domain":"agent","id":"builder"},"kind":"agent.started","origin":"observed","label":"Builder"}'
~~~

## Causal contract

src/observability/activity.ts defines reusable versioned ActivityFact.
Both office agents and future economic actors use the same event structure:
stable identity, source timestamp, actor domain, namespaced action, target,
optional causeId and accounting. A missing/evicted cause stays unresolved.
The journal is bounded, validates untrusted input, preserves chronological
ordering across independent sources, and ingests batches atomically.

src/observability/office.ts is only a *projection* for agent.* verbs.
It does not synthesize agent thoughts, business events, trades or costs.
The same log + cursor yields the same states and visual poses, even when
scrubbing backwards. Character poses and status indicators have no
collision authority.

## Checks and GPU evidence

test/agent-office.test.mjs verifies causal ancestry, bounded retention,
atomic validation, replay determinism, accounting, real Scene geometry,
zero physics bodies and the loopback live API.

.github/workflows/agent-office.yml runs on the self-hosted Windows GPU worker,
checks TypeScript and Node tests, opens the actual UI in Chromium,
verifies renderer/GPU/scene facts, seeks through a failing and successful
CI stage, and publishes real PNG captures and evidence JSON as artifacts.
