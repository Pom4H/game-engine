import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LIFE_AXES, LIFE_LIMITS, createLifeState, liveExperience, lifeWellbeingAt,
  lifeBeliefProbability, lifeKnowledge, chooseLifeOpportunity, validateLifeState,
} from '../dist/acting/life.js';
import {
  createActingMind, appraiseActingOutcome, beginActingIntention, validateActingMind,
} from '../dist/acting/motivation.js';

const mind = (options = {}) => createLifeState('anna', options);
const experience = (patch = {}) => ({ id: 'e1', sequence: 1, atS: 60, activity: 'sailing',
  context: ['sunny', 'free-time', 'boat'], impact: { autonomy: 1, connection: .7, meaning: .8 }, certainty: 1, ...patch });
const observation = (origin, patch = {}) => ({ claim: 'marina:has-boats', value: true, kind: 'observation', source: 'marina', origin, confidence: 1, ...patch });
const option = (id = 'sailing', patch = {}) => ({ id, activity: id, available: true, essential: false, expiresAtS: 100_000,
  requirements: [], anticipated: { autonomy: .3 }, cost: 0, risk: 0, ...patch });
const situation = (patch = {}) => ({ atS: 0, context: ['sunny', 'free-time', 'boat'], budget: 1, emergency: false, ...patch });
const act = (patch = {}) => ({ sequence: 1, id: 'e1', goalId: 'live', subject: 'marina', atS: 60,
  progress: 1, expectedProgress: 0, certainty: 1, attribution: 'help', otherId: 'pavel', ...patch });
const acting = () => createActingMind('anna', [{ id: 'live', importance: 1 }]);
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-10, `${a} != ${b}`);
function freeze(v) { if (v && typeof v === 'object') { Object.freeze(v); for (const item of Object.values(v)) freeze(item); } return v; }
function observeMany(start, n, patch = {}) {
  let state = start;
  for (let i = 1; i <= n; i++) state = liveExperience(state, experience({ id: `ev${i}`, sequence: i, atS: i * 3600, ...patch }));
  return state;
}

