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

## Direct execution on our GPU workers (without GitHub Actions)

The Actions workflow already uses `runs-on: [self-hosted, Windows, X64]`,
but GitHub can reject a workflow before creating a job (`BuildFailed`,
`startup_failure`, `jobs=0`). That is a GitHub dispatcher failure, not
evidence that our hardware is offline. The same engine capture can run
directly on our Windows RDNA3 or Linux NVIDIA/AMD GPU hosts:

```powershell
# In an existing authenticated checkout on our Windows GPU workstation:
git pull --ff-only
node tools/agent-office/render-on-worker.mjs
```

This installs from `bun.lock`, typechecks, builds, tests 24-fps causal travel,
checks browser code, renders 312 real Chromium/WebGPU frames, enforces a
**hardware** adapter (`CAMPUS_REQUIRE_HARDWARE=1`), verifies the resulting
1920x1080/24fps H.264 file with ffprobe, and checks image/frame provenance.
No Apple, CPU/GPU simulation swap, synthetic fallback, or GitHub Actions is
involved. It fails closed when no hardware WebGPU adapter is available.

Output is copied to
`%USERPROFILE%\game-engine-renders\agent-campus\campus-walkthrough.mp4`
on Windows or `~/game-engine-renders/agent-campus/` on Linux.
Set `ENGINE_WORKER_OUTPUT` for a different destination.

To additionally upload the video, three stills, and verification JSON to the
**private** GitHub prerelease `agent-campus-preview`:

```powershell
# Requires GitHub CLI with write authorization on this worker.
node tools/agent-office/render-on-worker.mjs --publish
```

The release uploader is optional; a lack of GitHub auth must not prevent local
capture. `.github/workflows/agent-campus.yml` invokes the **same entrypoint**
when the GitHub dispatcher is functioning again, so there is only one
validation/execution contract. This script must run on the actual machine;
pushing a commit cannot execute it while the Actions dispatcher is broken.
