import {type Vec3} from '../math.js';
import type {AnimationSystem,HumanoidPose,UpperBodyLayer,UpperBodyTargets} from '../animation/locomotion.js';
import type {ConversationFaceRig,ConversationFaceFrame,ConversationFacePose} from '../animation/conversation-face.js';
import {actingTime,clampActing} from './motivation.js';
import {sampleActingPerformance,validateActingCue,type ActingCue,type ActingPerformance} from './performance.js';

/** Authority задаёт доступность каналов. Захват/бой/инструмент имеют приоритет. */
export interface ActingMask {readonly leftArm:boolean;readonly rightArm:boolean;readonly head:boolean}
const FREE:ActingMask=Object.freeze({leftArm:true,rightArm:true,head:true});
const smooth=(n:number)=>{const u=clampActing(n);return u*u*(3-2*u);};
const offset=(base:Vec3,delta:Vec3,pose:HumanoidPose):Vec3=>{
 const c=Math.cos(pose.heading),s=Math.sin(pose.heading),h=pose.heightScale;
 return [base[0]+h*(c*delta[0]+s*delta[2]),base[1]+h*delta[1],base[2]+h*(-s*delta[0]+c*delta[2])];
};
function blend(a:ActingPerformance,b:ActingPerformance,keep:number):ActingPerformance {
 return {...b,weight:Math.max(a.weight*keep,b.weight),
  leftHandOffset:a.leftHandOffset.map((v,i)=>v*keep+b.leftHandOffset[i]!) as unknown as Vec3,
  rightHandOffset:a.rightHandOffset.map((v,i)=>v*keep+b.rightHandOffset[i]!) as unknown as Vec3,
  headYaw:a.headYaw*keep+b.headYaw,headNod:a.headNod*keep+b.headNod,
  smile:clampActing(a.smile*keep+b.smile),browLift:clampActing(a.browLift*keep+b.browLift),
  browTilt:clampActing(a.browTilt*keep+b.browTilt),squint:clampActing(a.squint*keep+b.squint),
  ...(b.gazeTarget?{}:a.gazeTarget&&keep>0?{gazeTarget:a.gazeTarget}:{})};
}
/** Адаптер к существующим AnimationSystem и ConversationFaceRig, не второй NPC.
 * Один cue исполняется телом и лицом в одном времени Scene. Челюсть и фонемы
 * остаются у ConversationFaceRig; этот слой не синтезирует речь и не меняет мир. */
export class ActingRig {
 private cue:ActingCue|null=null;private previous:ActingCue|null=null;
 private serial=0;private mask:ActingMask=FREE;private disposed=false;
 private readonly layer:UpperBodyLayer;
 constructor(readonly animation:AnimationSystem,readonly actorId:string){
  this.layer=(pose,time)=>this.targets(pose,time);animation.setUpperBodyLayer(actorId,this.layer);
 }
 /** Только после commit смыслового действия. Повторный/задержавшийся пакет — no-op. */
 submit(cue:ActingCue,mask:ActingMask=FREE):boolean {
  validateActingCue(cue);this.assertAttached();
  for(const key of ['leftArm','rightArm','head'] as const)if(typeof mask[key]!=='boolean')throw new TypeError('Invalid acting channel mask');
  if(cue.serial<=this.serial)return false;
  if(this.cue&&cue.startS<this.cue.startS)throw new RangeError('Acting cue moved backwards');
  // Не теряем незавершённый переход: источник не должен выпускать больше одного
  // смыслового жеста на 220 мс. Это явное backpressure, не скрытое накопление очереди.
  if(this.cue&&cue.startS-this.cue.startS<.22)throw new RangeError('Acting transition is still active');
  this.previous=this.cue;this.cue=structuredClone(cue);this.serial=cue.serial;this.mask={...mask};return true;
 }
 setMask(mask:ActingMask):void {
  this.assertAttached();for(const key of ['leftArm','rightArm','head'] as const)if(typeof mask[key]!=='boolean')throw new TypeError('Invalid acting channel mask');this.mask={...mask};
 }
 private assertAttached():void {if(this.disposed||!this.animation.hasUpperBodyLayer(this.actorId,this.layer))throw new Error('Acting rig is detached');}
 private sample(time:number):ActingPerformance|null {
  if(!this.cue)return null;
  const next=sampleActingPerformance(this.cue,time);
  if(!this.previous)return next;
  const keep=1-smooth((time-this.cue.startS)/.22);
  return keep>0?blend(sampleActingPerformance(this.previous,time),next,keep):next;
 }
 private targets(pose:HumanoidPose,time:number):UpperBodyTargets|undefined {
  const f=this.sample(time);if(!f||f.weight===0)return undefined;
  return {...(this.mask.leftArm&&f.leftHandOffset.some(v=>v!==0)?{leftHand:offset(pose.joints.leftHand,f.leftHandOffset,pose)}:{}),
   ...(this.mask.rightArm&&f.rightHandOffset.some(v=>v!==0)?{rightHand:offset(pose.joints.rightHand,f.rightHandOffset,pose)}:{}),
   ...(this.mask.head?{headRotation:[0,pose.heading+f.headYaw,f.headNod] as Vec3}:{})};
 }
 /** Вызывать после штатного Scene/AnimationSystem.step, не на отдельном UI-clock. */
 faceFrame(timeS:number):ConversationFaceFrame {
  this.assertAttached();actingTime(timeS);
  if(Math.abs(this.animation.timeSeconds-timeS)>1e-9)throw new RangeError('Face and body must use the same simulation sample');
  const pose=this.animation.pose(this.actorId);if(!pose)throw new Error('Actor pose has not been published');
  const f=this.sample(timeS),enabled=this.mask.head;
  return {position:pose.joints.head,rotation:pose.headRotation??[0,pose.heading,0],scale:pose.heightScale,
   smile:enabled?(f?.smile??0):0,browLift:enabled?(f?.browLift??0):0,browTilt:enabled?(f?.browTilt??0):0,squint:enabled?(f?.squint??0):0,
   ...(enabled&&f?.gazeTarget?{gazeTarget:f.gazeTarget}:{})};
 }
 stepFace(face:ConversationFaceRig,timeS:number,dt:number):ConversationFacePose{return face.step(timeS,dt,this.faceFrame(timeS));}
 dispose():void {this.animation.clearUpperBodyLayer(this.actorId,this.layer);this.disposed=true;this.cue=null;this.previous=null;}
 get diagnostics():Readonly<{serial:number;retainedCues:number;attached:boolean}>{return {serial:this.serial,retainedCues:Number(!!this.cue)+Number(!!this.previous),attached:!this.disposed&&this.animation.hasUpperBodyLayer(this.actorId,this.layer)};}
}