test('same life event means different happiness to different people', () => {
  const e = experience({ impact: { comfort: -1, autonomy: 1 } });
  const free = liveExperience(mind({ values: { autonomy: 1 } }), e);
  const safe = liveExperience(mind({ values: { comfort: 1 } }), e);
  assert.ok(lifeWellbeingAt(free, 60).pleasure > 0);
  assert.ok(lifeWellbeingAt(safe, 60).pleasure < 0);
  assert.ok(lifeWellbeingAt(free, 60).satisfaction > lifeWellbeingAt(safe, 60).satisfaction);
});
test('comfort alone is not fulfilment of meaning', () => {
  const s = liveExperience(mind({ values: { comfort: .8, meaning: .2 } }), experience({ impact: { comfort: 1, meaning: -1 } }));
  assert.ok(lifeWellbeingAt(s, 60).pleasure > 0);
  assert.ok(lifeWellbeingAt(s, 60).meaning < .5);
});
test('a failed attempt can teach without pretending the attempt succeeded', () => {
  const s = liveExperience(mind({ values: { mastery: 1 } }), experience({ impact: { comfort: -.8, mastery: .6 },
    evidence: [observation('experiment1', { claim: 'prototype:works', value: false })] }));
  assert.ok(s.fulfilment.mastery > 0); assert.ok(s.fulfilment.comfort < 0);
  assert.ok(lifeBeliefProbability(s, 'prototype:works') < .5);
});
test('pleasure decays but fulfilment, beliefs and memories persist offscreen', () => {
  const s = liveExperience(mind(), experience({ evidence: [observation('visit1')] }));
  const before = JSON.stringify(s);
  assert.ok(lifeWellbeingAt(s, 60).pleasure > .1);
  assert.ok(lifeWellbeingAt(s, 36000).pleasure < 1e-10);
  assert.equal(lifeWellbeingAt(s, 60).satisfaction, lifeWellbeingAt(s, 36000).satisfaction);
  assert.equal(JSON.stringify(s), before);
});
test('chunked/offline reading has no hidden integration or tick-rate effect', () => {
  const s = liveExperience(mind(), experience());
  for (let t = 60; t < 3600; t += 13) lifeWellbeingAt(s, t);
  assert.deepEqual(lifeWellbeingAt(s, 3600), lifeWellbeingAt(JSON.parse(JSON.stringify(s)), 3600));
});
test('a decision is not an experience and cannot mint happiness or knowledge', () => {
  const s = freeze(mind()), candidates = freeze([option()]), context = freeze(situation());
  const before = JSON.stringify(s); chooseLifeOpportunity(s, candidates, context);
  assert.equal(JSON.stringify(s), before); assert.equal(s.memories.length, 0); assert.equal(lifeKnowledge(s).length, 0);
});
test('rare conjunction is only available when EVERY required condition is perceived', () => {
  const boat = option('sailing', { requirements: ['sunny', 'free-time', 'boat'] });
  for (const context of [[], ['sunny'], ['free-time', 'boat']]) {
    const choice = chooseLifeOpportunity(mind(), [boat], situation({ context }));
    assert.equal(choice.selected, null); assert.equal(choice.rejected[0].reason, 'conditions');
  }
  assert.equal(chooseLifeOpportunity(mind(), [boat], situation()).selected, 'sailing');
});
test('constraints override curiosity: expiry, availability, budget, risk and urgent needs', () => {
  const s = mind({ curiosity: 1, riskTolerance: .2 });
  for (const [patch, context, reason] of [
    [{ available: false }, {}, 'unavailable'], [{ expiresAtS: 0 }, {}, 'expired'],
    [{ cost: .7 }, { budget: .1 }, 'budget'], [{ risk: .3 }, {}, 'risk'], [{}, { emergency: true }, 'emergency'],
  ]) {
    const choice = chooseLifeOpportunity(s, [option('sailing', patch)], situation(context));
    assert.equal(choice.selected, null); assert.equal(choice.rejected[0].reason, reason);
  }
  assert.equal(chooseLifeOpportunity(s, [option('eat', { essential: true })], situation({ emergency: true })).selected, 'eat');
});
test('experience changes actual future choice, not just a displayed emotion', () => {
  const start = mind({ curiosity: 0, values: { autonomy: 1 } });
  const candidates = [option('routine', { anticipated: { autonomy: .35 } }), option('sailing', { anticipated: { autonomy: .1 } })];
  assert.equal(chooseLifeOpportunity(start, candidates, situation()).selected, 'routine');
  const next = observeMany(start, 4, { impact: { autonomy: 1 } });
  assert.equal(chooseLifeOpportunity(next, candidates, situation({ atS: next.atS })).selected, 'sailing');
});
test('context-specific experience does not generalize a sunny success to a storm', () => {
  let s = observeMany(mind({ curiosity: 0, values: { autonomy: 1 } }), 4, { context: ['sunny'], impact: { autonomy: 1 } });
  for (let i = 5; i <= 8; i++) s = liveExperience(s, experience({ id: `e${i}`, sequence: i, atS: i * 3600, context: ['storm'], impact: { autonomy: -1 } }));
  const candidates = [option('sailing', { anticipated: { autonomy: 0 } }), option('stay', { anticipated: { autonomy: .1 } })];
  assert.equal(chooseLifeOpportunity(s, candidates, situation({ atS: s.atS, context: ['sunny', 'boat'] })).selected, 'sailing');
  assert.equal(chooseLifeOpportunity(s, candidates, situation({ atS: s.atS, context: ['storm', 'boat'] })).selected, 'stay');
});
test('curiosity invests in unknown affordable attempts rather than random jitter', () => {
  const s = observeMany(mind({ curiosity: 1 }), 5, { activity: 'routine', impact: { autonomy: 0 } });
  const candidates = [option('routine', { anticipated: {} }), option('experiment', { anticipated: {} })];
  assert.equal(chooseLifeOpportunity(s, candidates, situation({ atS: s.atS })).selected, 'experiment');
});
test('negative expected value is not forced merely because an option exists', () => {
  assert.equal(chooseLifeOpportunity(mind({ curiosity: 0, values: { comfort: 1 } }), [option('bad', { anticipated: { comfort: -1 } })], situation()).selected, null);
});
test('candidate and context ordering cannot change a decision or learned pattern', () => {
  const s = mind(), candidates = [option('z'), option('a')];
  assert.deepEqual(chooseLifeOpportunity(s, candidates, situation()), chooseLifeOpportunity(s, [...candidates].reverse(), situation({ context: ['boat', 'free-time', 'sunny'] })));
  assert.equal(chooseLifeOpportunity(s, candidates, situation()).selected, 'a');
  assert.deepEqual(liveExperience(s, experience()), liveExperience(s, experience({ context: ['boat', 'free-time', 'sunny'] })));
});
test('repeated successful evidence creates a new belief and provisional knowledge', () => {
  let s = mind();
  for (let i = 1; i <= 3; i++) s = liveExperience(s, experience({ id: `e${i}`, sequence: i, atS: i * 60, evidence: [observation(`visit${i}`)] }));
  assert.ok(lifeBeliefProbability(s, 'marina:has-boats') > .5);
  assert.deepEqual(lifeKnowledge(s), [{ claim: 'marina:has-boats', value: true, confidence: .8, origins: ['visit1', 'visit2', 'visit3'] }]);
});
test('three independent negative observations can establish a negative conclusion', () => {
  let s = mind();
  for (let i = 1; i <= 3; i++) s = liveExperience(s, experience({ id: `e${i}`, sequence: i, atS: i * 60, evidence: [observation(`visit${i}`, { value: false })] }));
  assert.equal(lifeKnowledge(s)[0].value, false); close(lifeBeliefProbability(s, 'marina:has-boats'), .2);
});
test('counterevidence revises belief and withdraws unsupported knowledge', () => {
  let s = mind();
  for (let i = 1; i <= 3; i++) s = liveExperience(s, experience({ id: `e${i}`, sequence: i, atS: i * 60, evidence: [observation(`visit${i}`)] }));
  const before = lifeBeliefProbability(s, 'marina:has-boats');
  s = liveExperience(s, experience({ id: 'closed', sequence: 4, atS: 240, evidence: [observation('visit4', { value: false })] }));
  assert.ok(lifeBeliefProbability(s, 'marina:has-boats') < before); assert.deepEqual(lifeKnowledge(s), []);
});
test('one source repeated by many speakers is not independent corroboration', () => {
  let s = mind();
  for (let i = 1; i <= 30; i++) s = liveExperience(s, experience({ id: `e${i}`, sequence: i, atS: i * 60,
    evidence: [observation('original-rumor', { kind: 'testimony', source: `speaker${i}` })] }));
  assert.equal(s.beliefs[0].evidence.length, 1); assert.equal(lifeKnowledge(s).length, 0);
  close(lifeBeliefProbability(s, 'marina:has-boats'), 1.3 / 2.3);
});
test('even many distinct hearsay/inference origins cannot masquerade as observed knowledge', () => {
  for (const kind of ['testimony', 'inference']) {
    let s = mind();
    for (let i = 1; i <= 10; i++) s = liveExperience(s, experience({ id: `e${i}`, sequence: i, atS: i * 60, evidence: [observation(`origin${i}`, { kind })] }));
    assert.equal(lifeKnowledge(s).length, 0); assert.ok(lifeBeliefProbability(s, 'marina:has-boats') > .5);
  }
});
test('strong direct evidence cannot be downgraded by a later retelling of the same origin', () => {
  const a = liveExperience(mind(), experience({ evidence: [observation('o')] }));
  const b = liveExperience(a, experience({ id: 'e2', sequence: 2, atS: 120, evidence: [observation('o', { kind: 'testimony', value: false })] }));
  assert.deepEqual(b.beliefs, a.beliefs);
});
test('zero certainty creates neither conviction nor an expectation nor fulfilment', () => {
  const start = mind(), s = liveExperience(start, experience({ certainty: 0, evidence: [observation('o')] }));
  assert.deepEqual(s.fulfilment, start.fulfilment); assert.deepEqual(s.expectations, []); assert.deepEqual(s.beliefs, []);
  assert.equal(lifeWellbeingAt(s, 60).pleasure, 0);
});
test('weak evidence is not turned into knowledge just by crossing a count threshold', () => {
  let s = mind();
  for (let i = 1; i <= 8; i++) s = liveExperience(s, experience({ id: `e${i}`, sequence: i, atS: i * 60, certainty: .1, evidence: [observation(`visit${i}`)] }));
  assert.deepEqual(lifeKnowledge(s), []);
});
test('observations without a lived consequence do not fabricate pleasure', () => {
  const a = liveExperience(mind(), experience());
  const b = liveExperience(a, experience({ id: 'e2', sequence: 2, atS: 120, impact: {}, evidence: [observation('o')] }));
  assert.deepEqual(b.feeling, a.feeling); assert.deepEqual(b.fulfilment, a.fulfilment);
  assert.deepEqual(b.expectations, a.expectations); assert.equal(b.beliefs.length, 1);
});
test('counterfactuals create gratitude/regret but not fabricated observations', () => {
  const a = liveExperience(mind({ values: { autonomy: 1 } }), experience({ counterfactual: { expectedValue: -1, confidence: .8 } }));
  assert.ok(a.memories[0].gratitude > 0); assert.equal(a.memories[0].regret, 0); assert.equal(a.beliefs.length, 0);
  const b = liveExperience(mind({ values: { comfort: 1 } }), experience({ impact: { comfort: -1 }, counterfactual: { expectedValue: 1, confidence: .8 } }));
  assert.ok(b.memories[0].regret > 0); assert.equal(b.memories[0].gratitude, 0);
});
test('habituation reduces novelty; additional IDs on the same tick cannot farm happiness', () => {
  const a = liveExperience(mind(), experience());
  const b = liveExperience(a, experience({ id: 'e2', sequence: 2 }));
  assert.deepEqual(b.feeling, a.feeling); assert.deepEqual(b.fulfilment, a.fulfilment);
  assert.ok(b.memories[0].novelty < a.memories[0].novelty);
});
test('same sequence, older sequence and retained duplicate ID are idempotent', () => {
  const a = liveExperience(mind(), experience({ evidence: [observation('o')] }));
  assert.equal(liveExperience(a, experience()), a);
  const b = liveExperience(a, experience({ sequence: 2, atS: 120 }));
  assert.deepEqual(b.feeling, a.feeling); assert.deepEqual(b.fulfilment, a.fulfilment); assert.deepEqual(b.beliefs, a.beliefs);
  assert.equal(b.lastSequence, 2); assert.equal(liveExperience(b, experience()), b);
});
test('reducers do not mutate caller state, event or nested evidence', () => {
  const s = freeze(mind()), e = freeze(experience({ evidence: [observation('o')] }));
  const a = liveExperience(s, e); assert.equal(s.memories.length, 0); assert.notEqual(a.memories[0].event, e);
  assert.notEqual(a.memories[0].event.evidence[0], e.evidence[0]);
});
test('1000-event simulation remains bounded and survives JSON restore/replay', () => {
  const events = Array.from({ length: 1000 }, (_, i) => experience({ id: `event${i}`, sequence: i + 1, atS: i * 90,
    activity: `activity${i % 50}`, impact: { comfort: Math.sin(i), mastery: Math.cos(i) },
    evidence: [observation(`origin${i}`, { claim: `claim${i % 70}`, value: i % 2 === 0 })] }));
  const a = events.reduce(liveExperience, mind()); validateLifeState(a);
  const restored = JSON.parse(JSON.stringify(events.slice(0, 500).reduce(liveExperience, mind()))); validateLifeState(restored);
  assert.deepEqual(events.slice(500).reduce(liveExperience, restored), a);
  assert.equal(a.memories.length, LIFE_LIMITS.memories); assert.equal(a.expectations.length, LIFE_LIMITS.expectations);
  assert.equal(a.beliefs.length, LIFE_LIMITS.beliefs); assert.equal(liveExperience(a, events[0]), a);
  for (const v of LIFE_AXES.map(k => a.fulfilment[k])) assert.ok(Number.isFinite(v) && Math.abs(v) <= 1);
});
test('invalid experience cannot partially update the actor', () => {
  for (const patch of [ { atS: NaN }, { atS: Infinity }, { sequence: 0 }, { sequence: 1.5 }, { id: '' },
    { certainty: 2 }, { impact: { magic: 1 } }, { impact: { comfort: NaN } }, { context: ['x', 'x'] },
    { evidence: [observation('x'), observation('x')] }, { evidence: [observation('x', { value: 'yes' })] },
    { counterfactual: { expectedValue: 3, confidence: 1 } }, { context: Array(9).fill('x') } ]) {
    const a = mind(), before = JSON.stringify(a); assert.throws(() => liveExperience(a, experience(patch))); assert.equal(JSON.stringify(a), before);
  }
});
test('backwards clocks and invalid configuration are rejected', () => {
  const a = liveExperience(mind(), experience());
  assert.throws(() => liveExperience(a, experience({ id: 'e2', sequence: 2, atS: 59 })));
  assert.throws(() => lifeWellbeingAt(a, 59)); assert.throws(() => chooseLifeOpportunity(a, [], situation()));
  for (const config of [{ values: {} }, { values: { comfort: -1 } }, { curiosity: NaN }, { riskTolerance: 2 }]) assert.throws(() => mind(config));
});
test('malformed restored life state is rejected', () => {
  const a = liveExperience(mind(), experience({ evidence: [observation('o')] }));
  for (const mutate of [
    s => s.version = 2, s => s.actorId = '', s => s.lastSequence = -1, s => s.feeling.atS = 1000,
    s => s.feeling.pleasure = Infinity, s => s.profile.values.comfort = .9,
    s => s.memories.push(s.memories[0]), s => s.expectations.push(s.expectations[0]),
    s => s.beliefs[0].evidence.push(s.beliefs[0].evidence[0]), s => s.beliefs[0].evidence[0].claim = 'other',
    s => s.expectations[0].visits = 0, s => s.expectations[0].weight = 0,
  ]) { const copy = structuredClone(a); mutate(copy); assert.throws(() => validateLifeState(copy)); }
});
test('invalid opportunities fail before selecting a seemingly valid candidate', () => {
  for (const candidates of [[option('x'), option('x')], [option('ok'), option('bad', { cost: NaN })], Array(33).fill(option())])
    assert.throws(() => chooseLifeOpportunity(mind(), candidates, situation()));
});
test('existing acting outcome path automatically records life, not a disconnected demo', () => {
  const a = acting(); assert.ok(a.life);
  const b = appraiseActingOutcome(a, act()); validateActingMind(b);
  assert.equal(b.life.memories.length, 1); assert.ok(lifeWellbeingAt(b.life, 60).meaning > .5);
  assert.equal(appraiseActingOutcome(b, act()), b);
});
test('rich acting outcomes pass real consequences and observations to life', () => {
  const b = appraiseActingOutcome(acting(), act({ experience: { activity: 'sailing', context: ['sunny'],
    impact: { autonomy: 1 }, evidence: [observation('o')] } }));
  assert.equal(b.life.expectations[0].activity, 'sailing'); assert.equal(b.life.beliefs[0].claim, 'marina:has-boats');
  assert.equal(b.life.memories[0].event.id, b.memories[0].id); validateActingMind(b);
});
test('legacy acting saves migrate lazily, without fabricating past experiences', () => {
  const old = acting(); delete old.life; validateActingMind(old);
  const b = appraiseActingOutcome(old, act()); assert.equal(b.life.memories.length, 1); validateActingMind(b);
});
test('beginning an intention gives no pleasure; later outcomes use the advanced clock', () => {
  const a = beginActingIntention(acting(), { id: 'intent', goalId: 'live', subject: 'marina', partnerId: 'pavel' }, 30);
  assert.equal(a.life.memories.length, 0); validateActingMind(a);
  const b = appraiseActingOutcome(a, act()); assert.equal(b.life.atS, 60); validateActingMind(b);
});
test('life belonging to another actor or a future sequence cannot enter a saved mind', () => {
  const a = acting();
  assert.throws(() => validateActingMind({ ...a, life: { ...a.life, actorId: 'pavel' } }));
  assert.throws(() => validateActingMind({ ...a, life: { ...a.life, lastSequence: 1 } }));
  assert.throws(() => validateActingMind({ ...a, life: { ...a.life, atS: 100 } }));
});
test('invalid rich outcome cannot commit even otherwise valid acting progress', () => {
  const a = freeze(acting());
  assert.throws(() => appraiseActingOutcome(a, act({ experience: { activity: 'sailing', context: [], impact: { autonomy: NaN } } })));
  assert.equal(a.memories.length, 0); assert.equal(a.life.memories.length, 0);
});
test('corrected primary evidence replaces its old polarity without becoming another witness', () => {
  const a = liveExperience(mind(), experience({ evidence: [observation('o')] }));
  const b = liveExperience(a, experience({ id: 'e2', sequence: 2, atS: 120, evidence: [observation('o', { value: false })] }));
  assert.equal(b.beliefs[0].evidence.length, 1); close(lifeBeliefProbability(b, 'marina:has-boats'), 1 / 3);
});
test('restored expectation contexts must be canonical', () => {
  const a = liveExperience(mind(), experience());
  const b = structuredClone(a); b.expectations.find(x => x.context.length).context.reverse();
  assert.throws(() => validateLifeState(b));
});
test('acting constructor accepts individual life priorities without breaking old calls', () => {
  const a = createActingMind('anna', [{ id: 'live', importance: 1 }], 10, { values: { autonomy: 1 }, curiosity: .9 });
  assert.equal(a.life.profile.values.autonomy, 1); assert.equal(a.life.profile.curiosity, .9); validateActingMind(a);
});
test('acting opportunity adapter respects the acting clock and supports legacy saves', async () => {
  const { chooseActingLifeOpportunity } = await import('../dist/acting/motivation.js');
  const a = acting(); delete a.life;
  assert.equal(chooseActingLifeOpportunity(a, [option()], situation()).selected, 'sailing');
  const b = beginActingIntention(a, { id: 'intent', goalId: 'live', subject: 'marina', partnerId: 'pavel' }, 30);
  assert.throws(() => chooseActingLifeOpportunity(b, [option()], situation()));
  assert.equal(b.life, undefined);
});
