export {
 ACTING_LIMITS,ACTING_ACTIONS,createActingMind,validateActingMind,validateActingOutcome,
 beginActingIntention,cancelActingIntention,appraiseActingOutcome,actingAffectAt,chooseActingPartner,
 type ActingMind,type ActingGoal,type ActingSentiment,type ActingAffect,type ActingIntention,type ActingOutcome,type ActingAction,
} from './motivation.js';
export {makeActingCue,sampleActingPerformance,validateActingCue,type ActingCue,type ActingPerformance} from './performance.js';
export {ActingRig,type ActingMask} from './rig.js';
export {chooseActingLifeOpportunity} from './motivation.js';
export {
 LIFE_AXES,LIFE_LIMITS,createLifeState,liveExperience,lifeWellbeingAt,lifeBeliefProbability,
 lifeKnowledge,chooseLifeOpportunity,validateLifeState,validateLifeExperience,
 type LifeAxis,type LifeVector,type LifeProfile,type LifeProfileOptions,type LifeEvidence,
 type LifeExperienceDetails,type LifeExperience,type LifeMemory,type LifeExpectation,
 type LifeBelief,type LifeState,type LifeOpportunity,type LifeSituation,type LifeChoice,
} from './life.js';
