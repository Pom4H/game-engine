# Engine-first trunk

The repository uses one active development branch: `main`.

No long-lived feature, integration, staging, gameplay or foundation branches are part of
the development model. Work lands directly on `main`; CI is the gate.

Gameplay remains frozen. Existing game/example code may only be used as regression or
stress fixtures while the engine foundations are completed.

Development order:

1. rendering;
2. networking;
3. audio;
4. physics;
5. game code only after the four engine gates are explicitly satisfied.

Rules:

- renderer, network, audio and physics APIs must remain game-agnostic;
- no missing engine capability may be patched in game code;
- every expensive queue/cache/resource must be bounded and inspectable;
- deterministic replay/regression evidence belongs in CI;
- physics forces/torques/impulses need explicit provenance;
- real-world data, not historical Thegame behavior, is the eventual physics target;
- old branches/PRs are archaeology only and must not become alternate sources of truth.

The only source of truth for current engine behavior is `main`.

## Loop Engineering

Engine laws are derived from physics and invariants, never tuned merely to satisfy a fixture. Every proving-ground iteration should combine independent numerical and visual evidence when the phenomenon is spatially observable. See [LOOP_ENGINEERING.md](LOOP_ENGINEERING.md).
