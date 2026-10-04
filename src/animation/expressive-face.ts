import {ConversationFaceRig,conversationFaceEntities,conversationHeadMesh,type ConversationFaceFrame} from './conversation-face.js';
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
  readonly squint?:number;readonly blink?:number;
}
export interface FaceActionLayer {readonly weight:number;readonly actions:FaceActions;}
export interface FaceIdentity {readonly skin:Color;readonly iris:Color;readonly jawWidth:number;readonly cheekbone:number;readonly noseLength:number;readonly stubble?:boolean;readonly freckles?:boolean;}
export const WINTER_FACE_IDENTITIES:Readonly<Record<'mike'|'anna',FaceIdentity>>=Object.freeze({
  mike:Object.freeze({skin:[.51,.34,.25,1] as Color,iris:[.11,.16,.12,1] as Color,jawWidth:1.09,cheekbone:.006,noseLength:.035,stubble:true}),
  anna:Object.freeze({skin:[.62,.43,.33,1] as Color,iris:[.12,.24,.28,1] as Color,jawWidth:.94,cheekbone:.009,noseLength:.027,freckles:true}),
});
const KEYS=['smileLeft','smileRight','browLeft','browRight','browTiltLeft','browTiltRight','cheekLeft','cheekRight','squint','blink'] as const;
const clamp=(x:number,a=0,b=1)=>Math.max(a,Math.min(b,x));
const valid=(x:number,label:string)=>{if(!Number.isFinite(x)||x<0||x>1)throw new RangeError(label+' must be within 0..1');};
type FaceActionValues={-readonly [K in keyof Required<FaceActions>]:number};
export function blendFaceActions(layers:readonly FaceActionLayer[]):FaceActionValues{
  const result=Object.fromEntries(KEYS.map(key=>[key,0])) as FaceActionValues;
  for(const layer of layers){valid(layer.weight,'Face layer weight');for(const key of KEYS){const value=layer.actions[key]??0;valid(value,key);result[key]+=value*layer.weight;}}
  for(const key of KEYS)result[key]=clamp(result[key]);return result;
}
function surfaceX(y:number,z:number):number{return .0925*Math.sqrt(Math.max(0,1-(y/.1125)**2-(z/.089)**2));}
const gauss=(x:number,mu:number,sigma:number)=>Math.exp(-(((x-mu)/sigma)**2));
function sculpt(x:number,y:number,z:number,identity:FaceIdentity):Vec3{
  const front=clamp(x/.05),mouth=gauss(y,-.043,.021)*gauss(z,0,.033),eye=gauss(y,.029,.024)*gauss(Math.abs(z),.035,.025);
  const cheek=identity.cheekbone*gauss(y,-.009,.023)*gauss(Math.abs(z),.052,.024);
  const chin=.011*gauss(y,-.082,.019)*gauss(z,0,.037);
  const brow=.004*gauss(y,.057,.014)*gauss(Math.abs(z),.034,.027);
  const protection=(1-mouth)*(1-eye);
  return[x+front*(cheek+chin+brow)*protection,y,z*(1+(identity.jawWidth-1)*gauss(y,-.073,.026)*(1-mouth)*front)];
}
function validateIdentity(identity:FaceIdentity):void{
  for(const name of ['skin','iris'] as const)if(identity[name].length!==4||identity[name].some(v=>!Number.isFinite(v)||v<0||v>1))throw new RangeError('Invalid face '+name);
  for(const [name,lo,hi] of [['jawWidth',.8,1.2],['cheekbone',0,.02],['noseLength',.015,.055]] as const)if(!Number.isFinite(identity[name])||identity[name]<lo||identity[name]>hi)throw new RangeError('Invalid face '+name);
}
/** Keep the existing cast's mounting frame and eye sockets, but give each head
 * distinct cheekbones, chin, jaw and skin colour variation instead of an egg. */
