import {Scene} from '../scene/scene.js';
import {
  SOFT_MOUTH_MOTOR_LEAD_S,
  SoftVocalFaceRig,
  sampleSoftMouthMotorPlan,
  softVocalFaceSceneSpec,
} from '../animation/soft-mouth.js';
import type {TongueAirwaySample} from '../animation/soft-tongue.js';
import {
  renderArticulatedVocalTract,
  sampleArticulatorScore,
  type ArticulatorGesture,
  type VocalAreaFrame,
  type VocalTractRender,
  type VocalTractRenderOptions,
} from './vocal-tract.js';

const SPEED_OF_SOUND_MPS=343;
const AIRWAY_Z_BACK=.34;
const AIRWAY_Z_FRONT=.70;
const clamp=(v:number,a:number,b:number)=>Math.max(a,Math.min(b,v));
const smooth=(t:number)=>{const x=clamp(t,0,1);return x*x*(3-2*x);};
const mix=(a:number,b:number,t:number)=>a+(b-a)*t;

export interface SoftAirwayTimelineOptions extends Omit<VocalTractRenderOptions,'areaFrames'>{
  readonly controlRateHz?:number;
  readonly motorLeadS?:number;
  readonly warmupS?:number;
}

export interface SoftAirwayTimeline{
  readonly frames:readonly VocalAreaFrame[];
  readonly sections:number;
  readonly controlRateHz:number;
  readonly durationS:number;
}

function interpolateTongue(profile:readonly TongueAirwaySample[],z:number):TongueAirwaySample{
  if(!profile.length)throw new RangeError('Tongue airway profile is empty');
  const sorted=[...profile].sort((a,b)=>a.zM-b.zM);
  if(z<=sorted[0]!.zM)return sorted[0]!;
  if(z>=sorted.at(-1)!.zM)return sorted.at(-1)!;
  let i=0;while(i<sorted.length-2&&z>sorted[i+1]!.zM)i++;
  const a=sorted[i]!,b=sorted[i+1]!,q=clamp((z-a.zM)/Math.max(1e-9,b.zM-a.zM),0,1);
  return Object.freeze({
    zM:z,
    topYM:mix(a.topYM,b.topYM,q),
    bottomYM:mix(a.bottomYM,b.bottomYM,q),
    widthM:mix(a.widthM,b.widthM,q),
  });
}

/**
 * Approximate the static oral roof in the same stylized face coordinate frame.
 * Only the relative tongue/roof occupancy is used acoustically; world metres
 * are never interpreted as literal human anatomy dimensions.
 */
function oralRoofY(t:number):number{
  const x=clamp(t,0,1);
  return 1.425+.070*Math.sin(Math.PI*x)**.72-.010*x;
}
function oralFloorY(t:number):number{
  const x=clamp(t,0,1);
  return 1.205+.025*x;
}
function oralWidthM(t:number):number{
  return mix(.35,.285,clamp(t,0,1));
}

function geometryAreaCm2(sample:TongueAirwaySample,t:number):number{
  const roof=oralRoofY(t),floor=oralFloorY(t),cavityHeight=Math.max(.03,roof-floor);
  const gap=clamp((roof-sample.topYM)/cavityHeight,0,1);
  const cavityWidth=oralWidthM(t);
  const tongueWidth=clamp(sample.widthM/cavityWidth,0,1.2);
  const sideFraction=clamp(1-tongueWidth,0,.55);

  // Central gap dominates ordinary vowels. When the dorsum/tip reaches the
  // roof, only physically available lateral channels remain.
  const central=6.8*gap**1.55;
  const lateral=1.15*sideFraction*(1-gap)**1.2;
  return clamp(.025+central+lateral,.025,7.2);
}

