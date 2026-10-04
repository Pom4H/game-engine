import type {VtlDialogueTurn} from '../audio/vtl-external.js';
import {compose,finiteVec3,type MutableVec3,type Vec3} from '../math.js';
import {freezePrimitive} from '../procedural/mesh.js';
import type {RuntimeEntity,Scene} from '../scene/scene.js';
import type {Color,EntitySpec,Primitive} from '../scene/types.js';

/** A metre-scale facial rig for the winter humanoid: +X is forward, +Y is up.
 * The caller owns the head/hat/nose and supplies that same rigid head frame.
 * Speech uses the external backend's motor score, including its initial silence;
 * this is a visual projection of pronunciation, never an audio-envelope jaw. */
export interface ConversationFaceOptions {readonly id:string;readonly skin?:Color;readonly iris?:Color;}
export interface ConversationFaceFrame {
  readonly position:Vec3;readonly rotation:Vec3;readonly scale?:number;
  readonly gazeTarget?:Vec3;readonly smile?:number;readonly browLift?:number;
  readonly browTilt?:number;readonly squint?:number;readonly blink?:number;
}
export interface ConversationArticulation {
  readonly jaw:number;readonly round:number;readonly spread:number;
  readonly closure:number;readonly labiodental:number;readonly tongueTip:number;
  readonly activity:number;readonly pitchHz:number;readonly prominence:number;
}
export interface ConversationFacePose {
  readonly timeS:number;readonly speech:ConversationArticulation;
  readonly jawAngleRad:number;readonly jawDropM:number;readonly lipGapM:number;
  readonly lipWidthM:number;readonly lipProtrusionM:number;readonly toothClearanceM:number;
  readonly blink:number;readonly gazeOffset:Vec3;
}

const clamp=(v:number,lo=0,hi=1)=>Math.max(lo,Math.min(hi,v));
const smooth=(v:number)=>{const u=clamp(v);return u*u*(3-2*u);};
const REST:ConversationArticulation=Object.freeze({jaw:0,round:0,spread:0,closure:1,labiodental:0,tongueTip:0,activity:0,pitchHz:0,prominence:0});
const blend=(a:ConversationArticulation,b:ConversationArticulation,u:number):ConversationArticulation=>({
  jaw:a.jaw+(b.jaw-a.jaw)*u,round:a.round+(b.round-a.round)*u,spread:a.spread+(b.spread-a.spread)*u,
  closure:a.closure+(b.closure-a.closure)*u,labiodental:a.labiodental+(b.labiodental-a.labiodental)*u,
  tongueTip:a.tongueTip+(b.tongueTip-a.tongueTip)*u,activity:a.activity+(b.activity-a.activity)*u,
  pitchHz:a.pitchHz+(b.pitchHz-a.pitchHz)*u,prominence:a.prominence+(b.prominence-a.prominence)*u,
});
const articulation=(jaw:number,round=0,spread=0,closure=0,labiodental=0,tongueTip=0):ConversationArticulation=>({jaw,round,spread,closure,labiodental,tongueTip,activity:1,pitchHz:0,prominence:0});

