import {Scene} from '../../dist/scene/scene.js';
import {sampleWalker,bindHumanoid,solveTwoBone} from '../../dist/animation/locomotion.js';
import {ExpressiveFaceRig,WINTER_FACE_IDENTITIES} from '../../dist/animation/expressive-face.js';
import {NativeSpeechMotor,nativeSpeechPlan,createVocalMotorFrame} from '../../dist/audio/native-speech.js';
import {compose} from '../../dist/math.js';
import {createPerformanceStage,performanceBindings,cast,at,GROUND,TABLE,SHOP_DOOR} from './stage.mjs';
import {createTeaPerformancePlan,TEA_PERFORMANCE_DURATION} from './plan.mjs';
import {TEA_SPIT_EVENT} from './chaos-events.mjs';

// Authored acting intent, not a fluid/biomechanical simulation. The same scene
// tick owns voice motors, facial projection, hands, held props and camera.
const clamp=x=>Math.max(0,Math.min(1,x)),ease=x=>{const u=clamp(x);return u*u*u*(u*(u*6-15)+10);};
const ramp=(t,a,b)=>ease((t-a)/(b-a));
const window=(t,a,b,c,d)=>ramp(t,a,b)*(1-ramp(t,c,d));
const mix=(a,b,u)=>a.map((v,i)=>v+(b[i]-v)*u),add=(a,b)=>a.map((v,i)=>v+b[i]),sub=(a,b)=>a.map((v,i)=>v-b[i]);
const point=(m,p)=>[0,1,2].map(i=>m[i]*p[0]+m[i+4]*p[1]+m[i+8]*p[2]+m[i+12]);
const rotate=(r,p)=>point(compose([0,0,0],r,[1,1,1]),p);
const local=(p,r,v)=>point(compose(p,r,[1,1,1]),v);
const deltaAngle=(a,b)=>Math.atan2(Math.sin(b-a),Math.cos(b-a));
const pulse=(t,start,length,amplitude=1)=>{const u=(t-start)/length;return u>0&&u<1?Math.sin(Math.PI*u)**2*amplitude:0;};
const DEPART_START=35.55,DEPART_END=42;
const doorTarget=actor=>[SHOP_DOOR[0]+(actor.id==='mike'?-.18:.18),GROUND,SHOP_DOOR[2]-(actor.id==='mike'?.12:.28)];
const hash01=n=>{const x=Math.sin(n*12.9898+78.233)*43758.5453;return x-Math.floor(x);};
function track(t,keys){if(t<=keys[0][0])return [...keys[0][1]];for(let i=1;i<keys.length;i++)if(t<keys[i][0])return mix(keys[i-1][1],keys[i][1],ramp(t,keys[i-1][0],keys[i][0]));return [...keys.at(-1)[1]];}
const put=(scene,id,p,r=[0,0,0],s)=>{const e=scene.entities.get(id);if(!e)throw new Error('Missing stage output '+id);e.position.splice(0,3,...p);e.rotation.splice(0,3,...r);if(s)e.scale.splice(0,3,...s);};
function segmentPose(a,b){const d=sub(b,a),length=Math.hypot(...d);return{position:mix(a,b,.5),rotation:[Math.atan2(d[2],d[1]),0,Math.asin(-d[0]/Math.max(1e-9,length))],length};}
export function performanceCamera(t){
 let shot='arrival',p=at(-.05,1.83,-2.55),q=at(0,1.28,0),fov=36;
 if(t>=1.15&&t<4.25){shot='offer';p=at(.54,1.79,-1.10);q=at(-.54,1.59,0);fov=27;}
 else if(t>=4.25&&t<7.40){shot='cold-hands';p=at(.12,1.79,-1.58);q=at(.52,1.47,0);fov=30;}
 else if(t>=7.40&&t<11){shot='warning-and-pour';p=at(-.08,1.78,-2.15);q=at(-.04,1.31,-.015);fov=34;}
 else if(t>=11&&t<13.6){shot='confident';p=at(.16,1.80,-1.42);q=at(.51,1.53,0);fov=28;}
 else if(t>=13.6&&t<17.4){shot='handoff';p=at(-.07,1.79,-2.06);q=at(0,1.38,-.025);fov=33;}
 else if(t>=17.4&&t<21.65){shot='too-hot';p=at(.14,1.80,-1.42);q=at(.47,1.49,0);fov=31;}
 else if(t>=21.65&&t<24.35){shot='told-you';p=at(.50,1.80,-1.08);q=at(-.55,1.58,0);fov=26;}
 else if(t>=24.35&&t<27.2){shot='teasing';p=at(.12,1.79,-1.44);q=at(.50,1.53,0);fov=28;}
 else if(t>=27.2&&t<29.55){shot='smirk';p=at(.52,1.78,-1.10);q=at(-.55,1.58,0);fov=27;}
 else if(t>=29.55&&t<35.55){shot='lets-go';p=at(-.11,1.84,-2.40);q=at(0,1.38,.05);fov=35;}
 else if(t>=35.55){shot='departure';const u=ramp(t,35.55,42),startP=at(-1.50,1.88,-1.55),startQ=at(.0,1.22,.30);
  p=mix(startP,[SHOP_DOOR[0]-2.7,1.90,SHOP_DOOR[2]-2.8],u);q=mix(startQ,[SHOP_DOOR[0],1.28,SHOP_DOOR[2]],u);fov=39;}
 p[0]+=.013*Math.sin(t*.36);return{shot,camera:{position:p,target:q,fov,focusDistance:Math.hypot(...sub(p,q)),aperture:.018}};
}
function faceLayers(actor,t){
 const mike=actor.id==='mike',layers=[{weight:1,actions:{smileLeft:.12,smileRight:.16,browTiltLeft:.47,browTiltRight:.50}}];
 const cue=(amount,actions)=>layers.push({weight:clamp(amount),actions});
 if(mike){
  cue(window(t,.8,1.5,3.7,4.5),{browLeft:.34,browRight:.29,smileLeft:.27,smileRight:.20});
  cue(window(t,7.4,8.2,10.2,11),{browLeft:.25,browRight:.12});
  cue(window(t,18.6,19.2,20.4,21.2),{browLeft:.48,browRight:.37});
  cue(window(t,20.0,20.35,24.25,24.8),{smileLeft:.95,smileRight:.92,cheekLeft:.72,cheekRight:.66,squint:.42,browLeft:.18,browRight:.12});
  cue(window(t,26.8,27.6,28.8,29.6),{smileLeft:.65,smileRight:.36,browLeft:.24,cheekLeft:.32});
  cue(window(t,31.8,32.6,34.4,35.1),{smileLeft:.30,smileRight:.40,cheekRight:.25});
 }else{
  cue(window(t,0,1.1,6.9,7.7),{squint:.19,browLeft:.09,browRight:.09});
  cue(window(t,10.7,11.4,12.8,13.5),{browLeft:.55,smileLeft:.15,smileRight:.42});
  cue(window(t,15.4,16.1,16.9,17.4),{smileLeft:.29,smileRight:.32,cheekLeft:.22,cheekRight:.28});
  cue(window(t,18.62,18.86,20.15,20.9),{browLeft:1,browRight:1,cheekLeft:.08,cheekRight:.08});
  cue(window(t,20.0,20.25,21.0,21.6),{squint:.46,browLeft:.72,browRight:.77});
  cue(window(t,24.1,24.8,26.5,27.2),{browRight:.47,smileRight:.58,cheekRight:.26});
  cue(window(t,29.3,30.1,31.4,32),{browLeft:.26,browRight:.19});
  cue(window(t,35.0,35.8,37.1,38.0),{smileLeft:.30,smileRight:.57,cheekLeft:.23,cheekRight:.37});
 }
 const listening=mike?pulse(t,5.7,.70,.12)+pulse(t,30.7,.80,.17):pulse(t,2.4,.70,.14)+pulse(t,28.0,.8,.20);
 cue(listening,{browLeft:.40,browRight:.35});return layers;
}
function bodyPose(actor,t){
 const base=sampleWalker({...actor,speed:0},0),h=actor.heightScale;
 if(t>=DEPART_START){
  const target=doorTarget(actor),dx=target[0]-actor.root[0],dz=target[2]-actor.root[2],distance=Math.hypot(dx,dz),duration=DEPART_END-DEPART_START;
  const heading=-Math.atan2(dz,dx),elapsed=Math.min(duration,t-DEPART_START),speed=distance/duration;
  return sampleWalker({...actor,root:actor.root,heading,speed},elapsed);
 }
 const heading=actor.heading+deltaAngle(actor.heading,-Math.PI/2)*ramp(t,37,37.65);
 const travel=Math.max(0,t-38)*.46,root=add(actor.root,[0,0,travel]);
 const now=sampleWalker({...actor,root,heading,speed:0},0),joints=Object.fromEntries(Object.entries(now.joints).map(([key,p])=>[key,[...p]]));
 const feet=[];
 for(const [side,name] of [[-1,'left'],[1,'right']]){
  let foot=[...base.feet.find(f=>f.id===actor.id+':'+name).position],grounded=true,yaw=actor.heading+side*.035;
  for(let k=0;k<4;k++){
   const start=37.8+(side<0?0:.52)+k*1.04,end=start+.43;
   const destination=[actor.root[0]-side*.13*h,GROUND,actor.root[2]+.36+(side<0?0:.24)+k*.48];
   if(t>=end){foot=destination;yaw=-Math.PI/2+side*.035;continue;}
   if(t>start){const u=(t-start)/(end-start);foot=mix(foot,destination,ease(u));foot[1]+=.085*h*Math.sin(Math.PI*u);grounded=false;yaw=actor.heading+deltaAngle(actor.heading,-Math.PI/2)*ease(u)+side*.035;}
   break;
  }
  const hip=joints[name+'Hip'],ankle=add(foot,[0,.105*h,0]),pole=rotate([0,heading,0],[1,0,0]);
  const leg=solveTwoBone(hip,ankle,.425*h,.42*h,pole);
  joints[name+'Knee']=[...leg.joint];joints[name+'Ankle']=[...leg.end];joints[name+'Foot']=foot;
  feet.push({id:actor.id+':'+name,position:foot,grounded,yaw});
 }
 const walking=Math.max(0,t-37.8),bob=t<37.8?0:.007*Math.sin(walking*Math.PI/.52);
 const breathing=.0035*Math.sin(t*(actor.id==='mike'?1.52:1.39)+(actor.id==='mike'?0:1.7));
 const lean=actor.id==='mike'?.050*window(t,6.8,7.8,15.7,16.6):.043*window(t,13.0,14.1,16.0,16.8);
 const offset=[Math.cos(heading)*lean,breathing+bob,-Math.sin(heading)*lean];
 for(const key of ['chest','neck','head','leftShoulder','rightShoulder'])joints[key]=add(joints[key],offset);
 return{...now,joints,feet,heading,footPitch:{left:0,right:0}};
}
export function createTeaPerformance({plan=createTeaPerformancePlan()}={}){
 plan=nativeSpeechPlan(plan.speakers,plan.turns);
 const {spec,sourceCount,movers}=createPerformanceStage();spec.camera=performanceCamera(0).camera;
 const scene=new Scene(spec),actors=cast.map(actor=>({...actor,bindings:performanceBindings(actor),face:new ExpressiveFaceRig(scene,actor.id,WINTER_FACE_IDENTITIES[actor.id]),motor:new NativeSpeechMotor(plan,actor.id),state:createVocalMotorFrame(plan.speakers.find(s=>s.id===actor.id).tractLengthM)}));
 const cupRest=at(-.20,TABLE+.045,-.16),potRest=at(-.25,TABLE+.080,.17),spoutLocal=[.174,.071,0],spoutBase=[.060,.008,0];
 let initialized=false,observation,previousTime=0;
 const perform=(t,dt)=>{
  const prepared=actors.map(actor=>{
   const pose=bodyPose(actor,t),mike=actor.id==='mike',motor=actor.motor.sample(t,actor.state);
   const lookDown=mike?window(t,6.6,7.4,10.9,11.7):window(t,13.1,14.0,20.8,21.5);
   const nod=mike?pulse(t,5.65,.68,-.06)+pulse(t,30.6,.75,-.08):pulse(t,4.9,.65,-.07)+pulse(t,16.1,.55,-.055);
   const recoil=mike?0:window(t,18.68,18.92,20.05,20.70),laugh=mike?window(t,19.95,20.25,24.25,24.8):0,shopLook=window(t,29.75,30.6,31.4,32.1);
   const routeHeading=t>=DEPART_START?pose.heading:-Math.PI/2,turnToShop=deltaAngle(pose.heading,routeHeading)*shopLook*.56;
   const laughShake=laugh*Math.sin(t*18);
   const rotation=[mike?.055*laughShake:.12*recoil,pose.heading+turnToShop+(mike?.04:-.04)*(1-lookDown),-.24*lookDown+nod+.18*recoil+.055*laughShake];
   const other=actors.find(a=>a.id!==actor.id),otherHead=add(other.root,[0,1.57*other.heightScale,0]);
   let gaze=mix(otherHead,cupRest,lookDown);if(t>=DEPART_START)gaze=[SHOP_DOOR[0],1.35,SHOP_DOOR[2]];
   const layers=faceLayers(actor,t);
   const face=actor.face.step(t,dt,{position:pose.joints.head,rotation,scale:actor.heightScale,gazeTarget:gaze},motor,layers);
   return{actor,pose,motor,rotation,gaze,layers,face};
  });
  const anna=prepared.find(p=>p.actor.id==='anna');
  const sip=window(t,17.3,18.05,18.52,18.98),cupRotation=[0,0,-.32*sip];
  const mouth=anna.face.lowerLipWorld;
  const sipCenter=sub(mouth,rotate(cupRotation,[.035,.044,0]));
  let cupPosition=track(t,[[0,cupRest],[13.65,cupRest],[14.75,at(0,1.44,-.12)],[15.6,at(0,1.44,-.12)],[16.6,at(.34,1.30,-.095)]]);
  cupPosition=mix(cupPosition,sipCenter,sip);
  const retract=window(t,18.82,19.2,20.1,20.6);cupPosition=add(cupPosition,[.03*retract,-.08*retract,-.07*retract]);
  if(t>=36.8){const carrying=local(anna.pose.joints.chest,[0,anna.pose.heading,0],[.29,-.17,.13]);cupPosition=mix(cupPosition,carrying,ramp(t,36.8,37.6));}
  const cupMatrix=compose(cupPosition,cupRotation,[1,1,1]),gripMike=point(cupMatrix,[-.059,.018,0]),gripAnna=point(cupMatrix,[.056,.018,0]);
  const owner=t<13.65?'table':t<14.85?'mike':t<15.6?'both':'anna';
  for(const id of ['tea-cup-body','tea-cup-handle','tea-cup-band'])put(scene,id,cupPosition,cupRotation);
  const fill=ramp(t,7.95,10.05),liquid=point(cupMatrix,[0,-.033+.052*fill,0]);put(scene,'tea-cup-liquid',liquid);
  const pour=window(t,7.45,7.95,10.05,10.50),potRotation=[0,.5*pour,-.43*pour],potPour=sub(at(-.20,1.37,-.16),rotate([0,.5,-.43],spoutLocal));
  const potPosition=track(t,[[0,potRest],[6.98,potRest],[7.62,add(potPour,[0,.035,0])],[7.95,potPour],[10.05,potPour],[10.75,add(potRest,[0,.08,0])],[11.10,potRest]]),potMatrix=compose(potPosition,potRotation,[1,1,1]);
  for(const id of ['tea-pot-body','tea-pot-lid','tea-pot-handle'])put(scene,id,potPosition,potRotation);put(scene,'tea-pot-knob',point(potMatrix,[0,.094,0]),potRotation);
  const spout=point(potMatrix,spoutLocal),start=point(potMatrix,spoutBase),spoutPose=segmentPose(start,spout);put(scene,'tea-pot-spout',spoutPose.position,spoutPose.rotation,[1,spoutPose.length/.135,1]);
  const potGrip=point(potMatrix,[-.126,.016,0]),flow=window(t,7.91,8.12,9.95,10.14),stream=segmentPose(spout,liquid);
  put(scene,'tea-stream',stream.position,stream.rotation,[Math.max(.0001,flow),Math.max(.0001,stream.length*flow),Math.max(.0001,flow)]);
  for(let i=0;i<12;i++){const age=(t*.62+i/12)%1,visible=fill*(1-age)**2,size=(.008+.016*age)*visible;put(scene,'tea-steam-'+i,add(cupPosition,[Math.sin(i*2.399+t*.9)*.015+age*.018,.057+age*.16,Math.cos(i*2.399+t*.63)*.012]),[0,0,0],[Math.max(.0001,size),Math.max(.0001,size*1.45),Math.max(.0001,size)]);}
  const sprayAge=t-TEA_SPIT_EVENT.startS,sprayAlive=sprayAge>=0&&sprayAge<TEA_SPIT_EVENT.durationS,spitOrigin=anna.face.lowerLipWorld;
  // Near field is a dense water/mist plume, not discrete beads. Each soft puff
  // appears with a short phase delay, expands while advecting, and loses vertical
  // speed slowly; only the sparse far field becomes ballistic droplets.
  for(let i=0;i<72;i++){
   const delay=(i/72)*.18+hash01(i+701)*.035,age=sprayAge-delay;
   if(!sprayAlive||age<0||age>.92){put(scene,'tea-mist-'+i,[0,-50,0],[0,0,0],[.0001,.0001,.0001]);continue;}
   const r0=hash01(i+1),r1=hash01(i+101),r2=hash01(i+211),r3=hash01(i+307);
   const localVelocity=[.48+r0*1.28,(r1-.50)*.58,(r2-.5)*1.06],velocity=rotate(anna.rotation,localVelocity);
   const drag=(1-Math.exp(-2.7*age))/2.7,p=[spitOrigin[0]+velocity[0]*drag,spitOrigin[1]+velocity[1]*drag-.22*age*age,spitOrigin[2]+velocity[2]*drag];
   const grow=.040+r3*.040+age*(.055+r0*.035),fade=1-clamp((age-.64)/.28);
   put(scene,'tea-mist-'+i,p,[0,0,0],[Math.max(.0001,grow*1.85*fade),Math.max(.0001,grow*.82*fade),Math.max(.0001,grow*1.18*fade)]);
  }
  for(let i=0;i<36;i++){
   const delay=.055+hash01(i+901)*.22,age=sprayAge-delay;
   if(!sprayAlive||age<0||age>1.08){put(scene,'tea-droplet-'+i,[0,-50,0],[0,0,0],[.0001,.0001,.0001]);continue;}
   const r0=hash01(i+31),r1=hash01(i+131),r2=hash01(i+231),r3=hash01(i+331);
   const velocity=rotate(anna.rotation,[.85+r0*1.85,(r1-.30)*1.15,(r2-.5)*2.05]);
   const drag=(1-Math.exp(-1.8*age))/1.8,p=[spitOrigin[0]+velocity[0]*drag,spitOrigin[1]+velocity[1]*drag-2.75*age*age,spitOrigin[2]+velocity[2]*drag];
   const size=(.0028+r3*.0055)*(1-clamp((age-.82)/.26));
   put(scene,'tea-droplet-'+i,p,[0,0,0],[Math.max(.0001,size*1.55),Math.max(.0001,size),Math.max(.0001,size)]);
  }
  const results=[];
  for(const item of prepared){
   const {actor,pose,motor,rotation,gaze,layers}=item,mike=actor.id==='mike',h=actor.heightScale,joints=pose.joints;
   let left=[...joints.leftHand],right=[...joints.rightHand],leftGrip=null,rightGrip=null;
   if(mike){
    left=mix(left,at(-.36,1.25,-.26),window(t,.55,1.43,3.3,4.2));
    const holding=window(t,6.20,6.98,11.10,11.80);right=mix(right,potGrip,holding);if(holding>.999)rightGrip='teapot';
    const cupHold=window(t,12.9,13.65,15.6,16.25);left=mix(left,gripMike,cupHold);if(cupHold>.999)leftGrip='cup';
    const laugh=window(t,20.0,20.3,24.1,24.7);
    left=mix(left,local(joints.chest,[0,pose.heading,0],[.19,-.16,-.12]),laugh);
    right=mix(right,local(joints.chest,[0,pose.heading,0],[.18,-.17,.13]),laugh);
    right=mix(right,local(joints.chest,[0,pose.heading,0],[.22,-.09,.24]),window(t,27.0,27.6,28.3,29.1));
   }else{
    const rub=window(t,.0,1.1,6.2,7.1),beat=Math.sin(t*14)*.012*rub;
    left=mix(left,at(.41,1.31+beat,-.01),rub);right=mix(right,at(.38,1.32-beat,-.045),rub);
    left=mix(left,at(.25,1.43,.02),window(t,10.75,11.3,12.4,13));
    const receive=ramp(t,13.9,14.85);right=mix(right,gripAnna,receive);if(receive>.999)rightGrip='cup';
    const support=window(t,15.65,16.6,18.65,19.05);left=mix(left,point(cupMatrix,[.016,-.012,.048]),support);
    left=mix(left,local(joints.chest,[0,pose.heading,0],[.34,.12,-.34]),window(t,18.78,19.03,20.18,20.72));
    left=mix(left,local(joints.chest,[0,pose.heading,0],[.28,.07,-.12]),window(t,24.2,24.9,26.0,26.8));
    left=mix(left,add(joints.leftShoulder,[.025,.06,.45]),window(t,29.6,30.2,31.2,31.9));
   }
   for(const [side,target] of [['left',left],['right',right]]){
    const pole=rotate([0,pose.heading,0],[-.18,-.38,side==='left'?-.65:.65]),arm=solveTwoBone(joints[side+'Shoulder'],target,.295*h,.270*h,pole);
    joints[side+'Elbow']=[...arm.joint];joints[side+'Hand']=[...arm.end];
   }
   for(const p of bindHumanoid(pose,actor.bindings))put(scene,p.entity,p.position,p.rotation,p.scale);
   const matrix=compose(joints.head,rotation,[h,h,h]);
   for(const binding of actor.bindings.filter(b=>b.joint==='head'))put(scene,binding.entity,point(matrix,binding.offset??[0,0,0]),rotation,(binding.scale??[1,1,1]).map(v=>v*h));
   const face=item.face;
   results.push({id:actor.id,position:pose.position,heading:pose.heading,heightScale:h,feet:pose.feet,joints,face,motor:{timeS:motor.timeS,phone:motor.phone,active:motor.active,pitchHz:motor.pitchHz,lungPressurePa:motor.lungPressurePa,lipWidthM:motor.lipWidthM,lipGapM:motor.lipGapM,terminalAreaCm2:motor.oralAreaCm2[43]},grips:{left:leftGrip,right:rightGrip}});
  }
  const camera=performanceCamera(t);scene.setCamera(camera.camera);
  observation={timeS:t,shot:camera.shot,actors:results,cup:{position:cupPosition,rotation:cupRotation,owner,fill,sip,gripPoints:{mike:gripMike,anna:gripAnna}},teapot:{position:potPosition,gripPoint:potGrip,spout,flow},sourceCityEntities:sourceCount,activeTurns:plan.turns.filter(turn=>t>=turn.startS&&t<turn.startS+turn.segments.reduce((sum,s)=>sum+s.durationS,0)).map(({id,speakerId,text})=>({id,speakerId,text})),speechBackend:'native-typescript',acting:'authored-IK',sprayActive:sprayAlive,shopDoor:SHOP_DOOR,renderMovers:movers.length};
 };
 scene.usePlugin({id:'tea.performance.native',renderMovers:movers,systems:[{id:'tea.performance.native.step',run:(_host,frame)=>perform(frame.at,frame.dt)}],modules:[{id:'tea:performance:native',phase:'simulate',rateHz:60,reads:[],writes:['entities'],after:['engine:vehicle-visuals'],context:'none',run:(_context,frame)=>[{type:'system',action:'tea.performance.native.step',deltaSeconds:frame.deltaSeconds}]}]});
 return{scene,duration:TEA_PERFORMANCE_DURATION,
  step(t,dt){
   if(!Number.isFinite(t)||t<0||t>TEA_PERFORMANCE_DURATION+1e-8||!Number.isFinite(dt))throw new RangeError('Invalid performance time');
   if(!initialized){if(t!==0||dt!==0)throw new RangeError('Initialize with step(0,0)');perform(0,0);initialized=true;return;}
   if(t===previousTime&&dt===0)return;
   if(Math.abs(dt-1/60)>1e-9||Math.abs(t-previousTime-dt)>1e-7)throw new RangeError('Performance requires sequential fixed 60 Hz steps');
   scene.step(dt);previousTime=t;
  },inspect:()=>observation,
 };
}
