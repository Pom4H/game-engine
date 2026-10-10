# Agent Campus — office-to-office walking proof

`bun run office:campus` starts a two-room isometric toy-brick campus
at http://127.0.0.1:4182. Research and Build are distinct spaces connected
by a visible shared corridor.

**Video:** `node tools/agent-office/campus-capture.mjs` on a Windows
self-hosted GPU runner. The executable records every Chromium WebGPU frame
through DevTools, encodes a 1280×720 H.264 MP4 with FFmpeg, verifies it with
ffprobe, and uploads its first/middle/last still frames and frame evidence.

The video uses **synthetic** ActivityFacts stored in
`examples/agent-office/campus-replay.json`; it is not live ChatGPT internal
subagent movement. The motion is an explicit projection of paired
`agent.move.started` → `agent.move.completed` events and their
`causeId` lineage. No completion event means no invented known trajectory.
Route interpolation, turn heading, swing, and foot motion are deterministic
functions of the logged timestamps and the visualized world coordinates.
Seeking backward restores poses; zero physics bodies are allocated.

The simulation kernel is **not modified**. Scene geometry, batching, WebGPU,
rendering, and replay all use the existing engine contracts. In a real
orchestrator, the location and arrival events must be emitted from actual
source actions, not guessed by the renderer.