function phonePose(phone:string,u:number):ConversationArticulation {
  if(!phone)return REST;
  if(['aI','aU','OY'].includes(phone)){
    const pair=phone==='aI'?['a','I']:phone==='aU'?['a','U']:['O','Y'];
    return blend(phonePose(pair[0]!,0),phonePose(pair[1]!,0),smooth((u-.25)/.65));
  }
  if(phone.length>1&&phone.endsWith('6'))return blend(phonePose(phone.slice(0,-1),0),phonePose('6',0),smooth((u-.52)/.42));
  const vowel=phone.replace(':','');
  if(vowel==='a')return articulation(.86,0,.04);
  if(vowel==='E')return articulation(.64,0,.38);
  if(vowel==='e')return articulation(.38,0,.60);
  if(['i','I'].includes(vowel))return articulation(.23,0,.72);
  if(['@','6'].includes(vowel))return articulation(.36,0,.04);
  if(vowel==='u')return articulation(.22,.90);
  if(vowel==='U')return articulation(.32,.62);
  if(vowel==='o')return articulation(.40,.84);
  if(vowel==='O')return articulation(.65,.61);
  if(['2','9'].includes(vowel))return articulation(.40,.50);
  if(['y','Y'].includes(vowel))return articulation(.22,.75);
  if(['p','b','m','pf'].includes(phone))return articulation(.08,0,0,1,phone==='pf'?.35:0);
  if(['f','v'].includes(phone))return articulation(.10,0,.10,.05,1);
  if(['t','d','n','l'].includes(phone))return articulation(.17,0,.14,0,0,1);
  if(['s','z','ts'].includes(phone))return articulation(.13,0,.35);
  if(['S','Z','C','tS','dZ'].includes(phone))return articulation(.23,.25,.06);
  if(['T','D'].includes(phone))return articulation(.20,0,.12,0,0,.78);
  if(['k','g','N','x','R'].includes(phone))return articulation(.29,.04);
  if(phone==='j')return articulation(.23,0,.68);
  if(phone==='r')return articulation(.25,.15);
  if(phone==='h')return articulation(.43);
  if(phone==='?')return articulation(.19);
  throw new RangeError('Unsupported conversation face phone: '+phone);
}

/** Phone-boundary anticipation models coarticulation. A consonant closure has
 * its own motor target and is not lost when the following vowel is loud. */
export function sampleConversationArticulation(turns:readonly VtlDialogueTurn[],speakerId:string,timeS:number):ConversationArticulation {
  if(!Number.isFinite(timeS)||timeS<0)throw new RangeError('Conversation time must be finite and non-negative');
  for(const turn of turns){
    if(turn.speakerId!==speakerId||timeS<turn.startS)continue;
    const local=timeS-turn.startS;let start=0;
    for(let i=0;i<turn.segments.length;i++){
      const segment=turn.segments[i]!,end=start+segment.durationS;
      if(local<end){
        let pose=phonePose(segment.phone,clamp((local-start)/segment.durationS));
        const next=turn.segments[i+1];
        if(next){
          const anticipation=Math.min(.042,segment.durationS*.34,next.durationS*.45);
          if(local>end-anticipation)pose=blend(pose,phonePose(next.phone,0),smooth((local-end+anticipation)/anticipation));
        }
        let pitch=turn.pitch[0]?.hz??0;
        for(let k=1;k<turn.pitch.length;k++){
          const a=turn.pitch[k-1]!,b=turn.pitch[k]!;
          if(local<b.timeS){pitch=a.hz+(b.hz-a.hz)*clamp((local-a.timeS)/(b.timeS-a.timeS));break;}
          pitch=b.hz;
        }
        const reference=turn.pitch.reduce((sum,p)=>sum+p.hz,0)/Math.max(1,turn.pitch.length);
        return Object.freeze({...pose,pitchHz:pose.activity?pitch:0,prominence:pose.activity&&reference>0?clamp(12*Math.log2(pitch/reference)/5,-1,1):0});
      }
      start=end;
    }
  }
  return REST;
}

const faceKeys=['mouth','upper-teeth','lower-teeth','tongue',
  ...['left','right'].flatMap(side=>['eye-socket','eye','iris','pupil','upper-lid','lower-lid','brow','lip-corner',
    ...['upper-lip','lower-lip'].flatMap(part=>Array.from({length:4},(_,i)=>part+(i?'-'+i:'')))].map(part=>side+'-'+part))] as const;
const keyId=(id:string,key:string)=>id+'-face-'+key;
const sphere:Primitive={kind:'sphere',radius:.5,segments:32};
function validId(id:string):void{if(!/^[A-Za-z0-9][A-Za-z0-9_-]{0,100}$/.test(id))throw new TypeError('Conversation face needs a stable namespaced ID');}

