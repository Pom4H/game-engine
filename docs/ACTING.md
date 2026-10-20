# Engine-native intentions, gestures and facial performance

This belongs to `Pom4H/game-engine`, not `Pom4H/thegame`. It does not apply the
previous TheGame patch, import `ResidentLife`, create a population, rewrite the
accepted winter-tea scene, or merge the experimental native-speech PR #51.

## Actual integration

- `@rom4/game-engine/acting`: pure motivation reducers and `ActingRig`.
- `AnimationSystem.setUpperBodyLayer`: one bounded upper-body owner per existing
  walker. It runs inside the normal animation tick, before native IK bindings.
  Root, pelvis, legs and planted contacts remain owned by locomotion.
- Head-bound meshes inherit the same rigid head frame as `ConversationFaceRig`.
  Use head bindings for the nose, hat and hair; do not independently rotate them.
- `ActingRig.stepFace` calls the existing face rig after the body publication,
  rejects a different clock sample, and leaves speech articulation untouched.
  The existing caller still owns face entity creation and render-mover registration.
- Dynamic rigid bodies remain physics-owned. A failed target validation does not
  advance driven-walker state before a retry.

Engine coordinates are metres/seconds, +X forward, +Y up. This is not the
TheGame +Z skeleton or its procedural facial geometry.

## Subjective model

`ActingMind` has up to eight weighted goals, one active intention, 24 durable
sentiments and 32 observations. An actual perceived outcome is appraised against
its goal importance, expected progress and certainty. Transient affect decays;
attachment, benevolence, reliability and competence are distinct durable values.

An inability to help does not automatically prove malice, unreliability or lack
of competence. The latter two require their own evidence fields. Attribution is
explicitly the observer's interpretation, not access to another actor's mind.
Partner selection receives only candidate IDs, public availability, distance and
the observer's own accumulated expectations. It cannot read private partner state.

An unsuccessful request can become clarification; refusal stops pressure; a real
confirmed resolution permits acknowledgement. A conversation alone never repairs
an object. Long-term goals are supplied by the application, not invented by a
second simulation. The coefficients are provisional authored behavior parameters,
not measured psychological laws or evidence of conscious experience.

## Ownership and persistence

These are pure reducers. The simulation owner must commit the returned mind in
the same durable transaction as the observed action result, then publish it and
submit its motor cue. Do not mutate a live mind before a failed transaction, and
do not feed client claims or generated prose into `confirmedResolution`.

Outcome `sequence` is a persisted actor-local high-water mark. A repeated retained
ID does not accumulate rewards. The bounded memory is not an unlimited deduplication
ledger: the authority must reject an old evicted event reissued with a new sequence.
`validateActingMind` checks restored data. Dialogue session ownership, consent,
perception/channel verification and atomic two-participant commits remain the
application authority's responsibility; this package does not claim to implement them.

## Usage in the existing scene tick

```ts
import {ActingRig,createActingMind,beginActingIntention,appraiseActingOutcome,
  makeActingCue} from '@rom4/game-engine/acting';

// animation is the existing scene AnimationSystem; actor "anna" already exists.
// face is the existing ConversationFaceRig with its own speech motor score.
const acting = new ActingRig(animation, 'anna');
let mind = createActingMind('anna', [{id:'understand-pump',importance:.8}]);
mind = beginActingIntention(mind, {
  id:'request-1',goalId:'understand-pump',subject:'pump-7',partnerId:'ilya',
}, 0);
acting.submit(makeActingCue(mind, 1, mind.intention!.action, 0, 2.4, [2,1.6,0]));

// On each authoritative scene tick: normal scene animation runs FIRST.
// Never advance animation again from requestAnimationFrame.
// After that same tick, using its simulationTimeS and deltaSeconds:
acting.stepFace(face, simulationTimeS, deltaSeconds);

// Occupied hands/head must be masked by the physical/action owner.
acting.setMask({leftArm:false,rightArm:true,head:true});

// When an actual response has been committed, appraise its perceived result.
const next = appraiseActingOutcome(mind, {
  sequence:1,id:'receipt-1',goalId:'understand-pump',subject:'pump-7',
  otherId:'ilya',atS:3,progress:0,expectedProgress:.6,certainty:1,attribution:'unable',
});
// Persist next alongside the committed response BEFORE assigning it to the actor.
mind = next;
acting.submit(makeActingCue(mind, 2, mind.intention!.action, 3));
// On actor teardown:
acting.dispose();
```

`submit` requires monotonically increasing serials and start times. Two cues are
retained at most; transition time is 220 ms. It rejects a faster semantic cue
stream explicitly instead of growing a queue or snapping a three-way transition.
Callers should coalesce purely visual cues while retaining every semantic outcome.
A stale/expired cue returns to neutral, not an endless idle gesture. Masks can
suppress occupied channels immediately. They must be set from actual gameplay
ownership; this engine component does not infer whether a hand holds an object.

The cue contains only visible motor controls, timing and an optional gaze target;
no memories or hidden intentions. This is a serialization-friendly contract, not
a claim that a live networking/persistence adapter has been installed. The driver
is presentation state: reconstruct it after restart from current authority state;
do not replay already finished historical gestures.

## Current expressive range and boundaries

Actions: listening, asking, explaining, declining, acknowledgement, clarification,
and withdrawal. Arms use the engine's existing two-bone IK and the original bend
plane, with continuous entry/exit and two-cue crossfade. Head nod/shake and attached
meshes share one frame. The existing face supplies smiles, brows, squint, gaze,
blink and speech articulation; this patch does not replace its mouth/voice model.

No finger articulation, full palm orientation, full-body emotional gait, hand/body
collision avoidance, learned facial animation, new speech synthesis, automatic
social population, generated dialogue or full cognition network replication is
claimed. Cross-body/world collision constraints and natural visual acting need
hardware-rendered evaluation. Numerical IK lengths alone do not prove naturalness.

## Verification — 2026-10-20

Base inspected: `fbfd5ef136887e6d879bc35213d540959f38f434`.

Local Node 22.16.0 and TypeScript 5.8.3:

- 37 tests passed, 0 failed: `node --test test/acting.test.mjs`.
- Strict subset compile passed, with `noUncheckedIndexedAccess` and
  `exactOptionalPropertyTypes`.
- The local copies of `math.ts` and the unmodified `locomotion.ts` were checked
  against their Git blob SHAs before editing; tests execute the real changed
  AnimationSystem, sampleWalker, binding transforms and two-bone solver.
- Local unavailable **type-only** boundaries use explicitly declared fixtures for
  RuntimeEntity, FootContact and ConversationFaceRig. The face delegation test uses
  a recording adapter, not the actual facial geometry or renderer. This is not a
  full project typecheck, Scene/physics integration, or a test of the pinned TS 7.
- Full frozen install/typecheck/build/all tests are prescribed by the self-hosted
  `Acting contracts` workflow. Check its actual result for the pushed SHA.
- No GPU rendering, screenshot/video, FPS or visual-quality acceptance was obtained.

Tests cover subjective appraisal, attribution, persistence validation, duplicate
receipts, bounded memory, partner choice, intention outcomes, all seven gestures,
three heights/four headings, planted feet, bone lengths, channel masks, rigid head
attachments, equal body/face time, unchanged speech delegation, transition continuity,
exclusive ownership, teardown, and transactional failure of a driven pose update.
