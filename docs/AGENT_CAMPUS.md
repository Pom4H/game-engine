# Agent Campus — office-to-office walking proof

`bun run office:campus` starts a two-room isometric toy-brick campus
at http://127.0.0.1:4182. Research and Build are distinct spaces connected
by a visible shared corridor.

**Video:** `node tools/agent-office/campus-capture.mjs` on a Windows
self-hosted GPU runner. The executable supersamples the WebGPU backbuffer by 4/3 in both dimensions, then records every Chromium compositor frame
through DevTools, encodes a 1920×1080 H.264 MP4 at 24 fps with FFmpeg, verifies it with
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

## Visual quality gates

CI asserts a 2560×1440 supersampled render target for 1920×1080 video, <170 draw calls, no GPU validation errors, three distinct still frames, 312 decoded H.264 frames, and smooth per-frame spatial motion. A continuous Catmull–Rom walking path replaces the former right-angle polyline. Colour and contrast are authored in the actual materials and light sources; a filter cannot make up missing office geometry.
