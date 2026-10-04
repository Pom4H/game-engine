import {Scene} from '../../dist/scene/scene.js';
import {sampleWalker,bindHumanoid,solveTwoBone} from '../../dist/animation/locomotion.js';
import {conversationFaceEntities,conversationHeadMesh,ConversationFaceRig} from '../../dist/animation/conversation-face.js';
import {planVtlDialogue} from '../../dist/audio/vtl-external.js';
import {compose,V3} from '../../dist/math.js';
import {makeCity} from '../promo/city.mjs';
import {makePedestrian,pedestrianAnimation} from '../promo/actors.mjs';

// This is a performance authored in metres and seconds for the existing winter
// city. The engine owns mesh projection, rig dynamics, IK and the 60 Hz clock.
// One VTL motor score supplies both the soundtrack and the visible articulation.
export const TEA_DURATION=15.5;
const CENTER=[-19.95,0,5.25],GROUND=.166,TABLE=1.06;
const clamp=(x,a=0,b=1)=>Math.max(a,Math.min(b,x));
const ease=x=>{const u=clamp(x);return clamp(u*u*u*(u*(u*6-15)+10));};
const ramp=(t,a,b)=>ease((t-a)/(b-a));
const window=(t,a,b,c,d)=>ramp(t,a,b)*(1-ramp(t,c,d));
const mix=(a,b,u)=>a.map((v,i)=>v+(b[i]-v)*u);
const add=(a,b)=>a.map((v,i)=>v+b[i]);
const sub=(a,b)=>a.map((v,i)=>v-b[i]);
const point=(m,p)=>[0,1,2].map(i=>m[i]*p[0]+m[i+4]*p[1]+m[i+8]*p[2]+m[i+12]);
const local=(p,r,v)=>point(compose(p,r,[1,1,1]),v);
const at=(x,y,z)=>[CENTER[0]+x,y,CENTER[2]+z];
function track(t,keys){
 if(t<=keys[0][0])return [...keys[0][1]];
 for(let i=1;i<keys.length;i++)if(t<=keys[i][0])return mix(keys[i-1][1],keys[i][1],ramp(t,keys[i-1][0],keys[i][0]));
 return [...keys.at(-1)[1]];
}
function pulse(t,start,length,amount){const u=(t-start)/length;return u<=0||u>=1?0:amount*Math.sin(Math.PI*u)**2;}
function place(scene,id,position,rotation=[0,0,0],scale){
 const e=scene.entities.get(id);if(!e)throw new Error('Missing performance entity '+id);
 e.position.splice(0,3,...position);e.rotation.splice(0,3,...rotation);if(scale)e.scale.splice(0,3,...scale);
}
function lathe(profile,segments=48){
 const positions=[],normals=[],indices=[];
 for(let j=0;j<profile.length;j++){
  const [r,y]=profile[j],before=profile[Math.max(0,j-1)],after=profile[Math.min(profile.length-1,j+1)],dr=after[0]-before[0],dy=after[1]-before[1],len=Math.hypot(dr,dy)||1;
  for(let k=0;k<=segments;k++){const a=k/segments*Math.PI*2,c=Math.cos(a),s=Math.sin(a);positions.push(r*c,y,r*s);normals.push(dy/len*c,-dr/len,dy/len*s);}
 }
 for(let j=0;j<profile.length-1;j++)for(let k=0;k<segments;k++){const a=j*(segments+1)+k,b=a+segments+1;indices.push(a,b,a+1,a+1,b,b+1);}
 return{kind:'triangle-mesh',positions,normals,indices};
}
function tube(points,radius,segments=10){
 const positions=[],normals=[],indices=[];
 for(let j=0;j<points.length;j++){
  const tangent=V3.normalize(sub(points[Math.min(points.length-1,j+1)],points[Math.max(0,j-1)])),u=V3.normalize(V3.cross(tangent,[0,0,1])),v=V3.cross(tangent,u);
  for(let k=0;k<=segments;k++){const a=k/segments*Math.PI*2,n=add(V3.scale(u,Math.cos(a)),V3.scale(v,Math.sin(a)));positions.push(...add(points[j],V3.scale(n,radius)));normals.push(...n);}
 }
 for(let j=0;j<points.length-1;j++)for(let k=0;k<segments;k++){const a=j*(segments+1)+k,b=a+segments+1;indices.push(a,a+1,b,a+1,b+1,b);}
 return{kind:'triangle-mesh',positions,normals,indices};
}
const loop=(x,rx,ry)=>Array.from({length:41},(_,i)=>{const a=i/40*Math.PI*2;return[x+Math.cos(a)*rx,Math.sin(a)*ry,0];});
function props(){
 const ceramic={kind:'default',color:[.76,.73,.63,1],roughness:.24,clearcoat:.45},pot={kind:'default',color:[.12,.24,.21,1],roughness:.28,clearcoat:.4};
 return[
  {id:'tea-table-top',position:at(0,TABLE-.026,0),mesh:{kind:'cylinder',radius:.39,height:.052,segments:64},material:{color:[.24,.125,.060,1],roughness:.66}},
  {id:'tea-table-edge',position:at(0,TABLE-.043,0),mesh:{kind:'cylinder',radius:.394,height:.025,segments:64},material:{color:[.085,.10,.095,1],roughness:.52,metalness:.45}},
  {id:'tea-table-stem',position:at(0,(TABLE+GROUND)/2,0),mesh:{kind:'cylinder',radius:.043,height:TABLE-GROUND-.05,segments:24},material:{color:[.09,.10,.09,1],roughness:.6,metalness:.4}},
  ...[-1,1].map(s=>({id:'tea-table-foot'+s,position:at(0,GROUND+.025,0),rotation:[0,s*Math.PI/4,0],mesh:{kind:'box',size:[.58,.05,.045]},material:{color:[.09,.10,.09,1],roughness:.72}})),
  {id:'tea-cup-body',mesh:lathe([[.001,-.043],[.027,-.043],[.032,-.038],[.039,.034],[.038,.044],[.0335,.044],[.032,.034],[.025,-.036],[.001,-.036]]),material:ceramic},
  {id:'tea-cup-handle',mesh:tube(loop(-.040,.027,.030),.004),material:ceramic},
  {id:'tea-cup-band',mesh:lathe([[.037,.018],[.038,.025]]),material:{color:[.35,.14,.065,1],roughness:.36}},
  {id:'tea-cup-liquid',mesh:{kind:'cylinder',radius:.029,height:.0015,segments:48},material:{color:[.21,.076,.018,1],roughness:.12,clearcoat:.9}},
  {id:'tea-pot-body',mesh:lathe([[.001,-.080],[.045,-.080],[.068,-.064],[.079,-.021],[.067,.047],[.047,.062],[.001,.062]]),material:pot},
  {id:'tea-pot-lid',mesh:lathe([[.001,.065],[.049,.065],[.046,.076],[.020,.084],[.001,.084]]),material:pot},
  {id:'tea-pot-knob',position:[0,.094,0],mesh:{kind:'sphere',radius:.014,segments:16},material:{color:[.10,.12,.105,1],roughness:.6}},
  {id:'tea-pot-handle',mesh:tube(loop(-.084,.044,.052),.008),material:pot},
  {id:'tea-pot-spout',mesh:tube([[.050,.005,0],[.088,.008,0],[.112,.027,0],[.141,.062,0],[.174,.071,0]],.011),material:pot},
  {id:'tea-stream',mesh:{kind:'cylinder',radius:.0026,height:1,segments:10},scale:[.0001,.0001,.0001],material:{color:[.36,.17,.050,1],roughness:.1,clearcoat:1}},
  ...Array.from({length:12},(_,i)=>({id:'tea-steam-'+i,mesh:{kind:'sphere',radius:.5,segments:8},scale:[.0001,.0001,.0001],material:{color:[.66,.70,.72,.07],roughness:1}})),
 ];
}
function selectCity(e){
 if(['ground','road','walk-1','curb-1','snow-verge-1'].includes(e.id)||e.id.startsWith('b1-2-'))return true;
 const p=e.position??[0,0,0];
 return p[0]>-26&&p[0]<-13&&p[2]>3.2&&p[2]<8&&/^(fence|walk-edge|walk-grain|plough-|bench)/.test(e.id);
}
function conversationBindings(c){
 return pedestrianAnimation({...c,speed:0}).bindings.map(binding=>{
  const key=binding.entity.slice(c.id.length+1),b={...binding,offset:[...(binding.offset??[0,0,0])],scale:[...(binding.scale??[1,1,1])]};
  // The street walker was bundled up to the nose. Open the collar and lift the
  // knitted brim for this speaking performance; the same garments remain.
  if(key==='hat'){b.offset[1]=.145;b.scale[1]=.15;}
  if(key==='hatBand'){b.offset[1]=.086;b.scale[1]=.037;}
  if(key==='hatPom')b.offset[1]=.230;
  if(key==='snowHat')b.offset[1]=.215;
  if(key==='nose'){b.offset=[.093,-.004,0];b.scale=[.031,.039,.027];}
  if(key==='collar'){b.offset[1]=-.019;b.scale[1]=.086;}
  if(key==='scarf'){b.offset[1]=-.018;b.scale[1]=.087;}
  if(key==='hood'){b.offset[0]-=.025;b.offset[1]-=.030;}
  return b;
 });
}
function cameraAt(t){
 // Keep the camera on the street side of the conversation axis. The closer
 // angles show the speaker's eyes and lips while the master shows hand contact.
 let shot='two-shot',position=at(-.04,1.70,-2.48),target=at(0,1.28,.015),fov=35;
 if(t>=1.05&&t<2.85){shot='mike-question';position=at(.54,1.76,-1.17);target=at(-.54,1.58,0);fov=24;}
 else if(t>=2.85&&t<4.15){shot='anna-answer';position=at(-.60,1.73,-1.20);target=at(.53,1.54,-.01);fov=24;}
 else if(t>=4.15&&t<9.35){shot='pouring';position=at(-.04,1.72,-2.10);target=at(-.04,1.29,-.015);fov=34;}
 else if(t>=11.05&&t<12.65){shot='anna-thanks';position=at(-.60,1.70,-1.13);target=at(.47,1.51,-.02);fov=26;}
 else if(t>=12.65){shot='shared-smile';position=at(-.06,1.76,-2.07);target=at(.02,1.35,-.01);fov=34;}
 const drift=.016*Math.sin(t*.31);position[0]+=drift;
 return{shot,camera:{position,target,fov,focusDistance:Math.hypot(...sub(target,position)),aperture:.025}};
}

