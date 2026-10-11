# Literature → World → The Engine (offline prototype)

This **does not claim to understand arbitrary Russian poems or books**.
It establishes a deterministic boundary for a language model's interpretation:
prose can propose facts, metaphors, geometry and cameras, but only
**dimension-supported literal evidence** may update pre-existing physical state.

## Run

```sh
bun install --frozen-lockfile
bun run build
node tools/literature/compile.mjs
node --test test/literature.test.mjs
```

Output is `artifacts/literature/scene.json`, `provenance.json`, and the
`driver.scene.json` and `observer.scene.json` camera projections. At runtime use **one** `Scene`
and `Scene.setCamera(shot.camera)` to change observers; the per-shot JSONs are
only convenient standalone captures.
These are ordinary engine `SceneSpec` documents. Supply one to
`sceneFromURL('?src=/artifacts/literature/observer.scene.json')`
through an HTTP server, or `new Scene(spec)` headlessly. Browser rendering
continues through the existing WebGPU path (no new renderer).

## Boundary

```text
Russian original (original text)
  -> model / human proposal (examples/literature/*.draft.json)
  -> strict quote spans + unit-backed literal claims
  -> Rust World (precompiled physical baseline) + fact patches
  -> validateScene -> engine-native SceneSpec -> physics/Render IR
                                       |
                              renderOnly interpretations
                                       |
                           observers (camera-only views)
```

A draft is intentionally simple JSON so local/offline or connected LLMs can
produce it without a custom runtime. `claims` retain exact UTF-16 spans
(including explicit offsets for repeated quotations). `facts` are
whitelisted numeric environment/entity updates. The current prototype
supports temperature, snowfall intensity, body mass and east/west speed
against actual numbers/units in source. A blizzard alone does **not**
prove that snow is falling. `visuals` must be explicitly `renderOnly`
and cannot own physics or environmental fields. Figurative and uncertain
claims can never become physical facts. Validation fails closed.

World's physics/rendering/audio remain authoritative. The example river
is **visual only**; the vehicle is a single rigid-box **proxy**, not the
existing high-fidelity vehicle assembly. "The bridge sighed" is retained
as a figurative passage and does **not** apply arbitrary structural force.
The light/snow are not neural renders, and a single generated illustration
is not evidence of physical fidelity.

Unit agreement is **not semantic proof** that a quotation describes a given
entity. Entity grounding, geometry scale, identities across passages, and
physical causality still need authoritative checks; this boundary does not
pretend to solve natural-language understanding.

For a book, the next layer is an adapter from a model's structured output
to this contract, continuity across chapters, and cached visual assets.
A model must not interpret its own guesses as physical measurements.
The acceptance gate is two observers with identical physical replay,
consistent identities over time, and evidence provenance.