const headX=(y:number,z:number)=>.0925*Math.sqrt(Math.max(0,1-(y/.1125)**2-(z/.089)**2));
/** The existing head silhouette at unit scale; keep the actor's original
 * [.185,.225,.178] scale. Eye sockets permit inset eyes and curved lids instead
 * of floating ellipsoids covering an intact sphere. */
export function conversationHeadMesh():Primitive {
  const positions:number[]=[],normals:number[]=[],indices:number[]=[],holes:boolean[]=[],rows=128,columns=192;
  for(let i=0;i<=rows;i++)for(let j=0;j<=columns;j++){
    const p=i/rows*Math.PI,a=j/columns*Math.PI*2-Math.PI;
    let x=Math.sin(p)*Math.cos(a)*.0925,y=Math.cos(p)*.1125,z=Math.sin(p)*Math.sin(a)*.089,hole=false;
    if(x>0)for(const side of [-1,1]){
      const dy=(y-.029)/.0104,dz=(z-side*.035)/.0184,radius=Math.hypot(dy,dz);
      if(radius<1){hole=true;y=.029+dy/Math.max(radius,1e-9)*.0104;z=side*.035+dz/Math.max(radius,1e-9)*.0184;x=headX(y,z);break;}
    }
    positions.push(x/.185,y/.225,z/.178);normals.push(x/.0925,y/.1125,z/.089);holes.push(hole);
  }
  const add=(a:number,b:number,c:number)=>{
    if(holes[a]&&holes[b]&&holes[c])return;
    const ax=positions[a*3]!,ay=positions[a*3+1]!,az=positions[a*3+2]!,bx=positions[b*3]!,by=positions[b*3+1]!,bz=positions[b*3+2]!,cx=positions[c*3]!,cy=positions[c*3+1]!,cz=positions[c*3+2]!;
    const ux=bx-ax,uy=by-ay,uz=bz-az,vx=cx-ax,vy=cy-ay,vz=cz-az;
    const outward=(uy*vz-uz*vy)*(ax+bx+cx)+(uz*vx-ux*vz)*(ay+by+cy)+(ux*vy-uy*vx)*(az+bz+cz);
    if(Math.abs(outward)<1e-15)return;
    if(outward<0)indices.push(a,c,b);else indices.push(a,b,c);
  };
  for(let i=0;i<rows;i++)for(let j=0;j<columns;j++){const a=i*(columns+1)+j,b=a+columns+1;add(a,a+1,b);add(a+1,b+1,b);}
  return{kind:'triangle-mesh',positions,normals,indices};
}

function lidPatch(side:number,upper:boolean,closure=0):Primitive {
  const positions:number[]=[],normals:number[]=[],indices:number[]=[],n=32,r=8,sign=upper?1:-1;
  for(let i=0;i<=n;i++)for(let j=0;j<=r;j++){
    const u=i/n*2-1,v=j/r,arc=Math.sqrt(Math.max(.001,1-u*u)),z=u*.019;
    const outer=upper?.022:-.018,inner=upper?.006-.0145*closure:-.006+.002*closure;
    const y=(outer*(1-v)+inner*v)*arc;
    positions.push(headX(.029+y,side*.035+z)-.0006+v*.0041*arc+(upper?.005:0)*Math.sin(v*Math.PI)*arc,y,z);
  }
  for(let i=0;i<=n;i++)for(let j=0;j<=r;j++){
    const at=(row:number,col:number)=>positions.slice((row*(r+1)+col)*3,(row*(r+1)+col)*3+3);
    const a=at(Math.max(0,i-1),j),b=at(Math.min(n,i+1),j),c=at(i,Math.max(0,j-1)),d=at(i,Math.min(r,j+1));
    const u=b.map((v,k)=>v-a[k]!),v=d.map((x,k)=>x-c[k]!);
    const normal=[u[1]!*v[2]!-u[2]!*v[1]!,u[2]!*v[0]!-u[0]!*v[2]!,u[0]!*v[1]!-u[1]!*v[0]!].map(x=>x*sign),length=Math.hypot(...normal)||1;
    normals.push(...normal.map(x=>x/length));
    if(i<n&&j<r){const q=i*(r+1)+j,s=q+r+1;if(upper)indices.push(q,s,q+1,q+1,s,s+1);else indices.push(q,q+1,s,q+1,s+1,s);}
  }
  return{kind:'triangle-mesh',positions,normals,indices};
}
const lidBanks=new Map<string,readonly Primitive[]>();
function lidMesh(side:number,upper:boolean,closure:number):Primitive {
  const key=side+':'+upper;let bank=lidBanks.get(key);
  // Bounded pose cache: <0.5 mm between lid poses at original actor size.
  // This deforms the inner edge around the eyeball while keeping its corners
  // and outer skin attachment fixed, unlike scaling a whole eyelid downwards.
  if(!bank){bank=Array.from({length:33},(_,i)=>freezePrimitive(lidPatch(side,upper,i/32)));lidBanks.set(key,bank);}
  return bank[Math.round(clamp(closure)*32)]!;
}