export function expressiveHeadMesh(identity:FaceIdentity):Primitive{
  validateIdentity(identity);
  const source=conversationHeadMesh();if(source.kind!=='triangle-mesh')throw new Error('Head topology');
  const positions:number[]=[],normals=new Array<number>(source.positions.length).fill(0),colors:number[]=[],indices=[...source.indices];
  for(let i=0;i<source.positions.length;i+=3){
    const x=source.positions[i]!*.185,y=source.positions[i+1]!*.225,z=source.positions[i+2]!*.178;
    const p=sculpt(x,y,z,identity);positions.push(p[0]/.185,p[1]/.225,p[2]/.178);
    const cheek=gauss(y,-.015,.027)*gauss(Math.abs(z),.052,.023)*clamp(x/.07),shade=.025*Math.sin(y*270+z*183);
    colors.push(1,clamp(1-.13*cheek+shade),clamp(1-.09*cheek+shade),1);
  }
  for(let i=0;i<indices.length;i+=3){
    const a=indices[i]!*3,b=indices[i+1]!*3,c=indices[i+2]!*3,ux=positions[b]!-positions[a]!,uy=positions[b+1]!-positions[a+1]!,uz=positions[b+2]!-positions[a+2]!,vx=positions[c]!-positions[a]!,vy=positions[c+1]!-positions[a+1]!,vz=positions[c+2]!-positions[a+2]!;
    const n=[uy*vz-uz*vy,uz*vx-ux*vz,ux*vy-uy*vx];for(const at of [a,b,c])for(let k=0;k<3;k++)normals[at+k]=normals[at+k]!+n[k]!;
  }
  for(let i=0;i<normals.length;i+=3){const length=Math.hypot(normals[i]!,normals[i+1]!,normals[i+2]!);for(let k=0;k<3;k++)normals[i+k]=length>1e-12?normals[i+k]!/length:source.normals[i+k]!;}
  return{kind:'triangle-mesh',positions,normals,indices,colors};
}
function detailMesh(identity:FaceIdentity):Primitive{
  const positions:number[]=[],normals:number[]=[],indices:number[]=[];
  let seed=identity.stubble?18273:7961;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  const count=identity.stubble?360:54;
  for(let i=0;i<count;i++){
    const y=identity.stubble?-.084+random()*.054:-.020+random()*.027,z=(random()-.5)*(identity.stubble?.13:.12);
    if(Math.abs(z)<.030&&y>-.066&&y<-.018)continue;
    const x=surfaceX(y,z);if(x<.02)continue;
    const p=sculpt(x,y,z,identity),r=identity.stubble?.00035+random()*.00028:.0005+random()*.00055,at=positions.length/3;
    positions.push(p[0]+.0005,p[1]-r,p[2]-r,p[0]+.0005,p[1]+r,p[2],p[0]+.0005,p[1]-r,p[2]+r);normals.push(1,0,0,1,0,0,1,0,0);indices.push(at,at+1,at+2);
  }
  return{kind:'triangle-mesh',positions,normals,indices};
}
export function expressiveFaceEntities(id:string,identity:FaceIdentity):EntitySpec[]{
  validateIdentity(identity);
  const entities=conversationFaceEntities({id,skin:identity.skin,iris:identity.iris});
  const add=(key:string,position:Vec3,scale:Vec3,color:Color,mesh:Primitive={kind:'sphere',radius:.5,segments:24})=>entities.push({id:id+'-face-'+key,position,scale,mesh,renderOnly:true,material:{kind:'default',color,roughness:.67}});
  add('nose-bridge',[.084,.015,0],[.029,.064,.024],identity.skin);
  add('nose-tip',[.096+identity.noseLength*.4,-.004,0],[identity.noseLength,.029,.031],identity.skin);
  for(const side of [-1,1]){
    add('nose-ala'+side,[.098,-.013,side*.015],[.017,.018,.017],identity.skin);
    add('nostril'+side,[.104,-.019,side*.010],[.009,.0037,.009],[identity.skin[0]*.34,identity.skin[1]*.25,identity.skin[2]*.25,1]);
    add('ear'+side,[-.017,-.005,side*.087],[.032,.061,.020],identity.skin);
    add('ear-concha'+side,[-.009,-.005,side*.097],[.018,.038,.004],[identity.skin[0]*.69,identity.skin[1]*.57,identity.skin[2]*.59,1]);
  }
  add('skin-detail',[0,0,0],[1,1,1],identity.stubble?[.18,.12,.085,1]:[.35,.18,.105,1],detailMesh(identity));
  return entities;
}
function rotated(parent:Vec3,angle:number):Vec3{
  const m=compose([0,0,0],parent,[1,1,1]),c=Math.cos(angle),s=Math.sin(angle),y=Math.asin(clamp(-s*m[4]!+c*m[8]!,-1,1));
  if(Math.abs(Math.cos(y))<1e-7)return[Math.atan2(c*m[6]!+s*m[10]!,c*m[5]!+s*m[9]!),y,0];
  return[Math.atan2(s*m[5]!-c*m[9]!,-s*m[6]!+c*m[10]!),y,Math.atan2(-c*m[4]!-s*m[8]!,m[0]!)];
}
export interface ExpressiveFaceObservation {readonly motorTimeS:number;readonly apertureAreaM2:number;readonly acousticAreaM2:number;readonly actions:Required<FaceActions>;readonly blink:number;readonly source:'shared-vocal-motor';}
/** Eye, attention and expression channels are independent of pronunciation.
 * The native mouth is projected directly from the acoustic motor state: it is
 * never reconstructed from phoneme labels or waveform loudness. */
