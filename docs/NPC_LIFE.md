# NPC life: consequences -> experience -> learning -> a different next choice

This is a computational, deliberately bounded model, not a claim of phenomenal
consciousness or a validated psychological theory. Its constants are game-design
parameters. It is renderer-independent TypeScript and needs no inference per tick.

## Integration

`@rom4/game-engine/acting` exports the life API. `createActingMind()` now creates a
`life` state; an optional fourth argument sets individual values, curiosity and
risk tolerance. `appraiseActingOutcome()` commits life experience in the existing
outcome reducer, alongside affect, sentiments and intention updates. Old outcomes
still work: goal progress contributes to meaning, but does not invent factual
knowledge. Old version-1 saves without `life` migrate on their next outcome.

A rich `ActingOutcome.experience` contains activity, perceived context, consequences
on comfort/connection/autonomy/mastery/meaning, and optional observations. Identity,
sequence, time and certainty come from the enclosing authoritative outcome. Do not
turn dialogue prose, generated animation or the selection of an action into an
observation of success.

`chooseActingLifeOpportunity()` selects from **perceived** affordances. Requirements
are conjunctive: sun alone does not imply free time, an available boat or money.
Unavailable, expired, unaffordable and over-risk options are excluded; optional
activities cannot override emergency needs. The returned trace includes scores and
rejection reasons. The selector is pure: authority must execute and commit the
actual outcome, persist it, then replan when relevant circumstances change.

The reusable kernel is integrated into ActingMind, not into the separate TheGame
population scheduler or its Bevy port. This change does not claim a running city,
new weather/boat systems, a renderer port, or automatic NPC visual expressions.
Those consumers must supply actual world affordances and consequences through the
API rather than inventing them inside this cognition layer.

## What changes during a life

* **Wellbeing:** transient pleasure decays with simulation time; long-term
  fulfilment and meaning persist. The same event can delight one value profile and
  disappoint another. Comfort is not interchangeable with meaning. Same-activity,
  same-timestamp events cannot repeatedly increase wellbeing; novelty habituates.
* **Expectations:** successful and unsuccessful attempts create context-specific
  utility estimates. A sunny-day success need not generalize to a storm. Learned
  estimates alter the next decision. Curiosity gives bounded value to an unfamiliar
  feasible attempt, not a random action that bypasses survival constraints.
* **Beliefs and knowledge:** previously unseen claim IDs create beliefs. Confidence
  is a weighted Beta-style heuristic. Observation, testimony and inference remain
  distinct. Repeated retellings sharing an origin are one witness, not many.
  `lifeKnowledge()` returns defeasible conclusions with at least three independent
  direct origins, total supporting confidence >= 2.5 and no direct opposition.
  Counterevidence withdraws that status; it does not rewrite world truth. A corrected
  origin replaces its polarity without adding an independent witness. Source
  independence/authenticity is an authority contract, not something these types can
  prove. Claims must retain temporal/contextual scope when appropriate; no automatic
  universal laws, causal discovery or freshness guarantee is claimed.
* **Reflection:** a supplied, explicitly hypothetical alternative yields a limited
  gratitude/regret appraisal. Counterfactual outcomes never become observations.

Default limits per actor: 64 episodes, 64 expectations, 48 claims, 8 evidence origins
per claim, 8 context tags and 32 candidate opportunities. These are bounded working
memories: eviction can forget evidence and preferences. No claim of infinite
biography retention is made. All IDs and numbers are validated at input/restore;
state uses plain serializable data, stable ordering and monotonic simulation clocks.

## Identity, retries and persistence

Persist the new mind with the action result atomically. Keep the original sequence
when redelivering an event, including after its episode is evicted. The reducer
ignores old sequences and retained duplicate IDs. It cannot detect a deliberately
renumbered duplicate whose ID has already left bounded memory: the authority journal
owns durable deduplication. Candidate scoring does not mutate state or grant rewards.
Validate loaded state with `validateActingMind()` / `validateLifeState()`.

## Run

```sh
bun run build
node --test test/acting-life*.test.mjs test/acting.test.mjs
node examples/acting/life.mjs
```

The headless scenario runs six days: rainy routines, then the conjunction of sun,
free time and a boat; a real outcome changes fulfilment and expected future utility.
Three separate visits produce a supported, revisable conclusion about the marina.
It round-trips the actor through JSON after every outcome.

For a dependency-free focused check in an environment without the complete engine:

```sh
tsc --target ES2022 --module NodeNext --moduleResolution NodeNext \
  --lib ES2023,DOM --strict --noUncheckedIndexedAccess \
  --exactOptionalPropertyTypes --verbatimModuleSyntax \
  --outDir dist --rootDir src src/acting/life.ts src/acting/motivation.ts
node --test test/acting-life*.test.mjs
node examples/acting/life.mjs
```

This scoped check does not replace the full project typecheck, rendering tests or
population integration tests. The implementation adds no dependency or CI workflow.