/** Smooth tapered ribbon, elongated along local Z. Unlike boxes or dots these
 * are actual shaded lip/brow surfaces, with rounded cross sections. */
function ribbon(brow=false):Primitive {
  const positions:number[]=[],normals:number[]=[],indices:number[]=[],n=24,r=16;
  for(let i=0;i<=n;i++){
    const t=i/n,z=t-.5,taper=brow?Math.sqrt(Math.max(.008,1-(2*t-1)**2)):.90+.10*Math.sin(t*Math.PI),arch=brow?.18*Math.sin(t*Math.PI):.025*Math.sin(t*Math.PI);
    for(let j=0;j<=r;j++){
      const a=j/r*Math.PI*2,c=Math.cos(a),s=Math.sin(a);
      positions.push(c*.5*taper,s*.5*taper+arch,z);normals.push(c,s,0);
      if(i<n&&j<r){const q=i*(r+1)+j;indices.push(q,q+1,q+r+1,q+1,q+r+2,q+r+1);}
    }
  }
  return{kind:'triangle-mesh',positions,normals,indices};
}

export function conversationFaceEntities(options:ConversationFaceOptions):EntitySpec[] {
  validId(options.id);
  const skin=options.skin??[.51,.34,.25,1],iris=options.iris??[.16,.24,.19,1];
  for(const color of [skin,iris])if(color.length!==4||color.some(v=>!Number.isFinite(v)||v<0||v>1))throw new RangeError('Face colours must be RGBA within 0..1');
  const lip:Color=[skin[0]*.92,skin[1]*.62,skin[2]*.68,1],brow:Color=[.085,.050,.032,1];
  const entities:EntitySpec[]=[],add=(key:string,position:Vec3,scale:Vec3,color:Color,roughness=.63,mesh:Primitive=sphere)=>entities.push({id:keyId(options.id,key),position,scale,mesh,renderOnly:true,material:{kind:'default',color,roughness}});
  add('mouth',[.089,-.043,0],[.006,.001,.047],[.026,.010,.009,1],.93);
  add('upper-teeth',[.040,-.038,0],[.006,.0045,.030],[.83,.81,.74,1],.38);
  add('lower-teeth',[.040,-.0455,0],[.005,.0034,.029],[.79,.77,.70,1],.40);
  add('tongue',[.040,-.050,0],[.005,.004,.024],[.47,.20,.18,1],.58);
  for(const side of [-1,1]){
    const name=side<0?'left':'right',z=side*.035;
    add(name+'-eye-socket',[.069,.029,z],[.012,.023,.039],[skin[0]*.58,skin[1]*.53,skin[2]*.48,1],.75);
    add(name+'-eye',[.0745,.029,z],[.013,.016,.031],[.80,.81,.76,1],.27);
    add(name+'-iris',[.0818,.029,z],[.0026,.0115,.0115],iris,.26);
    add(name+'-pupil',[.08325,.029,z],[.0018,.0055,.0055],[.013,.012,.011,1],.23);
    add(name+'-upper-lid',[0,.029,z],[1,1,1],skin,.68,lidMesh(side,true,0));
    add(name+'-lower-lid',[0,.029,z],[1,1,1],skin,.68,lidMesh(side,false,0));
    add(name+'-brow',[headX(.052,z)+.0007,.052,z],[.0025,.003,.037],brow,.84,ribbon(true));
    for(const upper of [true,false])for(let i=0;i<4;i++)add(name+(upper?'-upper-lip':'-lower-lip')+(i?'-'+i:''),[.093,-.043,side*.006*(i+.5)],[upper?.0045:.0055,upper?.0032:.0038,.0076],lip,upper?.58:.56,ribbon());
    add(name+'-lip-corner',[.089,-.043,side*.024],[.004,.003,.004],lip,.62);
  }
  return entities;
}

