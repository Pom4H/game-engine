# Causal render contract

This boundary is the stable source of truth between simulation and every renderer.

```
authoritative world / physics
          |
          v
CausalRenderObservation
          |
          +--> analytic WebGPU / CPU renderer
          +--> future neural renderer
          +--> distributed render workers
```

## Invariants

1. Physics and world state are authoritative. A renderer may approximate appearance but must not create persistent state.
2. `mesh` remains physical/collision geometry. `renderMesh` is a visual representation only. Portable observations carry references to both.
3. Surface identity is stable across frames. Temporal reconstruction should follow the surface/entity identity plus physical motion instead of inferring identity only from pixels.
4. Geometry and motion use SI units: metres, seconds and radians. World is right-handed with +Y up. Radiance crossing the boundary is scene-linear.
5. Dynamic material causes that affect appearance (water, snow, ice, dirt, wear and body deposition) cross this boundary as named physical state, not shader-specific packed channels. Spatial ruts/compaction/shear and local snow/water state cross as a content-addressed `surface-field` resource.
6. Render depth, Meshwork placement and accelerator selection remain outside the semantic observation. A renderer may choose mesh, height field, SDF, procedural or learned representations without changing the cause.
7. Learned inference must never block the authoritative simulation tick. Missed inference deadlines fall back to an older valid decision or deterministic implementation.
8. Training samples are keyed by content-addressed observation/frame resources. A contract-version change invalidates only samples whose semantics changed.

## Training gate

Do not train a production neural renderer against private WebGPU implementation details. First make an expensive reference renderer and the existing renderer consume the same causal observation semantics. Training then approximates:

```
reference(CausalRenderObservation) -> HDR
```

rather than learning accidental G-buffer or shader layout.

## Accelerators

Execution placement owns hardware. `ExecutionAccelerator = cpu | gpu | npu` deliberately does not appear in Render IR.

NPU workers are intended for asynchronous inference such as decision policies, observation/depth prediction, expert routing and other work whose result can be validated or discarded. Authoritative collision integration, conservation and persistent world mutation stay in deterministic simulation code.
