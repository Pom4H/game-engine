// Headless authority scenario. Core code contains no special case for boats or weather.
import { createActingMind, appraiseActingOutcome, chooseActingLifeOpportunity } from '../../dist/acting/motivation.js';
import { lifeWellbeingAt, lifeKnowledge, validateLifeState } from '../../dist/acting/life.js';

let actor = createActingMind('anna', [{ id: 'live', importance: 1 }], 0,
  { values: { autonomy: .4, connection: .3, meaning: .3 }, curiosity: .8 });
const trace = [];
// The authority supplies perceived weather/affordances, not a narrator inventing success.
for (const [index, sunny] of [false, false, true, false, true, true].entries()) {
  const day = index + 1, atS = day * 86400;
  const context = ['free-time', 'boat', sunny ? 'sunny' : 'rain'];
  const common = { available: true, essential: false, expiresAtS: atS + 3600, cost: .1, risk: .1 };
  const opportunities = [
    { ...common, id: 'routine', activity: 'routine', requirements: [], anticipated: { autonomy: .1 } },
    { ...common, id: 'sailing', activity: 'sailing', requirements: ['sunny', 'free-time', 'boat'], anticipated: { autonomy: .2 } },
  ];
  const choice = chooseActingLifeOpportunity(actor, opportunities, { atS, context, budget: .5, emergency: false });
  if (!choice.selected) continue;
  const sailing = choice.selected === 'sailing';
  // Only after the chosen action has happened does authority commit its consequences.
  actor = appraiseActingOutcome(actor, {
    id: `day:${day}`, sequence: day, goalId: 'live', subject: sailing ? 'marina' : 'home',
    atS: atS + 3600, progress: sailing ? 1 : .1, expectedProgress: .1, certainty: 1, attribution: 'unknown',
    experience: {
      activity: choice.selected, context,
      impact: sailing ? { autonomy: .9, connection: .7, meaning: .8 } : { autonomy: .1, meaning: .05 },
      evidence: sailing ? [{ claim: 'marina:offers-sailing', value: true, kind: 'observation', source: 'marina', origin: `visit:${day}`, confidence: 1 }] : [],
      ...(sailing ? { counterfactual: { expectedValue: .1, confidence: .7 } } : {}),
    },
  });
  // Exercise the exact JSON persistence path between events, as with unload/reload.
  actor = JSON.parse(JSON.stringify(actor)); validateLifeState(actor.life);
  trace.push({ day, context, action: choice.selected, wellbeing: lifeWellbeingAt(actor.life, actor.atS),
    gratitude: actor.life.memories[0].gratitude, knowledge: lifeKnowledge(actor.life) });
}
console.log(JSON.stringify({ actor: actor.actorId, trace, expectations: actor.life.expectations }, null, 2));