interface Spring {value:number;velocity:number}
function advance(state:Spring,target:number,hz:number,dt:number):void {
  const omega=2*Math.PI*hz,offset=state.value-target,e=Math.exp(-omega*dt),temp=(state.velocity+omega*offset)*dt;
  state.value=target+(offset+temp)*e;state.velocity=(state.velocity-omega*temp)*e;
}
function hashId(id:string):number {let h=2166136261;for(const char of id){h^=char.charCodeAt(0);h=Math.imul(h,16777619);}return h>>>0;}
function combinedRotation(parent:Vec3,localX:number):Vec3 {
  if(!localX)return parent;
  // compose() uses Rx*Ry*Rz. Multiply its basis by local Rx and recover that
  // same convention; simply adding Euler angles would detach turned lips.
  const m=compose([0,0,0],parent,[1,1,1]),c=Math.cos(localX),s=Math.sin(localX);
  const m02=-s*m[4]!+c*m[8]!,m12=-s*m[5]!+c*m[9]!,m22=-s*m[6]!+c*m[10]!;
  const ry=Math.asin(clamp(m02,-1,1));
  if(Math.abs(Math.cos(ry))<1e-7)return[Math.atan2(c*m[6]!+s*m[10]!,c*m[5]!+s*m[9]!),ry,0];
  const m01=c*m[4]!+s*m[8]!;
  return[Math.atan2(-m12,m22),ry,Math.atan2(-m01,m[0]!)];
}

export class ConversationFaceRig {
  private readonly parts=new Map<string,RuntimeEntity>();
  private readonly turns:readonly VtlDialogueTurn[];
  private readonly blinks:number[]=[];
  private readonly springs=Object.fromEntries(['jaw','gap','width','protrusion','smile','brow','gazeY','gazeZ'].map(key=>[key,{value:0,velocity:0}])) as Record<'jaw'|'gap'|'width'|'protrusion'|'smile'|'brow'|'gazeY'|'gazeZ',Spring>;
  private time=-1;
  constructor(readonly scene:Scene,readonly options:{readonly id:string;readonly speakerId:string;readonly turns:readonly VtlDialogueTurn[]}) {
    validId(options.id);
    this.turns=structuredClone(options.turns.filter(turn=>turn.speakerId===options.speakerId));
    let end=-1;
    for(const turn of this.turns){
      if(!Number.isFinite(turn.startS)||turn.startS<0||turn.startS<end)throw new RangeError('Face turns for one speaker must be ordered and non-overlapping');
      let duration=0;
      for(const segment of turn.segments){if(!Number.isFinite(segment.durationS)||segment.durationS<=0)throw new RangeError('Face phone duration must be positive');phonePose(segment.phone,0);duration+=segment.durationS;}
      if(!duration||!turn.pitch.length||turn.pitch.some(point=>!Number.isFinite(point.hz)||point.hz<=0||!Number.isFinite(point.timeS)||point.timeS<0))throw new RangeError('Face turn requires a finite pitch contour and phones');
      end=turn.startS+duration;
    }
    for(const key of faceKeys){const entity=scene.entities.get(keyId(options.id,key));if(!entity)throw new TypeError('Missing conversation face entity '+keyId(options.id,key));this.parts.set(key,entity);}
    let seed=hashId(options.id),at=.85+(seed%791)/1000;
    while(at<601){this.blinks.push(at);seed=(Math.imul(seed,1664525)+1013904223)>>>0;at+=2.4+(seed/4294967296)*2.2;}
  }

