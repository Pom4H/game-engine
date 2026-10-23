import type {VocalArticulators} from '../audio/vocal-tract.js';
import type {Vec3} from '../math.js';
import {Scene,type RuntimeEntity} from '../scene/scene.js';
import type {EntitySpec,SceneSpec} from '../scene/types.js';

export const VOCAL_FACE_IDS=Object.freeze({
  jaw:'vocal-face-jaw',
  mouth:'vocal-face-mouth',
  upperLip:'vocal-face-upper-lip',
  lowerLip:'vocal-face-lower-lip',
  tongue:'vocal-face-tongue',
  upperTeeth:'vocal-face-upper-teeth',
  lowerTeeth:'vocal-face-lower-teeth',
});

export interface VocalFacePose {
  readonly jawDropM:number;
  readonly jawAngleRad:number;
  readonly toothClearanceM:number;
  readonly lipGapM:number;
  readonly lipGapVelocityMps:number;
  readonly lipWidthM:number;
  readonly lipProtrusionM:number;
  readonly tonguePosition:Vec3;
  readonly tongueScale:Vec3;
}

export interface VocalFaceCollisionDiagnostics {
  readonly toothClearanceM:number;
  readonly teethColliding:boolean;
}

const skin:[number,number,number,number]=[.62,.39,.30,1];
const skinLight:[number,number,number,number]=[.72,.48,.38,1];
const lip:[number,number,number,number]=[.42,.09,.11,1];
const tongueColor:[number,number,number,number]=[.62,.17,.20,1];
const white:[number,number,number,number]=[.92,.94,.96,1];
const iris:[number,number,number,number]=[.10,.24,.29,1];
const black:[number,number,number,number]=[.008,.009,.012,1];

const clamp01=(v:number)=>Math.max(0,Math.min(1,v));

const kinematic=(size:Vec3)=>({mass:0,motion:'kinematic' as const,shape:'box' as const,collisionSize:size});