export function createTeaScene({plan}){
 plan=planVtlDialogue(plan.speakers,plan.turns);
 if(!['mike','anna'].every(id=>plan.speakers.some(s=>s.id===id)))throw new TypeError('Tea cast requires Mike and Anna voice identities');
 const cast=[
  {id:'mike',root:at(-.59,GROUND,0),heading:.27,heightScale:1,palette:{skin:[.51,.34,.25,1]}},
  {id:'anna',root:at(.59,GROUND,.015),heading:Math.PI-.27,heightScale:.97,palette:{skin:[.62,.43,.33,1],coat:[.37,.18,.14,1],scarf:[.49,.37,.22,1],hat:[.21,.17,.14,1],pants:[.15,.18,.205,1]}},
 ];
 const {spec,sourceCount}=makeCity('street',{select:selectCity});
 spec.animation={walkers:cast.map(c=>pedestrianAnimation({...c,speed:0})),vehicles:[]};
 delete spec.surfaceContacts;
 spec.environment={...spec.environment,temperatureC:-4,snowfall:'none',sunlight:.58,clock:{startHour:15.8,hoursPerSecond:0},wind:[.35,0,.08]};
 spec.rendering={...spec.rendering,sunColor:[.91,.92,1],sunIntensity:1.6,skyColor:[.30,.38,.47],fogDensity:.0015,exposure:1.04,shadowExtent:18};
 const propSpecs=props(),faceSpecs=cast.flatMap(c=>conversationFaceEntities({id:c.id,skin:c.palette.skin,iris:c.id==='mike'?[.13,.11,.075,1]:[.17,.23,.20,1]}));
 spec.entities.push(...cast.flatMap(c=>makePedestrian({...c,speed:0}).map(e=>e.id===c.id+'-head'?{...e,mesh:conversationHeadMesh()}:e)),...faceSpecs,...propSpecs,
  {id:'tea-sky-fill',position:at(-1.2,3.1,-1.7),light:{kind:'point',color:[.80,.87,1],intensity:2.2,range:7}},
  {id:'tea-key-light',position:at(1.4,3.4,-1.4),light:{kind:'point',color:[1,.90,.78],intensity:3.6,range:8}},
  {id:'tea-shop-light',position:at(0,2.6,2.7),light:{kind:'point',color:[1,.67,.37],intensity:1.9,range:5}},
 );
 // Zero-strength city lamps do not contribute to this daylight lighting setup.
 for(const e of spec.entities)if(e.light?.intensity===0)delete e.light;
 spec.camera=cameraAt(0).camera;
 const scene=new Scene(spec),actors=cast.map(c=>({...c,bindings:conversationBindings(c),faceRig:new ConversationFaceRig(scene,{id:c.id,speakerId:c.id,turns:plan.turns}),headRotation:[0,c.heading,0],diagnostics:null}));
 const movers=[...faceSpecs.map(e=>e.id),...propSpecs.filter(e=>!e.id.startsWith('tea-table')).map(e=>e.id)];
 const cupRest=at(-.20,TABLE+.045,-.16),potRest=at(-.25,TABLE+.080,.17),spoutLocal=[.174,.071,0];
 let time=0,last=-1,shot='two-shot',cupState,potState;
 const cupParts=['tea-cup-body','tea-cup-handle','tea-cup-band'],potParts=['tea-pot-body','tea-pot-lid','tea-pot-handle','tea-pot-spout'];
 function perform(t,dt){
  time=t;
  const sip=ramp(t,12.50,13.25)*(1-ramp(t,13.83,14.50));
  // The held pose aligns the actual tilted rim with Anna's visible inner lips;
  // it is verified against rim triangles, independently of the wrist targets.
  const cupPosition=track(t,[[0,cupRest],[9.12,cupRest],[10.60,at(0,1.44,-.12)],[11.20,at(0,1.44,-.12)],[12.10,at(.34,1.30,-.095)],[12.50,at(.34,1.30,-.095)],[13.25,at(.44406,1.59933,-.01236)],[13.83,at(.44406,1.59933,-.01236)],[14.50,at(.34,1.30,-.095)]]);
  const cupRotation=[0,0,-.32*sip],cupMatrix=compose(cupPosition,cupRotation,[1,1,1]);
  const gripMike=point(cupMatrix,[-.059,.018,0]),gripAnna=point(cupMatrix,[.056,.018,0]);
  const cupOwner=t<9.12?'table':t<10.65?'mike':t<11.20?'both':'anna';
  for(const id of cupParts)place(scene,id,cupPosition,cupRotation);
  const fill=ramp(t,6.07,8.05),liquid=point(cupMatrix,[0,-.033+.052*fill,0]);
  place(scene,'tea-cup-liquid',liquid,[0,0,0]);
  const pour=window(t,5.50,6.07,8.05,8.50),potRotation=[0,.50*pour,-.43*pour];
  const pourOrigin=at(-.20,1.37,-.16),rotatedSpout=local([0,0,0],[0,.50,-.43],spoutLocal),potPour=sub(pourOrigin,rotatedSpout);
  const potPosition=track(t,[[0,potRest],[4.80,potRest],[5.65,add(potPour,[0,.035,0])],[6.07,potPour],[8.05,potPour],[8.65,add(potRest,[0,.09,0])],[9.12,potRest]]),potMatrix=compose(potPosition,potRotation,[1,1,1]);
  for(const id of potParts)place(scene,id,potPosition,potRotation);
  place(scene,'tea-pot-knob',point(potMatrix,[0,.094,0]),potRotation);
  const potGrip=point(potMatrix,[-.126,.016,0]),spout=point(potMatrix,spoutLocal);
  const flow=window(t,5.97,6.15,7.93,8.12),streamBottom=liquid,streamDelta=sub(streamBottom,spout),length=Math.hypot(...streamDelta);
  place(scene,'tea-stream',mix(spout,streamBottom,.5),[Math.atan2(streamDelta[2],streamDelta[1]),0,Math.asin(-streamDelta[0]/Math.max(.001,length))],[Math.max(.0001,flow),Math.max(.0001,length*flow),Math.max(.0001,flow)]);
  // The cup's vapour is a small world-space projection carried with the cup;
  // no screen overlays or post-production gestures are used.
  for(let i=0;i<12;i++){
   const age=((t*.62+i/12)%1),visibility=fill*(1-age)**2,phase=i*2.399;
   const p=add(cupPosition,[Math.sin(phase+t*.9)*.015+age*.018,.057+age*.16,Math.cos(phase+t*.63)*.012]);
   const size=.008+.016*age;
   // The CPU fallback has opaque-only blending; keep steam below one-pixel
   // prominence there as actual tiny wisps, never an opaque smoke column.
   place(scene,'tea-steam-'+i,p,[0,0,0],[size*visibility,size*1.45*visibility,size*visibility].map(v=>Math.max(.0001,v)));
  }
  const actorPoses=[];
  for(const actor of actors){
   const isMike=actor.id==='mike',h=actor.heightScale;
   const base=sampleWalker({...actor,speed:0},t),joints=Object.fromEntries(Object.entries(base.joints).map(([k,p])=>[k,[...p]]));
   const breathing=.0035*Math.sin(t*(isMike?1.52:1.39)+(isMike?0:1.7));
   const lean=isMike?.050*window(t,4.2,5.2,11.35,12.2):.045*window(t,9.4,10.4,11.45,12.3);
   const shift=[Math.cos(actor.heading)*lean,breathing,-Math.sin(actor.heading)*lean];
   for(const key of ['chest','neck','head','leftShoulder','rightShoulder'])joints[key]=add(joints[key],shift);
   // Foot anchors never move. Small torso shifts are resolved back through the
   // same fixed-length limb solver used by the winter pedestrian.
   const restLeft=add(joints.leftHand,[.06*Math.cos(actor.heading),.04,-.06*Math.sin(actor.heading)]),restRight=add(joints.rightHand,[.05*Math.cos(actor.heading),.025,-.05*Math.sin(actor.heading)]);
   let left=restLeft,right=restRight,leftGrip=null,rightGrip=null;
   if(isMike){
    const offer=window(t,.55,1.42,2.3,3.3);
    left=mix(restLeft,at(-.36,1.235,-.27),offer);
    const potHold=window(t,3.90,4.80,9.12,9.75);
    right=mix(restRight,potGrip,potHold);if(potHold>.999)rightGrip='teapot';
    const cupHold=window(t,8.46,9.12,11.20,11.83);
    left=mix(left,gripMike,cupHold);if(cupHold>.999)leftGrip='cup';
   }else{
    const acknowledge=window(t,2.85,3.23,3.65,4.2);
    left=mix(restLeft,at(.30,1.34,.10),acknowledge*.48);
    const receive=ramp(t,9.55,10.65);
    right=mix(restRight,gripAnna,receive);if(receive>.999)rightGrip='cup';
    const support=ramp(t,11.22,12.1);
    left=mix(left,point(cupMatrix,[.016,-.012,.048]),support);if(support>.999)leftGrip='cup-support';
   }
   const targets={left,right};
   for(const side of ['left','right']){
    const shoulder=joints[side+'Shoulder'],pole=local([0,0,0],[0,actor.heading,0],[-.18,-.38,side==='left'?-.65:.65]);
    const arm=solveTwoBone(shoulder,targets[side],.295*h,.270*h,pole);
    joints[side+'Elbow']=[...arm.joint];joints[side+'Hand']=[...arm.end];
   }
   const pose={...base,joints};
   for(const p of bindHumanoid(pose,actor.bindings))place(scene,p.entity,p.position,p.rotation,p.scale);
   const lookDown=isMike?window(t,4.10,4.90,9.03,9.65):window(t,9.5,10.25,14.10,14.75);
   const nod=isMike?pulse(t,10.06,.64,-.050):pulse(t,3.07,.57,-.075)+pulse(t,6.23,.48,-.052)+pulse(t,11.27,.65,-.065);
   const targetRot=[0,actor.heading+(isMike?.045:-.045)*(1-lookDown),-.30*lookDown+nod+.055*sip*(isMike?0:1)];
   const alpha=dt===0?1:1-Math.exp(-dt*12);
   actor.headRotation=mix(actor.headRotation,targetRot,alpha);
   const head=joints.head,headMatrix=compose(head,actor.headRotation,[h,h,h]);
   for(const binding of actor.bindings.filter(b=>b.joint==='head')){
    const position=point(headMatrix,binding.offset??[0,0,0]);
    place(scene,binding.entity,position,actor.headRotation,(binding.scale??[1,1,1]).map(v=>v*h));
   }
   const other=actors.find(a=>a.id!==actor.id),otherHead=add(other.root,[Math.cos(other.heading)*.026*other.heightScale,1.57*other.heightScale,-Math.sin(other.heading)*.026*other.heightScale]);
   const gaze=mix(otherHead,isMike?cupRest:cupPosition,lookDown);
   const smile=isMike?.20+.25*window(t,.9,1.5,2.5,3.7)+.40*ramp(t,11.7,14.9):.20+.40*window(t,2.9,3.4,4.1,4.8)+.34*window(t,10.9,11.9,12.7,13.1)+.61*ramp(t,13.8,14.7);
   const face=actor.faceRig.step(t,dt,{position:head,rotation:actor.headRotation,scale:h,gazeTarget:gaze,smile,browLift:isMike?.34*window(t,1.16,1.60,2.35,2.75):.19*window(t,2.97,3.27,3.62,3.94),browTilt:.12,squint:!isMike?.30*ramp(t,14.0,14.65):.12});
   actor.diagnostics={id:actor.id,heightScale:h,head:[...head],headRotation:[...actor.headRotation],feet:base.feet.map(f=>({id:f.id,position:[...f.position],grounded:f.grounded})),joints,face,grips:{left:leftGrip,right:rightGrip}};
   actorPoses.push(actor.diagnostics);
  }
  cupState={position:cupPosition,rotation:cupRotation,owner:cupOwner,fill,gripPoints:{mike:gripMike,anna:gripAnna}};
  potState={position:potPosition,rotation:potRotation,gripPoint:potGrip,spout,flow};
  const camera=cameraAt(t);shot=camera.shot;scene.setCamera(camera.camera);
 }
 scene.usePlugin({id:'winter.tea-performance',renderMovers:movers,
  systems:[{id:'winter.tea-performance.step',run:(_host,frame)=>perform(frame.at,frame.dt)}],
  modules:[{id:'winter:tea-performance',phase:'simulate',rateHz:60,reads:['animation'],writes:['entities'],after:['engine:vehicle-visuals'],context:'none',run:(_context,frame)=>[{type:'system',action:'winter.tea-performance.step',deltaSeconds:frame.deltaSeconds}]}],
 });
 function step(timeS,dt){
  if(!Number.isFinite(timeS)||!Number.isFinite(dt)||timeS<0||timeS>TEA_DURATION+1e-6||dt<0||dt>1/60+1e-8)throw new RangeError('Tea performance uses a finite 60 Hz timeline');
  if(last<0){if(timeS!==0||dt!==0)throw new RangeError('Initialize tea performance with step(0,0)');perform(0,0);last=0;return;}
  if(dt===0&&timeS===last)return;
  if(Math.abs(timeS-last-dt)>1e-7||dt<=0)throw new RangeError('Tea performance must advance sequentially');
  scene.step(dt);last=timeS;
 }
 const inspect=()=>({timeS:time,shot,source:'tools/promo/city.mjs + tools/promo/actors.mjs',sourceCityEntities:sourceCount,actors:actors.map(a=>a.diagnostics),cup:cupState,teapot:potState,
  activeTurns:plan.turns.filter(turn=>time>=turn.startS&&time<turn.startS+turn.segments.reduce((sum,p)=>sum+p.durationS,0)).map(turn=>({id:turn.id,speakerId:turn.speakerId,text:turn.text})),
  movers:[...scene.renderMoverIds()],rendererSharedScene:true});
 return{scene,duration:TEA_DURATION,step,inspect};
}
