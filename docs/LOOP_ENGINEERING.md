# Loop Engineering

Loop Engineering is the development rule for the engine proving ground.

The loop is:

```text
physical question
  -> mathematical model
  -> minimal engine law
  -> proving-ground fixture
  -> independent measurements
  -> first divergence
  -> simplify/fix the model
  -> repeat
```

The test is not the source of truth. The physical model is.

## Non-negotiable rules

1. **Derive before tuning.** Write the governing relation, units and assumptions before changing coefficients or thresholds.
2. **No "make the test green" constants.** A number must come from geometry, material data, a dimensional relation, a measured calibration source, or an explicitly documented numerical-stability bound.
3. **Prefer conservation and closure.** Momentum, energy, force/torque closure, dimensional consistency and causality are stronger than scenario-specific expected values.
4. **One physical cause, one law.** Do not add mode switches such as "car physics", "aircraft physics" or a special force for a particular test station.
5. **Delete abstractions that only forward state.** Keep the shortest path from physical state -> law -> contribution -> integration. An abstraction earns its place only by enforcing an invariant, ownership boundary, dimensional type, or reusable physical law.
6. **Do not preserve historical behavior for its own sake.** Thegame and old branches are migration evidence, not reality oracles.
7. **A failed proving-ground test is evidence.** First identify which assumption, equation, geometry or numerical method is wrong. Do not weaken the assertion before that investigation.
8. **Multiple independent measurements.** Every important experiment should use at least two of:
   - analytical/conservation invariant;
   - state/telemetry trace;
   - cause/energy ledger;
   - rate/substep convergence;
   - rendered spatial evidence from one or more cameras.
9. **Visual evidence is diagnostic, not decorative.** Camera views should expose geometry, contact, deformation, attitude, wake/flow proxies, wheel travel, rut depth, waterline or other physically meaningful state.
10. **No gameplay in the proving ground.** Fixtures exist to interrogate the engine.

## Formula note

For every new physical law or major correction, keep a short derivation next to the implementation or test:

```text
quantity:
units:
assumptions:
governing relation:
limiting cases:
conservation / dissipation expectation:
numerical discretization:
independent measurement:
```

A test threshold should be derived from that note whenever possible.

## Hourly loop

Each iteration should do one high-value thing:

- invent a new experiment that can falsify the current model; or
- repair the oldest/most fundamental failing experiment.

Before writing code, inspect the current `main`, existing proving-ground coverage, recent CI and render evidence.

After a change:

1. commit directly to `main`;
2. run the focused proving-ground CI;
3. wait for the self-hosted GPU job rather than assuming queueing is failure;
4. inspect numeric output and at least one rendered camera view when the experiment has visible spatial consequences;
5. fix the first real divergence and rerun as many times as required;
6. stop the iteration only with a green invariant or a clearly documented unresolved physical question.

The release gate must never become easier merely because a test is inconvenient.
