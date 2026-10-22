export {
 ACTING_LIMITS,ACTING_ACTIONS,createActingMind,validateActingMind,validateActingOutcome,migrateActingMind,
 beginActingIntention,cancelActingIntention,appraiseActingOutcome,reappraiseActingOutcome,
 actingAffectAt,actingEmotionsAt,evaluateActingInterpretation,chooseActingPartner,chooseActingAction,
 type ActingMind,type LegacyActingMind,type ActingGoal,type ActingSentiment,type ActingAffect,type ActingEmotions,
 type ActingIntention,type ActingOutcome,type ActingAction,type ActingInterpretation,type ActingAssessment,
 type ActingMemory,type ActingBaseline,type ActingReappraisal,type ActingOption,type ActingChoice,
} from './motivation.js';
export {makeActingCue,sampleActingPerformance,validateActingCue,type ActingCue,type ActingPerformance} from './performance.js';
export {ActingRig,type ActingMask} from './rig.js';