export function vocalFaceSceneSpec():SceneSpec{
  const entities:EntitySpec[]=[
    {id:'vocal-face-shoulders',position:[0,.48,-.03],mesh:{kind:'sphere',radius:.5},scale:[1.9,.52,.78],material:{kind:'default',color:skin,roughness:.64}},
    {id:'vocal-face-neck',position:[0,.88,-.04],mesh:{kind:'cylinder',radius:.23,height:.72,segments:32},material:{kind:'default',color:skin,roughness:.62}},
    {id:'vocal-face-head',position:[0,1.68,0],mesh:{kind:'sphere',radius:.5},scale:[1.08,1.42,.94],material:{kind:'default',color:skin,roughness:.58}},
    {id:VOCAL_FACE_IDS.jaw,position:[0,1.34,.035],mesh:{kind:'sphere',radius:.5},scale:[.83,.58,.78],material:{kind:'default',color:skin,roughness:.58},body:kinematic([.83,.58,.78])},
    {id:'vocal-face-left-ear',position:[-.56,1.69,-.01],mesh:{kind:'sphere',radius:.5},scale:[.16,.29,.12],material:{kind:'default',color:skinLight,roughness:.62}},
    {id:'vocal-face-right-ear',position:[.56,1.69,-.01],mesh:{kind:'sphere',radius:.5},scale:[.16,.29,.12],material:{kind:'default',color:skinLight,roughness:.62}},
    {id:'vocal-face-left-eye',position:[-.225,1.87,.455],mesh:{kind:'sphere',radius:.5},scale:[.25,.135,.085],material:{kind:'default',color:white,roughness:.18}},
    {id:'vocal-face-right-eye',position:[.225,1.87,.455],mesh:{kind:'sphere',radius:.5},scale:[.25,.135,.085],material:{kind:'default',color:white,roughness:.18}},
    {id:'vocal-face-left-iris',position:[-.225,1.87,.505],mesh:{kind:'sphere',radius:.5},scale:[.092,.092,.030],material:{kind:'default',color:iris,roughness:.16}},
    {id:'vocal-face-right-iris',position:[.225,1.87,.505],mesh:{kind:'sphere',radius:.5},scale:[.092,.092,.030],material:{kind:'default',color:iris,roughness:.16}},
    {id:'vocal-face-left-pupil',position:[-.225,1.87,.525],mesh:{kind:'sphere',radius:.5},scale:[.043,.043,.018],material:{kind:'default',color:black,roughness:.08}},
    {id:'vocal-face-right-pupil',position:[.225,1.87,.525],mesh:{kind:'sphere',radius:.5},scale:[.043,.043,.018],material:{kind:'default',color:black,roughness:.08}},
    {id:'vocal-face-left-brow',position:[-.23,2.01,.485],rotation:[0,0,-.08],mesh:{kind:'box',size:[.30,.045,.035]},material:{kind:'default',color:[.09,.05,.035,1],roughness:.78}},
    {id:'vocal-face-right-brow',position:[.23,2.01,.485],rotation:[0,0,.08],mesh:{kind:'box',size:[.30,.045,.035]},material:{kind:'default',color:[.09,.05,.035,1],roughness:.78}},
    {id:'vocal-face-nose-bridge',position:[0,1.70,.485],mesh:{kind:'sphere',radius:.5},scale:[.16,.42,.14],material:{kind:'default',color:skinLight,roughness:.56}},
    {id:'vocal-face-nose-dorsum',position:[0,1.59,.555],mesh:{kind:'sphere',radius:.5},scale:[.20,.28,.20],material:{kind:'default',color:skinLight,roughness:.54}},
    {id:'vocal-face-nose-tip',position:[0,1.525,.635],mesh:{kind:'sphere',radius:.5},scale:[.24,.18,.19],material:{kind:'default',color:skinLight,roughness:.52}},
    {id:'vocal-face-nose-left-ala',position:[-.105,1.50,.625],mesh:{kind:'sphere',radius:.5},scale:[.13,.095,.11],material:{kind:'default',color:skinLight,roughness:.55}},
    {id:'vocal-face-nose-right-ala',position:[.105,1.50,.625],mesh:{kind:'sphere',radius:.5},scale:[.13,.095,.11],material:{kind:'default',color:skinLight,roughness:.55}},
    {id:'vocal-face-left-nostril',position:[-.072,1.475,.700],mesh:{kind:'sphere',radius:.5},scale:[.060,.030,.018],material:{kind:'default',color:black,roughness:.92}},
    {id:'vocal-face-right-nostril',position:[.072,1.475,.700],mesh:{kind:'sphere',radius:.5},scale:[.060,.030,.018],material:{kind:'default',color:black,roughness:.92}},
    {id:VOCAL_FACE_IDS.mouth,position:[0,1.36,.525],mesh:{kind:'sphere',radius:.5},scale:[.46,.055,.055],material:{kind:'default',color:black,roughness:.86},body:kinematic([.46,.20,.08])},
    {id:'vocal-face-upper-teeth',position:[0,1.385,.566],mesh:{kind:'box',size:[.33,.055,.028]},material:{kind:'default',color:white,roughness:.20}},
    {id:VOCAL_FACE_IDS.lowerTeeth,position:[0,1.326,.563],mesh:{kind:'box',size:[.32,.050,.026]},material:{kind:'default',color:white,roughness:.20},body:kinematic([.32,.05,.03])},
    {id:VOCAL_FACE_IDS.tongue,position:[0,1.29,.548],mesh:{kind:'sphere',radius:.5},scale:[.31,.075,.22],material:{kind:'default',color:tongueColor,roughness:.72},body:kinematic([.31,.12,.22])},
    {id:VOCAL_FACE_IDS.upperLip,position:[0,1.405,.588],mesh:{kind:'sphere',radius:.5},scale:[.47,.078,.070],material:{kind:'default',color:lip,roughness:.48},body:kinematic([.47,.10,.08])},
    {id:VOCAL_FACE_IDS.lowerLip,position:[0,1.325,.590],mesh:{kind:'sphere',radius:.5},scale:[.47,.085,.075],material:{kind:'default',color:lip,roughness:.48},body:kinematic([.47,.11,.08])},
    {id:'vocal-face-key-light',position:[1.9,3.0,2.5],light:{kind:'point',color:[1,.72,.58],intensity:18,range:8}},
    {id:'vocal-face-fill-light',position:[-2.0,2.2,1.8],light:{kind:'point',color:[.48,.65,1],intensity:8,range:7}},
  ];
  return{
    version:1,
    gravity:[0,0,0],
    ground:-100,
    clearColor:[.018,.022,.030,1],
    camera:{position:[0,1.64,3.25],target:[0,1.60,.25],fov:28,focusDistance:3.0,aperture:.025},
    rendering:{sunDirection:[-.45,.55,.55],sunColor:[1,.83,.72],sunIntensity:1.1,skyColor:[.035,.045,.065],fogDensity:0,exposure:1.08,shadowExtent:6},
    entities,
  };
}

