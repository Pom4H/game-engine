import {RenderFrameCache,buildRenderFrame} from '../../dist/render/frame.js';
import {RenderFrameCache as HistoricalCache,buildRenderFrame as historicalBuilder} from './projection-pose-arena-baseline.mjs';
import {diagnoseRadianceCausePlan} from './radiance-cause-plan-diagnostic.mjs';

export function diagnoseProjectionPoseArena(controls){
 return diagnoseRadianceCausePlan(controls,{experiment:'projection-pose-arena',frameVariants:{baseline:{cache:new HistoricalCache(),builder:historicalBuilder},candidate:{cache:new RenderFrameCache(),builder:buildRenderFrame}}});
}
