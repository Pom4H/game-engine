# Engine-native intentions, gestures and facial performance

This is an opt-in engine module in `Pom4H/game-engine`. NPC behavior is driven by
the owning simulation's perceptions and action results. The existing tea scene
and game population are independent consumers and are not automatically enrolled.

## Actual integration

- `@rom4/game-engine/acting`: motivation, NPC deliberation and `ActingRig`.
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

## NPC inner life

`createNpcMind` adds a deterministic model of four needs: energy, company,
understanding and safety. Each has its own urgency, importance and growth per
simulation second. `setNpcNeed` accepts a new perceived bodily/environmental
condition. This is a model of cognition, not evidence of subjective consciousness.

`stepNpcMind` ranks up to 32 perceived affordances by need, expected relief,
confidence, distance and learned social expectations. It preserves a current
decision for up to ten seconds, emits an execution request once, and can interrupt
a conversation for critical safety. Unavailable opportunities are excluded. Gaze
updates from current observations and clears when the target is no longer seen.
There is no access to another NPC's private knowledge or a global entity search.

The mind keeps 32 thoughts describing intentions, waiting, outcomes, timeouts and
interruptions. Decisions and thoughts retain subject IDs, need IDs and confidence;
the decision also records its utility score. Refusals, timeouts and successes put
that affordance on a ten-second retry cooldown. Critical safety bypasses an
ordinary active intention, but does not invent an escape opportunity.

`perceiveNpcOutcome` accepts the same authority receipts as the appraisal reducer.
Observed progress changes the associated need in proportion to confidence. Only a
confirmed resolution completes the decision. An animation or elapsed time never
satisfies a need. Duplicate sequences and retained receipt IDs cannot reward it
twice; storage must still deduplicate reissued IDs after bounded-memory eviction.

```ts
import {createNpcMind,stepNpcMind,perceiveNpcOutcome,ActingRig}
  from '@rom4/game-engine/acting';

let mind = createNpcMind('anna');
const rig = new ActingRig(scene.animation, 'anna'); // existing authored walker

// Each authority tick, using opportunities actually perceived by this NPC:
const atS = scene.animation.timeSeconds + dt;
const next = stepNpcMind(mind, atS, [{
  id:'talk-to-ilya', need:'company', subject:'tea-break', partnerId:'ilya',
  available:true, distanceM:1, expectedRelief:.8, confidence:.9,
  position:[2,1.6,0],
}]);
// Commit next.mind using the application's existing state owner.
mind = next.mind;
if (next.cue) rig.submit(next.cue);
// next.request is for the action executor; it is not a completed world action.
scene.step(dt);
rig.stepFace(face, scene.animation.timeSeconds, dt);

// Once the authority has committed an actual result at receipt.atS:
mind = perceiveNpcOutcome(mind, receipt);
// The next stepNpcMind emits/coalesces the corresponding visual reaction.
```

Create the mind at the current simulation time when adding a late actor. To resume
a saved snapshot, call `validateNpcMind` before admitting it to the simulation and
recreate `ActingRig`. Need growth uses elapsed simulation time; pause/loading time
must not be supplied as simulation time unless that is intended gameplay.
Visual reactions coalesce at 220 ms, while all semantic receipts are retained up
to the memory budget. Continuing actions refresh their cue every 2.4 seconds.
Persist the returned mind with its actor-local cue and decision serials.

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
withdrawal, greeting, thinking, celebration, comfort, startle and tiredness.
NPC decisions select gestures for their need; confirmed results, clarification and
refusal select reactions. Comfort and the other gestures are also available to
application-authored actions through `makeActingCue`. Arms use native IK and the original bend
plane, with continuous entry/exit and two-cue crossfade. Head nod/shake and attached
meshes share one frame. The existing face supplies smiles, brows, squint, gaze,
blink and speech articulation; this patch does not replace its mouth/voice model.

No finger articulation, full palm orientation, full-body emotional gait, hand/body
collision avoidance, learned facial animation, new speech synthesis, automatic
social population, generated dialogue or full cognition network replication is
claimed. Cross-body/world collision constraints and natural visual acting need
hardware-rendered evaluation. Numerical IK lengths alone do not prove naturalness.

## Verification — 2026-10-20

The implementation from `165ab4a` is integrated with the local engine's existing
route animation and working changes. Verification runs against the real source
tree and native Scene/face geometry, without replacement type fixtures:

- Full TypeScript typecheck and build pass with the installed project compiler.
- 64 acting/NPC tests pass. They cover all 13 gestures, bounds, deterministic
  replay, needs, decisions, refusals, safety interruption, duplicate receipts,
  persistence, timing, planted feet, body proportions, channel masks, transition
  continuity and native face integration preserving the speech motor score.
- Full local test run: 853 passed, 19 skipped, zero failures (872 total).
  Log: `artifacts/npc-mind-full-tests.log`. Skipped tests remain unverified.
- `node tools/acting/demo.mjs` runs a native Scene, drives its mind and face,
  and generates `artifacts/acting/report.json` and `gestures.png`. Receipts in this
  standalone demonstration are synthetic and explicitly labelled in its report.
  The image shows greet, think, celebrate, comfort, startle and tired, left to right.
- CPU frames have been inspected. GPU rendering, video, FPS and naturalness of
  motion on production characters still require separate visual evaluation.

The self-hosted `Acting contracts` workflow includes both test suites and the
native demo. Local results do not establish a successful remote CI run.

## Recorded dialogue — 2026-10-20

`tools/acting/video-scene.mjs` connects two existing winter pedestrian rigs to
`ActingRig`, `ConversationFaceRig` and the normal 60 Hz Scene animation clock.
It authors a conversation about a courtyard lamp: a request, inability to help
immediately, clarification, support, a confirmed scripted lamp-on result and
gratitude. The short-lived affect and durable partner expectations displayed in
the recording come directly from the engine's appraisal state. Inability does
not reduce benevolence; confirmed help raises benevolence and reliability from
50% to 56%, which persist while affect decays.

This is an authored demonstration with explicitly synthetic scenario receipts,
not a recording of an automatically enrolled live game population. The existing
tea scene and game server are unchanged. The lamp result belongs to the demo
scenario; dialogue or an animation alone is not treated as successful repair.

The capture uses hardware WebGPU, 1280×720, and an offline fixed 30-frame/s video
timeline. The encoded frame rate is not a real-time performance measurement.
Russian audio uses the installed Windows `Microsoft Irina Desktop` voice with
two speaking rates. SAPI viseme events are rescaled to measured WAV durations
and mapped approximately to the existing face shapes; this is not a new speech
synthesizer or a claim of exact phonetic alignment.

```powershell
# Current Engine dist must already be built. Windows, Chrome and FFmpeg required.
node tools/acting/video-prepare.mjs
$env:ACTING_VIDEO_MODE = 'preview'
node tools/acting/video-capture.mjs
Remove-Item Env:ACTING_VIDEO_MODE
node tools/acting/video-capture.mjs
```

Outputs under `artifacts/acting-video/`: `npc-emotions-and-sentiments.mp4`,
`poster.png`, preview frames, `plan.json`, `media.json`, `scenario-check.json`
and `video-evidence.json` with adapter identity, per-second animation/face/state
samples, renderer errors and source hashes. Source and capture tools remain
separate from the game state and persistence owner.