const TMJ_PIVOT:Vec3=[0,1.52,-.05];
const JAW_CENTER_REST:Vec3=[0,1.34,.035];
const LOWER_TEETH_REST:Vec3=[0,1.326,.563];
const UPPER_TEETH_BOTTOM_Y=1.385-.055/2;
const LOWER_TOOTH_HALF_HEIGHT=.050/2;
const MIN_TOOTH_CLEARANCE_M=.0035;

const rotateAboutX=(point:Vec3,pivot:Vec3,angle:number,forward:number):Vec3=>{
  const dy=point[1]-pivot[1],dz=point[2]-pivot[2],cs=Math.cos(angle),sn=Math.sin(angle);
  return[
    point[0],
    pivot[1]+dy*cs-dz*sn,
    pivot[2]+dy*sn+dz*cs+forward,
  ];
};

function lowerIncisorTopY(angle:number,forward:number):number{
  const center=rotateAboutX(LOWER_TEETH_REST,TMJ_PIVOT,angle,forward);
  // Conservative vertical half extent of a box rotated about X.
  const halfY=LOWER_TOOTH_HALF_HEIGHT*Math.abs(Math.cos(angle))+(.026/2)*Math.abs(Math.sin(angle));
  return center[1]+halfY;
}

export function vocalFaceCollisionDiagnostics(scene:Scene):VocalFaceCollisionDiagnostics{
  const lower=requireEntity(scene,VOCAL_FACE_IDS.lowerTeeth),angle=lower.rotation[0];
  const halfY=LOWER_TOOTH_HALF_HEIGHT*Math.abs(Math.cos(angle))+(.026/2)*Math.abs(Math.sin(angle));
  const clearance=UPPER_TEETH_BOTTOM_Y-(lower.position[1]+halfY);
  return Object.freeze({toothClearanceM:clearance,teethColliding:clearance<0});
}

function requireEntity(scene:Scene,id:string):RuntimeEntity{
  const entity=scene.entities.get(id);if(!entity)throw new TypeError('Missing vocal face entity '+id);return entity;
}

export class VocalFaceRig {
  private readonly jaw:RuntimeEntity;
  private readonly mouth:RuntimeEntity;
  private readonly upperLip:RuntimeEntity;
  private readonly lowerLip:RuntimeEntity;
  private readonly tongue:RuntimeEntity;
  private readonly upperTeeth:RuntimeEntity;
  private readonly lowerTeeth:RuntimeEntity;
  private jawAngle=0;
  private jawAngularVelocity=0;
  private jawInitialized=false;
  private lipGap=.04;
  private lipGapVelocity=0;
  private lipWidth=.44;
  private lipWidthVelocity=0;
  private lipProtrusion=0;
  private lipProtrusionVelocity=0;
  private lipsInitialized=false;

  constructor(readonly scene:Scene){
    this.jaw=requireEntity(scene,VOCAL_FACE_IDS.jaw);
    this.mouth=requireEntity(scene,VOCAL_FACE_IDS.mouth);
    this.upperLip=requireEntity(scene,VOCAL_FACE_IDS.upperLip);
    this.lowerLip=requireEntity(scene,VOCAL_FACE_IDS.lowerLip);
    this.tongue=requireEntity(scene,VOCAL_FACE_IDS.tongue);
    this.upperTeeth=requireEntity(scene,VOCAL_FACE_IDS.upperTeeth);
    this.lowerTeeth=requireEntity(scene,VOCAL_FACE_IDS.lowerTeeth);
  }

