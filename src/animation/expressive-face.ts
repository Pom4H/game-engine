import type {ConversationFaceFrame} from './conversation-face.js';
import {FaceSurface,neutralFaceSurface,validateFaceIdentity} from './face-surface.js';
import type {VocalMotorFrame} from '../audio/native-speech.js';
import {compose,type Vec3} from '../math.js';
import type {Scene,RuntimeEntity} from '../scene/scene.js';
import type {Color,EntitySpec,Primitive} from '../scene/types.js';

/** Independent face actions inspired by the public Source facial layering
 * design. Clean implementation: no Valve code, models or phoneme tables. */
export interface FaceActions {
  readonly smileLeft?:number;readonly smileRight?:number;
  readonly browLeft?:number;readonly browRight?:number;
  readonly browTiltLeft?:number;readonly browTiltRight?:number;
  readonly cheekLeft?:number;readonly cheekRight?:number;
  readonly squint?:number;readonly squintLeft?:number;readonly squintRight?:number;
  readonly sneerLeft?:number;readonly sneerRight?:number;readonly blink?:number;
}
export interface FaceActionLayer {readonly weight:number;readonly actions:FaceActions;}
export interface FaceIdentity {readonly skin:Color;readonly iris:Color;readonly jawWidth:number;readonly cheekbone:number;readonly noseLength:number;readonly stubble?:boolean;readonly freckles?:boolean;}
export const WINTER_FACE_IDENTITIES:Readonly<Record<'mike'|'anna',FaceIdentity>>=Object.freeze({
  mike:Object.freeze({skin:[.51,.34,.25,1] as Color,iris:[.11,.16,.12,1] as Color,jawWidth:1.09,cheekbone:.006,noseLength:.035,stubble:true}),
  anna:Object.freeze({skin:[.62,.43,.33,1] as Color,iris:[.12,.24,.28,1] as Color,jawWidth:.94,cheekbone:.009,noseLength:.027,freckles:true}),
});
const KEYS=['smileLeft','smileRight','browLeft','browRight','browTiltLeft','browTiltRight','cheekLeft','cheekRight','squint','squintLeft','squintRight','sneerLeft','sneerRight','blink'] as const;
const clamp=(x:number,a=0,b=1)=>Math.max(a,Math.min(b,x));
const valid=(x:number,label:string)=>{if(!Number.isFinite(x)||x<0||x>1)throw new RangeError(label+' must be within 0..1');};
type FaceActionValues={-readonly [K in keyof Required<FaceActions>]:number};
export function blendFaceActions(layers:readonly FaceActionLayer[]):FaceActionValues{
  const result=Object.fromEntries(KEYS.map(key=>[key,key.startsWith('browTilt')?.5:0])) as FaceActionValues;
  for(const layer of layers){valid(layer.weight,'Face layer weight');for(const key of KEYS){const neutral=key.startsWith('browTilt')?.5:0,value=layer.actions[key]??neutral;valid(value,key);result[key]+=(value-neutral)*layer.weight;}}
  for(const key of KEYS)result[key]=clamp(result[key]);return result;
}
/** Static authoring projection retains the historical normalized head scale. */
export function expressiveHeadMesh(identity:FaceIdentity):Primitive{
  validateFaceIdentity(identity);const surface=new FaceSurface(identity),p=surface.stream.primitive;
  const positions=p.positions.map((v,i)=>v/[.185,.225,.178][i%3]!);
  const normals=p.normals.map((v,i)=>v*[.185,.225,.178][i%3]!);
  for(let i=0;i<normals.length;i+=3){const n=Math.hypot(normals[i]!,normals[i+1]!,normals[i+2]!);for(let j=0;j<3;j++)normals[i+j]=normals[i+j]!/n;}
  surface.stream.dispose();return{...p,positions,normals};
}
const keys=['skin','mouth','upper-teeth','lower-teeth','tongue','left-eye','left-iris','left-pupil','right-eye','right-iris','right-pupil'] as const;
export function expressiveFaceEntities(id:string,identity:FaceIdentity):EntitySpec[]{
  if(!/^[A-Za-z0-9][A-Za-z0-9_-]{0,100}$/.test(id))throw new TypeError('Invalid face ID');validateFaceIdentity(identity);
  const surface=new FaceSurface(identity),skin=surface.stream.primitive;surface.stream.dispose();
  return keys.map(key=>({id:id+'-face-'+key,renderOnly:true,position:[0,0,0],scale:[1,1,1],
    mesh:key==='skin'?skin:{kind:'sphere',radius:.5,segments:24},
    material:{kind:'default',roughness:key.includes('iris')||key.includes('pupil')?.20:key.includes('teeth')?.40:.64,
      color:key==='skin'?identity.skin:key==='mouth'?[.027,.009,.011,1]:key==='tongue'?[.40,.16,.17,1]:key.includes('teeth')?[.77,.74,.66,1]:key.includes('iris')?identity.iris:key.includes('pupil')?[.008,.008,.008,1]:[.71,.72,.68,1]}}));
}
export interface ExpressiveFaceObservation {
  readonly motorTimeS:number;readonly apertureAreaM2:number;readonly acousticAreaM2:number;
  readonly actions:Required<FaceActions>;readonly blink:number;readonly source:'shared-vocal-motor';
  readonly lowerLipWorld:Vec3;
  readonly skin:ReturnType<FaceSurface['inspect']>;
}
/** Source-style separation of speech, expression, attention and blinking.
 * All skin flexes are evaluated into one fixed-topology mesh; no per-frame pose
 * meshes are cached. Render geometry is an acoustic motor projection, not a
 * second phoneme table and not a soft-tissue acoustic boundary simulation. */
