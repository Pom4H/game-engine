export {
 ACTING_LIMITS,ACTING_ACTIONS,createActingMind,validateActingMind,validateActingOutcome,
 beginActingIntention,cancelActingIntention,appraiseActingOutcome,actingAffectAt,chooseActingPartner,
 type ActingMind,type ActingGoal,type ActingSentiment,type ActingAffect,type ActingIntention,type ActingOutcome,type ActingAction,
} from './motivation.js';
export {makeActingCue,sampleActingPerformance,validateActingCue,type ActingCue,type ActingPerformance} from './performance.js';
export {ActingRig,type ActingMask} from './rig.js';
