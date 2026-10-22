# Acting: review and bounded causal appraisal

Reviewed 2026-10-22 against `Pom4H/game-engine` main
`2c2b257b65ead74e983a99a28f861358a9d972b1`. This replaces the earlier
recommendation to combine entire EMA, FAtiMA and generative-agent frameworks.
No dependency, separate population, dialogue server, LLM, or second simulation
is introduced. Engine-first ownership and the existing animation integration remain.

## Comparison and revised decision

| Reference | Supported lesson | Decision for this engine |
|---|---|---|
| The Sims 4 [1] | Sentiments are asymmetric impressions from shared experiences and influence behavior around another Sim. | Preserve subjective relationships; copy legible causes in diagnostics, not an unverified reproduction of the proprietary emotion algorithm. Our opt-in component has not demonstrated richer live behavior than the shipped game. |
| GAMYGDALA [2] | Goal/event-based appraisal can be independent of the game's decision architecture. | Closest engineering comparison to our initial goal-weighted reducer. Keep a small simulation-owned component instead of adopting a cognitive framework. |
| FAtiMA [3] | Separates appraisal and decision making; emotion records have causes and targets, and several emotions may coexist. It still uses authored rules. | Keep causal episodes and mixed activations. Rules are not inherently bad; prove their consequences. No claim of a full OCC implementation. |
| EMA [4] | Appraisal operates on a changing interpretation; perceptual/inferential changes produce reappraisal. | Separate an immutable received observation from its revisable interpretation. Updating an interpretation must not manufacture a second occurrence. |
| Generative Agents [5] | Memory, reflection and planning support believable behavior in a 25-agent demonstration. | Useful research comparator, not our real-time authority or a per-NPC/per-tick LLM dependency. |
| CTEM [6] | Links behavioral history, emotional state and feedback; reports a 21-day companion-agent study. | Closed-loop evaluation is useful. A messaging-companion study is not evidence of real-time game performance or physical-action correctness. |
| SELAgents [7] | Integrates emotions, social inference and learning, but explicitly assumes perfectly observable emotional states. | Do not adopt that assumption: private mental state must not become another NPC's observation. Its reported study is not a validated benchmark for our world. |

The previous `ActingMind` was a small authored affect/acting model, not an EMA
implementation. Important code-level weaknesses were: multiplying old affect by
0.35 on every new event (including irrelevant neutral events); one signed valence
losing simultaneous positive/negative activation; no safe revision of a past
attribution; treating predictions like actual responses; and no explicit influence
of emotion on feasible action selection. The old finite-state request fallback
is not emergent planning, and is still not presented as such.

## What changed

`ActingMind` is version **2**. Its sources are an accumulated baseline plus at most
32 retained received outcomes. Each new memory stores the original input and a
separate assessment: interpretation, importance at observation, revision, provenance
`basisId`, and revision time. Original attribution and time are not overwritten.

`reappraiseActingOutcome` replaces one retained assessment, then replays only the
bounded causal window in its original order. Replay recomputes both emotional and
relationship effects, including saturation. It does **not** increment observation
sequence, retry count, or success count; it does not reopen a refused intention.
This avoids the incorrect shortcut of subtracting a previously clipped trust delta.

Decay is driven solely by simulation time between inputs, not the number of events.
Positive and negative activation coexist; signed valence is only a presentation
summary. Additional authored fear, anger and gratitude channels distinguish selected
appraisal cases. Controllability, future likelihood and evidence certainty are
separate inputs. A prediction cannot complete a goal, consume a real conversational
attempt, or establish competence/reliability as if it were an actual event.

On eviction, an episode's effects are folded into the baseline. Thus neutral input
cannot erase emotion or durable relationships merely by filling memory. Its precise
cause is no longer revisable: corrections outside the 32-entry window fail explicitly.
This is bounded local reappraisal, not unlimited autobiographical memory. An authority
with a longer durable log can reconstruct from an earlier checkpoint outside this API.

`emotions`, `affect`, and `sentiments` are read-only **derived publications** checked
against the baseline/window by `validateActingMind`. They are not additional sources
of truth. On a duplicate receipt the cached emotional publication may precede
`mind.atS`; use `actingEmotionsAt` / `actingAffectAt` at current simulation time.
These sampling functions are O(1); they never replay the window or mutate the mind.

