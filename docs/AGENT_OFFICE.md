# Agent Office — Toy-brick causal observatory

WebGPU scene for observing agent work as a friendly miniature toy-brick office.
**This is executable The Engine geometry**, not a generated illustration.

Run: `bun run office:demo` (synthetic replay, localhost:4176) or
`bun run office:live` (blank until real events arrive).
`bun run office:check` tests scene, replay and adapters.
The browser loads a real `Scene` and `WebGPURenderer`.

## Domain boundaries

`ActivityFact` in `src/observability/activity.ts` is the sole source of
agent observations. Neither the Lego-style character nor its status tile
controls tools, creates a task, or updates another agent's state.
Demo events explicitly have `origin: demo`. Observed events require
`origin: observed`. Only observed, externally committed work may be
presented as real ChatGPT/Codex activity.

The scene uses box/cylinder prefabs, reduced-geometry minifigs, a small
catalog of plastic materials and spatial/material batching for static
props and brick studs. Only four arms/hands and one status tile per
agent are dynamic in the renderer. Rigs/cloth/physics are not allocated.
At most 8 agents get full toy bodies in this MVP; scale beyond 8 via
hierarchical group aggregation (future project); do not silently
represent hidden agents as rendered.

Color semantics: offline gray, idle yellow, working blue, tool orange,
blocked red, done green. Deterministic seek must exactly restore poses
and colors without stepping the physics world.

## Real Codex activity: recommended event source

Codex **app-server** emits structured JSON-RPC notifications
(`thread/started`, `turn/started`, `item/started`,
`item/completed`, `turn/completed`, `thread/tokenUsage/updated`).
See the official documentation:
https://developers.openai.com/codex/app-server
https://github.com/openai/codex/blob/main/sdk/typescript/README.md

`src/observability/adapters/codex.ts` converts **actually received**
app-server notifications into `ActivityFact` records. Its
`collabAgentToolCall.receiverThreadIds` handling can show subagents
only when there is explicit evidence of real receiver threads.
The adapter does not read/store raw prompts, hidden reasoning,
tool input/output, shell commands or arbitrary file contents.
`totalTokenUsage.totalTokens` is cumulative, so the adapter only
records nonnegative deltas and does not invent model prices.

To pipe notifications already duplicated from your Codex host
(no extra Codex credentials or process control needed):

~~~sh
AGENT_OFFICE_TOKEN=secret bun run office:live
# Another process holding an authorized *copy* of app-server JSONL:
cat /path/to/redacted-codex-notifications.jsonl | node tools/agent-office/codex-bridge.mjs
~~~

Normally instrument the **existing app-server client**: call
`adapter.push(notification, Date.now())` on each notification and
forward returned facts to `POST /api/events`. The CLI bridge only
consumes a duplicate notification stream; piping directly from
`codex app-server` would interfere with the host's bidirectional RPC.

## ChatGPT: what can be observed

A ChatGPT Apps SDK / MCP app can embed a UI backed by **its own**
orchestrator's events, tool invocations or Agent SDK traces:
https://developers.openai.com/apps-sdk/
https://developers.openai.com/api/docs/guides/agents/integrations-observability

A third-party app does **not** receive a complete internal ChatGPT
subagent stream. Do not imply that hidden reasoning or invisible
model delegates are instrumented. On a host without WebGPU,
show a 2D list/timeline with the same causal event identity rather
than trying to infer or fabricate 3D activity.

## Efficiency and display LOD

For Codex/ChatGPT, prefer event-driven projections. Do not render
continuously while idle, poll at frame rate, or create a detailed 3D
character per token. Render only a few groups in overview; let the user
open a team for toy figures, then an agent for the event/cause trace.
Scene LOD is not authority LOD: all source events remain in the
journal even when the drawing aggregates or culls actors.

Each fact has stable IDs, actor and target domains, source time,
optional `causeId` and **incremental** token/cost/duration accounting.
Missing parents remain explicitly unresolved. Connect GitHub CI and
shell traces as *tool events*; never assume a task succeeded before
the tool/server commits the result.

## Live ingress

The server is loopback-only. In live mode:
- `GET /api/snapshot` lists facts, stats and dropped count.
- `GET /api/stream` supplies new observations via SSE.
- `POST /api/events` accepts one or up to 128 atomic observed facts.
- `AGENT_OFFICE_TOKEN` optionally requires HTTP Bearer auth.
Use an SSH tunnel when observing a remote process. Do not expose it
without authentication.

Example fact:
~~~json
{
  "schema":"engine.activity.v1",
  "id":"run-42:tool",
  "atMs":1791645000000,
  "actor":{"domain":"agent","id":"builder"},
  "kind":"agent.tool.started",
  "origin":"observed",
  "target":{"domain":"tool","id":"github"}
}
~~~

## CI proof

The Windows self-hosted GPU workflow verifies strict TypeScript,
the causal/activity tests, the Codex adapter and browser syntax.
A real Chromium/WebGPU run must submit draw calls, remain below the
toy-geometry budgets, seek a failed and completed state, and produce
both screenshot and raw canvas PNG plus inspectable JSON evidence.