  private targetJawAngle(a:VocalArticulators):number{
    // Speaking normally does not bring incisors into contact. Jaw control is an
    // angle at the TMJ; translation emerges as a small anterior glide.
    return .12*clamp01(a.jawOpen);
  }

  private applyPose(a:VocalArticulators,jawAngle:number,lipState?:{gap:number;width:number;protrusion:number;gapVelocity:number}):VocalFacePose{
    const forward=.014*clamp01(a.jawOpen);
    // Enforce a hard anatomical invariant at the incisors. If a future score
    // asks for an impossible closure, increase opening rather than interpenetrate.
    let angle=Math.max(0,jawAngle);
    for(let i=0;i<8&&UPPER_TEETH_BOTTOM_Y-lowerIncisorTopY(angle,forward)<MIN_TOOTH_CLEARANCE_M;i++)angle+=.004;

    const jawCenter=rotateAboutX(JAW_CENTER_REST,TMJ_PIVOT,angle,forward*.45);
    const teethCenter=rotateAboutX(LOWER_TEETH_REST,TMJ_PIVOT,angle,forward);
    const toothClearance=UPPER_TEETH_BOTTOM_Y-lowerIncisorTopY(angle,forward);
    const jawDrop=JAW_CENTER_REST[1]-jawCenter[1];

    const closure=1-a.lipClosure;
    const targetLipGap=.006+.145*a.jawOpen*closure;
    const targetLipWidth=.47*(1-.31*a.lipRound-.08*a.labiodental);
    const targetProtrusion=.075*a.lipRound+.018*a.labiodental;
    const lipGap=lipState?.gap??targetLipGap;
    const lipWidth=lipState?.width??targetLipWidth;
    const protrusion=.588+(lipState?.protrusion??targetProtrusion);

    this.jaw.position[0]=jawCenter[0];this.jaw.position[1]=jawCenter[1];this.jaw.position[2]=jawCenter[2];
    this.jaw.rotation[0]=angle;

    this.lowerTeeth.position[0]=teethCenter[0];this.lowerTeeth.position[1]=teethCenter[1];this.lowerTeeth.position[2]=teethCenter[2];
    this.lowerTeeth.rotation[0]=angle;

    this.mouth.position[1]=1.365-jawDrop*.32;
    this.mouth.position[2]=.535+forward*.4+.018*a.lipRound;
    this.mouth.scale[0]=Math.max(.19,lipWidth*.95);
    this.mouth.scale[1]=Math.max(.018,.035+lipGap*1.25);
    this.mouth.scale[2]=.060+.018*a.lipRound;

    const centerY=1.37-jawDrop*.36;
    const upperY=centerY+lipGap*.50;
    let lowerY=centerY-lipGap*.50-jawDrop*.18;
    if(a.labiodental>0)lowerY+=.055*a.labiodental;
    this.upperLip.position[0]=0;this.upperLip.position[1]=upperY;this.upperLip.position[2]=protrusion;
    this.lowerLip.position[0]=0;this.lowerLip.position[1]=lowerY;this.lowerLip.position[2]=protrusion+forward*.35+.006*a.labiodental;
    for(const entity of [this.upperLip,this.lowerLip]){
      entity.scale[0]=lipWidth;
      entity.scale[1]=.070+.040*a.lipRound+.018*a.lipClosure;
      entity.scale[2]=.070+.042*a.lipRound;
    }

    const tongueZ=.438+.145*a.tonguePosition+.035*a.tongueTip+forward*.42;
    const tongueY=1.235-jawDrop*.46+.125*a.tongueHeight+.060*a.tongueTip;
    this.tongue.position[0]=0;this.tongue.position[1]=tongueY;this.tongue.position[2]=tongueZ;
    this.tongue.rotation[0]=angle*.45-.18*a.tongueTip;
    this.tongue.scale[0]=.31-.045*a.tongueHeight;
    this.tongue.scale[1]=.060+.055*a.tongueHeight;
    this.tongue.scale[2]=.22-.035*a.tonguePosition;

    return Object.freeze({
      jawDropM:jawDrop,jawAngleRad:angle,toothClearanceM:toothClearance,
      lipGapM:lipGap,lipGapVelocityMps:lipState?.gapVelocity??0,lipWidthM:lipWidth,lipProtrusionM:protrusion-.588,
      tonguePosition:Object.freeze([0,tongueY,tongueZ]) as Vec3,
      tongueScale:Object.freeze([...this.tongue.scale]) as Vec3,
    });
  }

