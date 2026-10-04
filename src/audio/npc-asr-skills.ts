import {iAmAliveArticulatorScore,type ArticulatorGesture,type VocalTractRender} from './vocal-tract.js';
import {renderSoftGeometrySpeech,type SoftAirwayTimelineOptions} from './airway-geometry.js';

export type AsrCalibratedEnglishSkill='yeah';

export interface AsrCalibratedMotorSkill{
  readonly text:AsrCalibratedEnglishSkill;
  readonly score:readonly ArticulatorGesture[];
  readonly provenance:string;
}

/**
 * Motor skills are named by what an external ASR listener consistently hears,
 * not by the phoneme labels used to discover the trajectory.
 *
 * This is the seed for an inverse motor learner:
 * target text -> search motor trajectory -> physical synthesis -> ASR score.
 */
export function npcEnglishAsrMotorSkill(text:AsrCalibratedEnglishSkill):AsrCalibratedMotorSkill{
  switch(text){
    case 'yeah':
      return Object.freeze({
        text,
        score:iAmAliveArticulatorScore(),
        provenance:'Vosk en-us 0.15 calibration: soft-tissue airway trajectory recognized as "yeah"',
      });
  }
}

export function synthesizeNpcEnglishAsrSkill(
  text:AsrCalibratedEnglishSkill,
  options:SoftAirwayTimelineOptions={},
):VocalTractRender{
  const skill=npcEnglishAsrMotorSkill(text);
  return renderSoftGeometrySpeech(skill.score,options,text);
}