export class ExpressiveFaceRig {
  readonly surface:FaceSurface;
  private readonly parts=new Map<string,RuntimeEntity>();
  private readonly phase:number;
  private gazeY=0;private gazeZ=0;private previousTime:number|undefined;
  constructor(readonly scene:Scene,readonly id:string,identity:FaceIdentity){
    validateFaceIdentity(identity);this.surface=new FaceSurface(identity);
    for(const key of keys){const entity=scene.entities.get(id+'-face-'+key);if(!entity)throw new Error('Missing face part '+key);this.parts.set(key,entity);}
    this.parts.get('skin')!.renderMesh=this.surface.stream.primitive;
    let hash=2166136261;for(const char of id)hash=Math.imul(hash^char.charCodeAt(0),16777619);this.phase=(hash>>>0)/4294967296*3.6;
  }
  step(timeS:number,dt:number,frame:ConversationFaceFrame,motor:VocalMotorFrame,layers:readonly FaceActionLayer[]):ExpressiveFaceObservation{
    if(!Number.isFinite(timeS)||timeS<0||!Number.isFinite(dt)||dt<0||dt>.25)throw new RangeError('Invalid face clock');
    if(Math.abs(motor.timeS-timeS)>1e-7)throw new RangeError('Face and voice motor clocks disagree');
    for(const key of ['lipWidthM','lipGapM','lipProtrusionM','jawAngleRad'] as const)if(!Number.isFinite(motor[key])||motor[key]<0)throw new RangeError('Invalid native mouth '+key);
    if(motor.lipWidthM<=0||motor.lipWidthM>.12||motor.lipGapM>.08||motor.oralAreaCm2.length!==44)throw new RangeError('Native mouth dimensions');
    const acousticArea=motor.oralAreaCm2[43]!*1e-4,area=Math.PI/4*motor.lipWidthM*motor.lipGapM;
    if(!Number.isFinite(acousticArea)||Math.abs(acousticArea-area)>1e-10)throw new RangeError('Native mouth aperture disagrees with acoustic tube');
    const actions=blendFaceActions(layers),scale=frame.scale??1;
    if(!Number.isFinite(scale)||scale<=0||[...frame.position,...frame.rotation,...(frame.gazeTarget??[])].some(v=>!Number.isFinite(v)))throw new RangeError('Invalid face frame');
    const matrix=compose(frame.position,frame.rotation,[scale,scale,scale]);
    const place=(key:string,p:Vec3,s:Vec3)=>{const e=this.parts.get(key)!;
      for(let i=0;i<3;i++){e.position[i]=matrix[i]!*p[0]+matrix[i+4]!*p[1]+matrix[i+8]!*p[2]+matrix[i+12]!;e.rotation[i]=frame.rotation[i]!;e.scale[i]=s[i]!*scale;}
    };
    let gy=0,gz=0;
    if(frame.gazeTarget){
      const d=frame.gazeTarget.map((v,i)=>v-frame.position[i]!),local=[0,1,2].map(i=>(matrix[i*4]!*d[0]!+matrix[i*4+1]!*d[1]!+matrix[i*4+2]!*d[2]!)/scale);
      const distance=Math.max(.12,local[0]!);gy=clamp((local[1]!-.029)/distance,-.5,.5)*.009;gz=clamp(local[2]!/distance,-.5,.5)*.011;
    }
    // Closed-form first-order relaxation, no frame-dependent random jitter.
    const reset=this.previousTime===undefined||timeS<this.previousTime||dt===0,alpha=reset?1:1-Math.exp(-dt/.055);
    this.gazeY+=(gy-this.gazeY)*alpha;this.gazeZ+=(gz-this.gazeZ)*alpha;this.previousTime=timeS;
    const age=(timeS+this.phase)%3.6;
    const spontaneous=age<.065?Math.sin(age/.065*Math.PI/2)**2:age<.18?Math.cos((age-.065)/.115*Math.PI/2)**2:0;
    const blink=Math.max(actions.blink,spontaneous),width=motor.lipWidthM/scale,gap=motor.lipGapM/scale,cy=-.043-gap*.30-.011*Math.sin(motor.jawAngleRad);
    this.surface.update({...neutralFaceSurface(),width,gap,protrusion:motor.lipProtrusionM/scale,jaw:motor.jawAngleRad,
      smileLeft:actions.smileLeft,smileRight:actions.smileRight,browLeft:actions.browLeft,browRight:actions.browRight,browTiltLeft:actions.browTiltLeft,browTiltRight:actions.browTiltRight,
      cheekLeft:actions.cheekLeft,cheekRight:actions.cheekRight,squint:actions.squint,squintLeft:actions.squintLeft,squintRight:actions.squintRight,
      sneerLeft:actions.sneerLeft,sneerRight:actions.sneerRight,blink,gazeY:this.gazeY});
    place('skin',[0,0,0],[1,1,1]);
    place('mouth',[.081,cy,0],[.035,Math.max(1e-7,gap),width]);
    // Teeth stay inside the oral cavity. Visibility is determined by actual
    // lip occlusion rather than teleporting teeth at a loudness threshold.
    place('upper-teeth',[.094,-.041,0],[.007,.004,.031]);
    place('lower-teeth',[.092,cy-gap*.32-.004,0],[.006,.0034,.029]);
    place('tongue',[.086,cy-gap*.35-.003,0],[.016,.004,.024]);
    for(const side of [-1,1]){
      const name=side<0?'left':'right',z=side*.03385,ey=this.gazeY,ez=this.gazeZ,ex=.07456+Math.sqrt(.014**2-ey*ey-ez*ez);
      place(name+'-eye',[.07456,.029,z],[.027,.028,.028]);
      place(name+'-iris',[ex,.029+ey,z+ez],[.0022,.0105,.0105]);
      place(name+'-pupil',[ex+.00115,.029+ey,z+ez],[.0014,.0046,.0046]);
    }
    const lip=this.surface.lowerLipCenter(),lowerLipWorld=[0,1,2].map(i=>matrix[i]!*lip[0]+matrix[i+4]!*lip[1]+matrix[i+8]!*lip[2]+matrix[i+12]!) as [number,number,number];
    return{lowerLipWorld,motorTimeS:timeS,apertureAreaM2:this.surface.openingArea()*scale*scale,acousticAreaM2:acousticArea,actions,blink,source:'shared-vocal-motor',skin:this.surface.inspect()};
  }
  dispose():void{this.surface.stream.dispose();delete this.parts.get('skin')!.renderMesh;}
}
