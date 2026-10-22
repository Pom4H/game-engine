import test from 'node:test';
import assert from 'node:assert/strict';
import { LIFE_AXES, createLifeState, liveExperience, validateLifeState, lifeWellbeingAt } from '../dist/acting/life.js';

test('1000 different normalized profiles stay in bounds at both utility extremes', () => {
  for (let i = 1; i <= 1000; i++) {
    const values = Object.fromEntries(LIFE_AXES.map((axis, j) => [axis, (Math.sin(i * 7 + j * 13) + 1.01) / 2.01]));
    for (const sign of [-1, 1]) {
      const state = liveExperience(createLifeState('actor', { values }), {
        id: 'event', sequence: 1, atS: 1, activity: 'experience', context: [], certainty: 1,
        impact: Object.fromEntries(LIFE_AXES.map(axis => [axis, sign])),
        counterfactual: { expectedValue: -sign, confidence: 1 },
      });
      validateLifeState(JSON.parse(JSON.stringify(state)));
      assert.ok(Math.abs(state.memories[0].value) <= 1);
      const wellbeing = lifeWellbeingAt(state, 1);
      assert.ok(Math.abs(wellbeing.pleasure) <= 1 && wellbeing.satisfaction >= 0 && wellbeing.satisfaction <= 1);
    }
  }
});