  private blinkAt(time:number):number {
    for(const at of this.blinks){const t=time-at;if(t<0)break;if(t<.055)return smooth(t/.055);if(t<.070)return 1;if(t<.170)return 1-smooth((t-.070)/.100);}
    return 0;
  }

  step(timeS:number,dt:number,frame:ConversationFaceFrame):ConversationFacePose {
    if(!Number.isFinite(timeS)||timeS<0||timeS<this.time||timeS===this.time&&dt>0)throw new RangeError('Conversation face time must advance monotonically');
    if(!Number.isFinite(dt)||dt<0||dt>.25||this.time>=0&&dt===0&&timeS!==this.time)throw new RangeError('Face dt must be within 0..0.25; zero initializes the current frame');
    finiteVec3(frame.position,'Face position');finiteVec3(frame.rotation,'Face rotation');if(frame.gazeTarget)finiteVec3(frame.gazeTarget,'Face gaze target');
    const scale=frame.scale??1;if(!Number.isFinite(scale)||scale<=0||scale>3)throw new RangeError('Face scale must be within (0,3]');
    for(const key of ['smile','browLift','browTilt','squint','blink'] as const){const value=frame[key];if(value!==undefined&&(!Number.isFinite(value)||value<0||value>1))throw new RangeError('Face '+key+' must be within 0..1');}
    const speech=sampleConversationArticulation(this.turns,this.options.speakerId,timeS),matrix=compose(frame.position,frame.rotation,[scale,scale,scale]);
    let gazeY=0,gazeZ=0;
    if(frame.gazeTarget){
      const d=frame.gazeTarget.map((v,i)=>(v-frame.position[i]!)/scale),local=[0,1,2].map(i=>(matrix[i*4]!*d[0]!+matrix[i*4+1]!*d[1]!+matrix[i*4+2]!*d[2]!)/scale);
      gazeY=clamp((local[1]!-.029)/Math.max(.08,local[0]!),-1,1)*.0033;
      gazeZ=clamp(local[2]!/Math.max(.08,local[0]!),-1,1)*.0053;
    }
    const targets={jaw:.115*speech.jaw,gap:.0004+.016*speech.jaw*(1-speech.closure)**2*(1-.62*speech.labiodental),
      width:.047-.015*speech.round+.003*speech.spread,protrusion:.0045*speech.round,
      smile:frame.smile??0,brow:clamp((frame.browLift??0)+Math.max(0,speech.prominence)*.13),gazeY,gazeZ};
    for(const key of Object.keys(targets) as (keyof typeof targets)[]){
      const spring=this.springs[key];if(this.time<0||dt===0){spring.value=targets[key];spring.velocity=0;}
      else advance(spring,targets[key],key==='jaw'?6.2:key==='gap'||key==='width'||key==='protrusion'?10:key.startsWith('gaze')?13:4.2,dt);
    }
    this.time=timeS;
    const jaw=this.springs.jaw.value,jawDrop=.067*Math.sin(jaw),gap=Math.max(.0003,this.springs.gap.value),smile=this.springs.smile.value;
    const width=this.springs.width.value+.004*smile,protrusion=this.springs.protrusion.value,cy=-.043-jawDrop*.28,front=.093+protrusion;
    const place=(key:string,p:Vec3,s:Vec3,localX=0)=>{
      const entity=this.parts.get(key)!;
      entity.position.splice(0,3,...[0,1,2].map(i=>matrix[i]!*p[0]+matrix[i+4]!*p[1]+matrix[i+8]!*p[2]+matrix[i+12]!) as MutableVec3);
      entity.rotation.splice(0,3,...combinedRotation(frame.rotation,localX));entity.scale.splice(0,3,s[0]*scale,s[1]*scale,s[2]*scale);
    };
    place('mouth',[gap>.002?front-.004:.040,cy,0],[.006,Math.max(.0007,gap+.0015),width*.96]);
    const upperVisible=gap>.0055&&speech.closure<.65,lowerVisible=gap>.009&&speech.closure<.40;
    place('upper-teeth',[upperVisible?front-.0005:.040,cy+.005,0],[.005,.0045,Math.min(.030,width*.69)]);
    place('lower-teeth',[lowerVisible?front-.001:.040,cy-.0025-jawDrop,0],[.004,.0034,Math.min(.029,width*.65)]);
    place('tongue',[gap>.009?front-.0015:.040,cy-gap*.33,0],[.005,.0035,.022]);
    const blink=Math.max(frame.blink??0,this.blinkAt(timeS)),squint=(frame.squint??0)*.5+smile*.15;
    for(const side of [-1,1]){
      const name=side<0?'left':'right',z=side*.035,asymmetry=side<0?.92:1.08,cornerY=cy+.0054*smile*asymmetry;
      place(name+'-eye-socket',[.069,.029,z],[.012,.023,.039]);
      place(name+'-eye',[.0745,.029,z],[.013,.016,.031]);
      const ey=this.springs.gazeY.value,ez=this.springs.gazeZ.value,eyeFront=.0818-.0007*(Math.abs(ez)/.0053)**2;
      place(name+'-iris',[eyeFront,.029+ey,z+ez],[.0026,.0115,.0115]);
      place(name+'-pupil',[eyeFront+.00145,.029+ey,z+ez],[.0018,.0055,.0055]);
      const lid=clamp(blink+squint);
      place(name+'-upper-lid',[0,.029,z],[1,1,1]);
      place(name+'-lower-lid',[0,.029,z],[1,1,1]);
      this.parts.get(name+'-upper-lid')!.mesh=lidMesh(side,true,lid);
      this.parts.get(name+'-lower-lid')!.mesh=lidMesh(side,false,squint);
      const browY=.052+.005*this.springs.brow.value*asymmetry;
      place(name+'-brow',[headX(browY,z)+.0007,browY,z],[.0025,.003,.037],-side*((frame.browTilt??0)*.24+smile*.04));
      for(const upper of [true,false])for(let i=0;i<4;i++){
        const innerY=cy+(upper?1:-1)*gap*.50+(upper?0:.002*speech.labiodental),a=i/4,b=(i+1)/4,mid=(a+b)/2;
        const y0=innerY+(cornerY-innerY)*a*a,y1=innerY+(cornerY-innerY)*b*b;
        const slope=Math.atan2(y1-y0,width*.125),length=Math.hypot(width*.125,y1-y0);
        place(name+(upper?'-upper-lip':'-lower-lip')+(i?'-'+i:''),[front-.002*mid*mid,(y0+y1)*.5,side*width*.5*mid],[upper?.0045:.0055,upper?.0032:.0038,length*1.24],-side*slope);
      }
      place(name+'-lip-corner',[front-.0018,cornerY,side*width*.5],[.004,.0035,.0045]);
    }
    return Object.freeze({timeS,speech,jawAngleRad:jaw,jawDropM:jawDrop,lipGapM:gap,lipWidthM:width,lipProtrusionM:protrusion,
      toothClearanceM:.00355+jawDrop,blink,gazeOffset:Object.freeze([0,this.springs.gazeY.value,this.springs.gazeZ.value]) as Vec3});
  }
}