`chooseActingAction` scores only the caller's feasible options, with explicit
progress, information and cost terms. Uncertainty increases the value of information;
fear increases sensitivity to risk. The returned score is inspectable. The caller
owns admission, consent, physical capability checks, execution and atomic persistence.
No inferred success, second body controller, reward from generated dialogue, or
access to another NPC's private mind is introduced. The existing request/clarify/
withdraw fallback and three-attempt cap remain for callers that do not use a richer
policy; those are authored compatibility rules, not psychological laws.

## Engine integration retained

- Public module: `@rom4/game-engine/acting`.
- `ActingRig` remains an opt-in upper-body owner on the existing `AnimationSystem`.
  Metres/seconds, **+X forward**, +Y up. Locomotion owns root, pelvis and foot contacts.
- Native two-bone IK, body proportions, `orientFrom` hand bindings and head-bound
  mesh transforms are unchanged. Dynamic rigid bodies remain physics-owned.
- `makeActingCue` now reads mixed activation rather than cancelling positive and
  negative feelings into a neutral face. The serialized cue shape stays version 1.
- `ConversationFaceRig` still owns speech articulation and blinking. No new jaw,
  phoneme, voice or audio-envelope model is installed. The caller creates face
  entities, registers render movers and steps face/body at the same Scene time.
- Mask occupied arms/head from actual action ownership. The acting layer cannot
  infer whether a hand holds something. No finger rig or collision-avoidance solver
  is claimed. The two-cue/220 ms transition contract remains unchanged.

## Persistence and use

Explicitly migrate existing saves; do not just change their version tag:

```ts
import {
  migrateActingMind, appraiseActingOutcome, reappraiseActingOutcome,
  chooseActingAction, makeActingCue,
} from '@rom4/game-engine/acting';

const mind = migrateActingMind(savedMind); // v1 or v2; checks derived state
const next = reappraiseActingOutcome(mind, {
  eventId: 'request-receipt-7', revision: 1,
  basisId: 'perceived-explanation-8', atS: simulationTimeS,
  interpretation: {
    progress: -.5, expectedProgress: .5, certainty: .9,
    attribution: 'unable', otherId: 'ilya', controllability: .2,
  },
});
// The original observation remains in next.memories. The new basis is supplied
// by the authoritative perception/inference owner, not free-form generated text.
// Atomically persist next and the accepted interpretation change before publication.

const choice = chooseActingAction(next, feasibleOptions, simulationTimeS);
if (choice) {
  // Admit and commit the selected real action through the existing owner FIRST.
  // Then publish its presentation. Motor serial is independent of observation
  // sequence: a reappraisal is not a new world event.
  const cue = makeActingCue(next, nextMotorSerial, choice.action, simulationTimeS);
  acting.submit(cue, currentBodyChannelMask);
}
// After the ordinary animation tick, at the exact same simulation time:
acting.stepFace(existingFace, simulationTimeS, deltaSeconds);
```

This is an integration sketch; `savedMind`, receipt IDs, feasible options,
persistence, action admission and simulation clock must come from the application.
There is no automatic population integration hidden behind these calls.

Migration preserves original goals, memories, sentiments, counters and intention.
The v1 aggregate emotion is retained as an explicitly unattributed baseline;
old experience is not replayed under new equations. Migrated memories have no
reversible assessment, so revising them is rejected instead of inventing attribution.

Observations require a persisted monotone actor-local sequence. Retained duplicate
IDs and stale revisions do not accrue rewards. Evicted IDs reissued with new sequence
numbers still require deduplication in the authority's durable event log. Revision
gaps are rejected. A stale revision is a no-op, not a merge of conflicting evidence.
Corrections retain the original episode's decay anchor; repeatedly reconsidering
one episode does not refresh its emotional intensity. A genuinely new experience
can be supplied as a separate observation with separate provenance.

## Budgets and remaining gaps