function areaFrame(
  timeS:number,
  sections:number,
  profile:readonly TongueAirwaySample[],
  lipAreaCm2:number,
  velumOpen:number,
):VocalAreaFrame{
  const sorted=[...profile].sort((a,b)=>a.zM-b.zM);
  const areas=new Array<number>(sections);

  for(let i=0;i<sections;i++){
    const x=(i+.5)/sections;
    // The first ~24% of the acoustic tube is pharyngeal. Use the posterior
    // physical tongue geometry to control it rather than a phoneme/formant table.
    const oralT=clamp((x-.18)/.74,0,1);
    // Fixed head-relative acoustic axis. Tongue translation must move the
    // constriction along this axis; normalizing to current tongue bounds would
    // erase the front/back distinction between /i u/ and /t k/.
    const z=mix(AIRWAY_Z_BACK,AIRWAY_Z_FRONT,oralT);
    const tongue=interpolateTongue(sorted,z);
    let area=geometryAreaCm2(tongue,oralT);

    if(x<.24){
      const root=sorted[Math.min(sorted.length-1,1)]!;
      const rootGap=clamp((oralRoofY(.05)-root.topYM)/(oralRoofY(.05)-oralFloorY(.05)),0,1);
      const pharyngeal=clamp(.35+5.0*rootGap**1.3,.12,5.8);
      area=mix(pharyngeal,area,smooth(x/.24));
    }

    // The last tube sections are literally governed by the measured physical
    // lip aperture, so /m p b u v/ affect acoustics through the face geometry.
    if(x>.80){
      const q=smooth((x-.80)/.20);
      area=mix(area,lipAreaCm2,q);
    }
    areas[i]=clamp(area,.02,7.5);
  }

  return Object.freeze({
    timeS,
    oralAreaCm2:Object.freeze(areas),
    velumOpen:clamp(velumOpen,0,1),
    lipAreaCm2,
  });
}

export function buildSoftAirwayTimeline(
  gestures:readonly ArticulatorGesture[],
  options:SoftAirwayTimelineOptions={},
):SoftAirwayTimeline{
  if(!gestures.length)throw new RangeError('Soft airway requires at least one articulator gesture');
  const sampleRate=options.sampleRate??48_000,tractLengthM=options.tractLengthM??.1715;
  const sections=options.sections??Math.max(12,Math.round(tractLengthM/(SPEED_OF_SOUND_MPS/sampleRate)));
  const controlRateHz=options.controlRateHz??240;
  if(!Number.isFinite(controlRateHz)||controlRateHz<60||controlRateHz>480)throw new RangeError('Soft airway control rate must be 60..480 Hz');
  const dt=1/controlRateHz,durationS=gestures.at(-1)!.endS;
  const scene=new Scene(softVocalFaceSceneSpec()),rig=new SoftVocalFaceRig(scene);
  const first=sampleArticulatorScore(gestures,0).articulators;
  const warmupS=options.warmupS??.08;
  for(let t=0;t<warmupS-1e-9;t+=dt)rig.step(first,dt,first);

  const frames:VocalAreaFrame[]=[];
  const count=Math.ceil(durationS*controlRateHz);
  for(let index=0;index<=count;index++){
    const time=Math.min(durationS,index*dt);
    const sample=sampleArticulatorScore(gestures,time);
    const plan=sampleSoftMouthMotorPlan(gestures,time,options.motorLeadS??SOFT_MOUTH_MOTOR_LEAD_S);
    rig.step(sample.articulators,dt,plan);
    const profile=rig.tongue.airwayProfile(),aperture=rig.mouth.apertureGeometry();
    frames.push(areaFrame(time,sections,profile,aperture.effectiveAreaCm2,sample.articulators.velumOpen));
  }
  // Avoid duplicate terminal timestamp when duration falls exactly on the control grid.
  for(let i=frames.length-1;i>0;i--)if(frames[i]!.timeS<=frames[i-1]!.timeS)frames.splice(i,1);
  return Object.freeze({
    frames:Object.freeze(frames),
    sections,
    controlRateHz,
    durationS,
  });
}

export function renderSoftGeometrySpeech(
  gestures:readonly ArticulatorGesture[],
  options:SoftAirwayTimelineOptions={},
  phrase='soft-geometry speech',
):VocalTractRender{
  const timeline=buildSoftAirwayTimeline(gestures,options);
  const {controlRateHz:_control,motorLeadS:_lead,warmupS:_warmup,...renderOptions}=options;
  return renderArticulatedVocalTract(
    gestures,
    {...renderOptions,sections:timeline.sections,areaFrames:timeline.frames},
    phrase,
  );
}
