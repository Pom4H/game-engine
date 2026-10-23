import {finiteVec3,type Vec3} from '../math.js';
import {ACTING_ACTIONS,actingEmotionsAt,actingTime,clampActing,type ActingAction,type ActingMind} from './motivation.js';

/** Публичный моторный сигнал. Не содержит памяти, цели или скрытого отношения. */
export interface ActingCue {
 readonly version:1;readonly serial:number;readonly action:ActingAction;readonly startS:number;readonly durationS:number;
 readonly intensity:number;readonly smile:number;readonly browLift:number;readonly browTilt:number;readonly squint:number;
 readonly gazeTarget?:Vec3;
}
export interface ActingPerformance {
 readonly weight:number;readonly leftHandOffset:Vec3;readonly rightHandOffset:Vec3;
 readonly headYaw:number;readonly headNod:number;
 readonly smile:number;readonly browLift:number;readonly browTilt:number;readonly squint:number;readonly gazeTarget?:Vec3;
}
const smooth=(n:number)=>{const x=clampActing(n);return x*x*(3-2*x);};
export function validateActingCue(c:ActingCue):void {
 if(!c||c.version!==1||!Number.isSafeInteger(c.serial)||c.serial<1||!ACTING_ACTIONS.includes(c.action))throw new TypeError('Invalid acting cue');
 actingTime(c.startS);if(!Number.isFinite(c.durationS)||c.durationS<.5||c.durationS>12||!Number.isFinite(c.startS+c.durationS))throw new RangeError('Invalid acting duration');
 for(const v of [c.intensity,c.smile,c.browLift,c.browTilt,c.squint])if(!Number.isFinite(v)||v<0||v>1)throw new RangeError('Invalid acting motor value');
 if(c.gazeTarget)finiteVec3(c.gazeTarget,'Acting gaze');
}
/** Отношение и аффект определяют манеру исполнения, но не управляют артикуляцией. */
export function makeActingCue(mind:ActingMind,serial:number,action:ActingAction,atS:number,durationS=2.4,gazeTarget?:Vec3):ActingCue {
 const emotion=actingEmotionsAt(mind,atS),relation=mind.sentiments.find(s=>s.subject===mind.intention?.partnerId);
 const affinity=relation?.affinity??0;
 const smiles:Partial<Record<ActingAction,number>>={greet:.35,celebrate:.8,comfort:.2};
 const brows:Partial<Record<ActingAction,number>>={ask:.2,clarify:.2,think:.3,startle:.85,celebrate:.3};
 const strengths:Partial<Record<ActingAction,number>>={greet:.85,think:.9,celebrate:.9,comfort:.65,startle:.85,tired:.7};
 const cue:ActingCue={version:1,serial,action,startS:atS,durationS,
  intensity:clampActing((strengths[action]??.35)+emotion.arousal*.45),smile:clampActing(emotion.positive*.6*(1-.5*emotion.negative)+Math.max(0,affinity)*.15+(smiles[action]??0)),
  browLift:clampActing(emotion.uncertainty*.6+emotion.fear*.2+(brows[action]??0)),
  browTilt:clampActing(emotion.anger*.65+emotion.negative*.2),squint:clampActing(emotion.arousal*.18+(action==='think'?.25:action==='tired'?.4:0)),
  ...(gazeTarget?{gazeTarget:[...gazeTarget] as Vec3}:{})};
 validateActingCue(cue);return cue;
}
/** Аналитическая огибающая в секундах, без Date.now, случайных жестов или второго tick.
 * Локальные смещения в метрах при росте 1: +X вперёд, +Y вверх, ±Z в стороны. */
export function sampleActingPerformance(cue:ActingCue,timeS:number):ActingPerformance {
 validateActingCue(cue);actingTime(timeS);
 const t=timeS-cue.startS,window=t<=0||t>=cue.durationS?0:smooth(t/.22)*smooth((cue.durationS-t)/.3);
 const weight=window*cue.intensity,pulse=Math.sin(Math.PI*clampActing(t/cue.durationS)),beat=Math.sin(t*Math.PI*2*1.5);
 let left:Vec3=[0,0,0],right:Vec3=[0,0,0],nod=0,yaw=0;
 switch(cue.action){
  case 'ask':left=[.22,.24,-.07];right=[.22,.24,.07];nod=.045*pulse;break;
  case 'explain':right=[.28+.025*beat,.29+.035*beat,.035];left=[.08,.10,0];break;
  case 'decline':right=[.20,.38,.04];yaw=.09*Math.sin(t*Math.PI*2);break;
  case 'acknowledge':nod=-.11*Math.sin(t*Math.PI*2);break;
  case 'clarify':right=[.17,.27,.07];nod=.05;break;
  case 'withdraw':left=[-.035,0,-.025];right=[-.035,0,.025];yaw=.13*pulse;break;
  case 'listen':nod=.025*Math.sin(t*Math.PI);break;
  case 'greet':right=[.12,.83,.08+.07*Math.sin(t*Math.PI*4)];nod=-.035*pulse;break;
  case 'think':right=[.15,.68,-.08];nod=.055*pulse;yaw=-.035*pulse;break;
  case 'celebrate':left=[.10,1.05,-.16];right=[.10,1.05,.16];nod=-.06*pulse;break;
  case 'comfort':right=[.31,.20,-.04];left=[.10,.13,-.03];nod=.045*pulse;break;
  case 'startle':left=[.18,.67,-.12];right=[.18,.67,.12];nod=-.09*pulse;break;
  case 'tired':left=[-.025,-.015,0];right=[-.025,-.015,0];nod=.12*pulse;break;
 }
 return {weight,leftHandOffset:left.map(v=>v*weight) as unknown as Vec3,rightHandOffset:right.map(v=>v*weight) as unknown as Vec3,
  headYaw:yaw*weight,headNod:nod*weight,smile:cue.smile*window,browLift:cue.browLift*window,browTilt:cue.browTilt*window,squint:cue.squint*window,
  ...(cue.gazeTarget&&window>0?{gazeTarget:cue.gazeTarget}:{})};
}