At most eight authored goals, one current intention, 32 retained causal records,
and 24 effective relationship entries. The folded baseline holds up to 24 additional
entries as its own checkpoint; this is not a claim of only 24 stored objects total.
Observation/revision replay is bounded by the window and relationship limits; it is
not zero allocation and does not establish an entire-frame CPU budget. Sample decay
is constant-work. The semantic owner should schedule events under its existing budget,
not call appraisal per rendered frame. This change does not add a second LOD scheduler.

Still missing: autonomous inference of explanations, multi-goal appraisal of one event,
general coping/planning, long-term mood/personality dynamics, salience-based retrieval,
per-domain competence, full belief/ToM learning, automatically recalled sentiments,
and full-world/network/persistence integration. The generic relationships are not a
validated theory of trust. The appraisal coefficients and 12-second decay constant
are provisional authored parameters, not calibrated human measurements. This is
an explicit testable improvement, not a claim to surpass Sims, EMA or FAtiMA.

## Verification of this revision

Local sandbox: Node **22.16.0**, TypeScript **5.8.3**, not the repository's pinned TS 7.

```sh
tsc --strict --noUncheckedIndexedAccess --exactOptionalPropertyTypes \
  --target es2022 --module nodenext --moduleResolution nodenext \
  --outDir dist --rootDir src \
  src/acting/motivation.ts src/acting/performance.ts src/math.ts
node --test test/acting-appraisal.test.mjs
node tools/acting/benchmark.mjs
```

- Strict three-module compilation passed, without mocked imports or type stubs.
- **30 new tests passed, zero failed**: time decay, neutral floods and eviction,
  mixed feelings, subjective goal weights, uncertainty/control, forecast/fact
  separation, attribution corrections, clipped-history counterfactual replay,
  duplicate observations/revisions, JSON validation, v1 migration, action choice,
  availability, finite budgets and updated motor-cue projection.
- The local unmodified `math.ts` and pre-change `performance.ts` matched repository
  blob SHAs `30964be33a854cd955fcac2d42d2a080bafce791` and
  `8c14e699e3093cb47de803bae530ee7e41edbbd9` before changes.
- The benchmark is a warm, single-process JS reducer test with a checksum. It
  reports both one-subject and 24-subject workloads, not game FPS, a comparison to
  the prior implementation, heap bounds, or a hardware-rendering measurement.
- Full repository checkout/install/build, the pre-existing 37-test suite, pinned
  compiler, native physics and renderer/GPU checks were **not executed locally**.
  Network/DNS blocked obtaining a complete checkout. No browser capture or visual
  naturalness acceptance is claimed. Check actual CI for the published commit;
  authoring tests is not equivalent to a passing full-project pipeline.
- Earlier 37-test isolated validation is historical in the
  [initial implementation documentation](https://github.com/Pom4H/game-engine/blob/165ab4a0d5939b93d6a3db85215f4f24c8d07927/docs/ACTING.md),
  not added to the 30 tests actually run for this revision.

## Primary references

1. EA, [The Sims 4 update 2020-11-10, Sentiments](https://www.ea.com/able/news/update-notes-nov-10-2020).
2. Popescu, Broekens, van Someren, [GAMYGDALA: an Emotion Engine for Games](https://dare.uva.nl/id/35ae74ce-768e-445a-9d71-7a7cb0e884d3), 2014; [author's usage documentation](https://ii.tudelft.nl/~joostb/gamygdala/index.html).
3. Mascarenhas et al., [FAtiMA Toolkit](https://arxiv.org/abs/2103.03020), 2021, sections 3.4-3.6.
4. Marsella and Gratch, [EMA: A process model of appraisal dynamics](https://doi.org/10.1016/j.cogsys.2008.03.005), 2009.
5. Park et al., [Generative Agents](https://arxiv.org/abs/2304.03442), 2023.
6. [CTEM / Auri](https://www.microsoft.com/en-us/research/publication/toward-natural-and-companionable-virtual-agents-via-cross-temporal-emotional-modeling/), CHI 2026.
7. Torres, [Social and emotional learning in artificial agents](https://www.nature.com/articles/s41598-026-48309-5), 2026. The abstract and introduction explicitly delimit perfect emotion-state observability.