  apply(a:VocalArticulators):VocalFacePose{
    const target=this.targetJawAngle(a);
    this.jawAngle=target;this.jawAngularVelocity=0;this.jawInitialized=true;
    return this.applyPose(a,target);
  }

  /** Biomechanical jaw projection for animation. Motor commands may jump at
   * phoneme boundaries; the mandible cannot. A critically damped TMJ hinge
   * filters those commands and keeps the lower teeth rigidly on the mandible. */
  step(a:VocalArticulators,dt:number):VocalFacePose{
    if(!Number.isFinite(dt)||dt<=0||dt>.25)throw new RangeError('Vocal face dt must be within (0, .25]');
    const targetJaw=this.targetJawAngle(a);
    const targetLipGap=.006+.145*a.jawOpen*(1-a.lipClosure);
    const targetLipWidth=.47*(1-.31*a.lipRound-.08*a.labiodental);
    const targetLipProtrusion=.075*a.lipRound+.018*a.labiodental;
    if(!this.jawInitialized){this.jawAngle=targetJaw;this.jawAngularVelocity=0;this.jawInitialized=true;}
    if(!this.lipsInitialized){
      this.lipGap=targetLipGap;this.lipWidth=targetLipWidth;this.lipProtrusion=targetLipProtrusion;
      this.lipGapVelocity=0;this.lipWidthVelocity=0;this.lipProtrusionVelocity=0;this.lipsInitialized=true;
    }
    const jawOmega=2*Math.PI*5.2,lipOmega=2*Math.PI*7.0,zeta=1;
    const maxGapSpeed=.22,maxWidthSpeed=.30,maxProtrusionSpeed=.18;
    let remaining=dt;
    while(remaining>1e-9){
      const h=Math.min(remaining,1/240);
      const jawAcceleration=jawOmega*jawOmega*(targetJaw-this.jawAngle)-2*zeta*jawOmega*this.jawAngularVelocity;
      this.jawAngularVelocity+=jawAcceleration*h;
      this.jawAngle+=this.jawAngularVelocity*h;

      const stepSoft=(value:number,velocity:number,target:number,maxSpeed:number):readonly[number,number]=>{
        const acceleration=lipOmega*lipOmega*(target-value)-2*zeta*lipOmega*velocity;
        let nextVelocity=velocity+acceleration*h;
        nextVelocity=Math.max(-maxSpeed,Math.min(maxSpeed,nextVelocity));
        return[value+nextVelocity*h,nextVelocity] as const;
      };
      [this.lipGap,this.lipGapVelocity]=stepSoft(this.lipGap,this.lipGapVelocity,targetLipGap,maxGapSpeed);
      [this.lipWidth,this.lipWidthVelocity]=stepSoft(this.lipWidth,this.lipWidthVelocity,targetLipWidth,maxWidthSpeed);
      [this.lipProtrusion,this.lipProtrusionVelocity]=stepSoft(this.lipProtrusion,this.lipProtrusionVelocity,targetLipProtrusion,maxProtrusionSpeed);
      remaining-=h;
    }
    return this.applyPose(a,this.jawAngle,{gap:this.lipGap,width:this.lipWidth,protrusion:this.lipProtrusion,gapVelocity:this.lipGapVelocity});
  }

}