export class ExpressiveFaceRig {
  private readonly base:ConversationFaceRig;
  private readonly details:{entity:RuntimeEntity;position:Vec3;scale:Vec3}[];
  private readonly parts=new Map<string,RuntimeEntity>();
  constructor(readonly scene:Scene,readonly id:string,identity:FaceIdentity){
    this.base=new ConversationFaceRig(scene,{id,speakerId:id,turns:[]});
    const originals=expressiveFaceEntities(id,identity);
    this.details=originals.filter(e=>/-(nose-bridge|nose-tip|nose-ala-?1|nostril-?1|ear-?1|ear-concha-?1|skin-detail)$/.test(e.id)).map(e=>{
      const entity=scene.entities.get(e.id);if(!entity)throw new Error('Missing face detail '+e.id);return{entity,position:e.position??[0,0,0],scale:e.scale??[1,1,1]};
    });
    for(const e of originals){const entity=scene.entities.get(e.id);if(!entity)throw new Error('Missing face part '+e.id);this.parts.set(e.id.slice(id.length+6),entity);}
  }
  step(timeS:number,dt:number,frame:ConversationFaceFrame,motor:VocalMotorFrame,layers:readonly FaceActionLayer[]):ExpressiveFaceObservation{
    if(Math.abs(motor.timeS-timeS)>1e-7)throw new RangeError('Face and voice motor clocks disagree');
    for(const key of ['lipWidthM','lipGapM','lipProtrusionM','jawAngleRad'] as const)if(!Number.isFinite(motor[key])||motor[key]<0)throw new RangeError('Invalid native mouth '+key);
    if(motor.lipWidthM<=0||motor.lipWidthM>.12||motor.lipGapM>.08||motor.oralAreaCm2.length!==44)throw new RangeError('Native mouth dimensions');
    const acousticArea=motor.oralAreaCm2[43]!*1e-4,area=Math.PI/4*motor.lipWidthM*motor.lipGapM;
    if(!Number.isFinite(acousticArea)||Math.abs(acousticArea-area)>1e-10)throw new RangeError('Native mouth aperture disagrees with acoustic tube');
    const actions=blendFaceActions(layers),scale=frame.scale??1;
    const base=this.base.step(timeS,dt,{...frame,smile:0,browLift:0,browTilt:0,squint:clamp(actions.squint+.16*(actions.cheekLeft+actions.cheekRight)),blink:actions.blink});
    const matrix=compose(frame.position,frame.rotation,[scale,scale,scale]);
    const place=(key:string,p:Vec3,s:Vec3,angle=0)=>{
      const e=this.parts.get(key);if(!e)throw new Error('Missing face projection '+key);
      e.position.splice(0,3,...[0,1,2].map(i=>matrix[i]!*p[0]+matrix[i+4]!*p[1]+matrix[i+8]!*p[2]+matrix[i+12]!));
      e.rotation.splice(0,3,...rotated(frame.rotation,angle));e.scale.splice(0,3,...s.map(v=>v*scale));
    };
    for(const detail of this.details){const p=detail.position;detail.entity.position.splice(0,3,...[0,1,2].map(i=>matrix[i]!*p[0]+matrix[i+4]!*p[1]+matrix[i+8]!*p[2]+matrix[i+12]!));detail.entity.rotation.splice(0,3,...frame.rotation);detail.entity.scale.splice(0,3,...detail.scale.map(v=>v*scale));}
    const width=motor.lipWidthM/scale,gap=motor.lipGapM/scale,front=.093+motor.lipProtrusionM/scale,cy=-.043-.011*Math.sin(motor.jawAngleRad);
    place('mouth',[front-.004,cy,0],[.006,Math.max(1e-7,gap),width]);
    place('upper-teeth',[gap>.007?front-.002:.035,cy+gap*.26,0],[.005,.0034,Math.min(.029,width*.69)]);
    place('lower-teeth',[gap>.011?front-.003:.035,cy-gap*.30,0],[.004,.003,Math.min(.028,width*.66)]);
    place('tongue',[gap>.009?front-.003:.035,cy-gap*.32,0],[.004,.003,.022]);
    for(const side of [-1,1]){
      const name=side<0?'left':'right',smile=side<0?actions.smileLeft:actions.smileRight,cheek=side<0?actions.cheekLeft:actions.cheekRight,brow=side<0?actions.browLeft:actions.browRight,tilt=side<0?actions.browTiltLeft:actions.browTiltRight,z=side*.035;
      const browY=.052+brow*.007;
      place(name+'-brow',[surfaceX(browY,z)+.002,browY,z],[.0030,.0038,.037],-side*(tilt-.5)*.34);
      for(const upper of [true,false])for(let i=0;i<4;i++){
        const a=i/4,b=(i+1)/4,z0=side*width*.5*a,z1=side*width*.5*b;
        const curve=(u:number)=>(upper?1:-1)*gap*.5*Math.sqrt(Math.max(0,1-u*u))+(.0045*smile+.0012*cheek)*u*u;
        const y0=cy+curve(a),y1=cy+curve(b),dy=y1-y0,dz=z1-z0,length=Math.hypot(dy,dz),thickness=upper?.0024:.0030;
        const normalY=(upper?1:-1)*Math.abs(dz)/Math.max(1e-8,length),normalZ=-(upper?1:-1)*dy*Math.sign(dz)/Math.max(1e-8,length);
        place(name+(upper?'-upper-lip':'-lower-lip')+(i?'-'+i:''),[front-.002*((a+b)*.5)**2,(y0+y1)*.5+normalY*thickness*.5,(z0+z1)*.5+normalZ*thickness*.5],[.004,thickness,length*1.06],-Math.atan2(dy,dz)+(side<0?Math.PI:0));
      }
      place(name+'-lip-corner',[front-.002,cy+.0045*smile+.0012*cheek,side*width*.5],[.003,.003,.003]);
    }
    return{motorTimeS:motor.timeS,apertureAreaM2:area,acousticAreaM2:acousticArea,actions,blink:base.blink,source:'shared-vocal-motor'};
  }
}
