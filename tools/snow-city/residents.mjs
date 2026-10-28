import {emptySnow,combineSnow,snowSphere} from '../../dist/environment/snow-matter.js';
import {sampleWalker,bindHumanoid,solveTwoBone} from '../../dist/animation/locomotion.js';
import {residentMesh} from './resident-mesh.mjs';
import {freezePrimitive} from '../../dist/procedural/mesh.js';
import {hash,clamp,yawPoint} from './math.mjs';

const colors=[[.86,.22,.08,1],[.04,.39,.49,1],[.35,.15,.54,1],[.88,.63,.12,1],[.15,.22,.31,1],[.52,.12,.16,1]];
const snowMaterial={kind:'snow',color:[.84,.9,.98,1],roughness:.91};
const distance=(a,b)=>Math.hypot(a[0]-b[0],a[2]-b[2]);
/** Residents choose feasible work from needs and nearby material/actors. Action
 * duration is a result of movement/work; there is no timeline or repeating cast. */
export class Residents {
 constructor(world){this.world=world;this.actors=new Map();this.balls=new Map();this.visuals=new Map();this.sequence=0;this.events=[];this.pendingPackets=[];}
 populate(cx,cz,centers=[[cx*96,0,cz*96]]){
  const residency=centers.map(p=>Math.round(p[0]/96)+':'+Math.round(p[2]/96)).join(';');
  if(this.residency===residency&&this.world.scene.time-(this.residencyAt??0)<1)return;this.residency=residency;this.residencyAt=this.world.scene.time;
  const districts=new Map();
  for(let dz=-1;dz<=1;dz++)for(let dx=-1;dx<=1;dx++)districts.set((cx+dx)+':'+(cz+dz),[cx+dx,cz+dz]);
  // The camera's cars can separate. Every active street still has residents.
  for(const p of centers){const x=Math.round(p[0]/96),z=Math.round(p[2]/96);for(const [dx,dz] of [[0,0],[1,0],[-1,0],[0,1],[0,-1]])districts.set((x+dx)+':'+(z+dz),[x+dx,z+dz]);}
  for(const [x,z] of districts.values())for(let n=0;n<6;n++){
   const id=`resident:${x}:${z}:${n}`;if(this.actors.has(id))continue;const seed=hash(x*7+n,z,193),side=n%2?-1:1;
   const p=n<4?[x*96+(n<2?side*13:20+n*6),.2,z*96+(n<2?24+n*9:side*13)]:[x*96+21+(n-4)*10,.2,z*96+26];
   this.actors.set(id,{id,seed,p,v:[0,0,0],yaw:0,phase:seed%12,mode:'walk',play:.35+(seed%60)/100,work:n===3?1:(seed%13)/30,mischief:(seed%100)/100,fatigue:0,packet:emptySnow(),goal:null,cooldown:0,steps:0,decisions:0});
  }
  // Residency is spatial. Moving out of a district never restarts a timed show.
  for(const [id,a]of this.actors)if(!districts.has(Math.round(a.p[0]/96)+':'+Math.round(a.p[2]/96))&&!centers.some(p=>Math.abs(a.p[0]-p[0])<180&&Math.abs(a.p[2]-p[2])<180)){if(a.packet.massKg)this.spread(a.p,a.packet);this.actors.delete(id);}
 }
 spread(p,packet){if(packet.massKg<1e-8)return packet;const radius=Math.max(this.world.snow.cellM,Math.min(1.5,Math.cbrt(packet.volumeM3*3/(Math.PI*.65)))),rest=this.world.snow.pour(p,packet,radius);if(rest.massKg>1e-7)this.pendingPackets.push({p:[...p],packet:rest});return rest;}
 candidates(a){
  const world=this.world,snow=world.snow,friend=[...this.actors.values()].filter(b=>b!==a&&distance(a.p,b.p)<14).sort((x,y)=>distance(a.p,x.p)-distance(a.p,y.p))[0];
  const ball=[...this.balls.values()].filter(b=>b.settled&&distance(a.p,b.p)<14).sort((x,y)=>y.p[1]-x.p[1])[0];
  const local=snow.sample(a.p[0],a.p[2]),hand=a.packet.massKg,goals=[];
  const ix=Math.round(a.p[0]/96),iz=Math.round(a.p[2]/96),q=hash(a.seed,a.decisions,19)%4;
  goals.push({kind:'walk',score:.30+a.fatigue*.1,p:[ix*96+[-13,13,36,-36][q],0,iz*96+[36,-36,13,-13][q]]});
  if(local.depthM>.05&&hand<2.5)goals.push({kind:'gather',score:a.play*.85+a.work*.35,p:[a.p[0]+.4,0,a.p[2]+.3]});
  if(hand>.3&&friend&&a.cooldown<=0)goals.push({kind:'throw',score:a.play*(.6+a.mischief),p:friend.p,other:friend.id});
  if(ball&&ball.packet.massKg<35&&a.work>.35&&local.depthM>.15)goals.push({kind:'roll',score:.8+a.work*.5,p:ball.p,other:ball.id});
  if(hand>1.2&&(!ball||ball.p[1]+ball.radius<a.p[1]+1.4))goals.push({kind:'build',score:.65+a.work*.6,p:ball?[...ball.p]:[ix*96+27,0,iz*96+28],other:ball?.id});
  if(ball?.p[1]>.8&&a.mischief>.66&&a.cooldown<=0)goals.push({kind:'push',score:.5+a.mischief,p:ball.p,other:ball.id});
  if(a.work>.8&&local.depthM>.12)goals.push({kind:'shovel',score:.7+local.depthM,p:[ix*96+13,0,a.p[2]+1.5]});
  if(a.fatigue>.55&&local.depthM>.25)goals.push({kind:'angel',score:a.fatigue*1.4,p:[ix*96+24,0,iz*96+32]});
  return goals.sort((x,y)=>y.score/(1+distance(a.p,y.p)*.025)-x.score/(1+distance(a.p,x.p)*.025));
 }
 decide(a){a.goal=this.candidates(a)[0];a.decisions++;a.workDone=0;}
 step(dt){
  const world=this.world,time=world.scene.time;this.events=[];const pending=this.pendingPackets.splice(0,4);for(const transfer of pending)this.spread(transfer.p,transfer.packet);
  for(const a of this.actors.values()){
   a.cooldown=Math.max(0,a.cooldown-dt);a.play=Math.min(1,a.play+dt*.012);if(!a.goal)this.decide(a);
   const goal=a.goal,d=distance(a.p,goal.p),oldPhase=a.phase,desired=d>1.1?1.15/(1+a.packet.massKg*.08):0;
   let vx=(goal.p[0]-a.p[0])/Math.max(.1,d)*desired,vz=(goal.p[2]-a.p[2])/Math.max(.1,d)*desired;
   // Personal space and predicted traffic are constraints on locomotion.
   for(const b of this.actors.values()){if(b===a||Math.abs(a.p[0]-b.p[0])>=1||Math.abs(a.p[2]-b.p[2])>=1)continue;const r=distance(a.p,b.p);if(r>.01&&r<1){vx+=(a.p[0]-b.p[0])*(1-r)*1.6/r;vz+=(a.p[2]-b.p[2])*(1-r)*1.6/r;}}
   for(const car of world.cars){const b=car.rig.body,dx=a.p[0]-b.position[0]-b.velocity[0]*.6,dz=a.p[2]-b.position[2]-b.velocity[2]*.6,r=Math.hypot(dx,dz);if(r<7){vx+=dx/Math.max(.1,r)*(7-r);vz+=dz/Math.max(.1,r)*(7-r);}}
   const speed=Math.hypot(vx,vz);if(speed>2){vx*=2/speed;vz*=2/speed;}a.v[0]+=(vx-a.v[0])*Math.min(1,dt*7);a.v[2]+=(vz-a.v[2])*Math.min(1,dt*7);
   const next=[a.p[0]+a.v[0]*dt,0,a.p[2]+a.v[2]*dt];
   if(world.walkable(next)){a.p[0]=next[0];a.p[2]=next[2];}else{a.goal=null;a.v[0]*=-.5;a.v[2]*=-.5;}
   const travel=Math.hypot(a.v[0],a.v[2]);a.phase+=travel*dt*5;a.fatigue=clamp(a.fatigue+travel*dt*.004,0,1);if(travel>.1)a.yaw=Math.atan2(-a.v[2],a.v[0]);a.p[1]=world.snow.sample(a.p[0],a.p[2]).height-.08;
   a.mode=d>1.1?'walk':goal.kind;
   if(Math.floor(a.phase/Math.PI)!==Math.floor(oldPhase/Math.PI)&&travel>.1){world.snow.contact({position:a.p,radiusM:.15,normalLoadN:720,slipSpeedMps:travel,durationSeconds:.1,temperatureC:0});this.events.push({type:'foot',time,point:[...a.p],energy:12,id:++this.sequence});}
   if(d>1.1)continue;a.workDone+=dt;
   if(goal.kind==='gather'){
    const at=[a.p[0]+Math.cos(a.yaw)*.5,world.snow.sample(a.p[0]+.5,a.p[2]).height-.08,a.p[2]-.2];
    const packet=world.snow.cut(snowSphere(at,.22),dt*1.5);a.packet=combineSnow(a.packet,packet);a.packet.bond=Math.min(1,a.packet.bond+dt*.2);if(a.packet.massKg>=2.5||packet.massKg<.001){if(packet.massKg<.001)a.play*=.55;a.goal=null;}
   }else if(goal.kind==='throw'){
    const other=this.actors.get(goal.other);if(other&&a.workDone>.45&&a.packet.massKg>.1){const p=[a.p[0],a.p[1]+1.35,a.p[2]],flight=Math.max(.4,distance(p,other.p)/8);this.makeBall(a.packet,p,[(other.p[0]-p[0])/flight,4.905*flight,(other.p[2]-p[2])/flight]);a.packet=emptySnow();a.play*=.65;a.cooldown=2.5;a.goal=null;}
   }else if(goal.kind==='build'&&a.workDone>.6){
    const base=this.balls.get(goal.other),p=base?[base.p[0],base.p[1]+base.radius+Math.cbrt(a.packet.volumeM3*3/(4*Math.PI))+.04,base.p[2]]:[goal.p[0],world.snow.sample(goal.p[0],goal.p[2]).height+.35,goal.p[2]];
    const b=this.makeBall(a.packet,[a.p[0]+Math.cos(a.yaw)*.4,a.p[1]+1.0,a.p[2]-Math.sin(a.yaw)*.4],[0,0,0]);b.holder=a.id;b.packet.bond=Math.min(1,b.packet.bond+.35);b.target=p;b.support=base?.id;a.packet=emptySnow();a.play*=.7;a.fatigue+=.04;a.goal=null;
   }else if(goal.kind==='roll'){const ball=this.balls.get(goal.other);if(!ball||ball.packet.massKg>=35){a.goal=null;}else{const target=[Math.round(a.p[0]/96)*96+27,Math.round(a.p[2]/96)*96+28],dx=target[0]-ball.p[0],dz=target[1]-ball.p[2],r=Math.hypot(dx,dz);if(r<.8){a.goal=null;a.work*=.85;}else{ball.v[0]+=dx/r*45/Math.max(1,ball.packet.massKg)*dt;ball.v[2]+=dz/r*45/Math.max(1,ball.packet.massKg)*dt;ball.settled=false;goal.p=[...ball.p];}}
   }else if(goal.kind==='push'&&a.workDone>.4){const ball=this.balls.get(goal.other);if(ball){const force=90,dx=ball.p[0]-a.p[0],dz=ball.p[2]-a.p[2],r=Math.hypot(dx,dz)||1;ball.v[0]+=dx/r*force/Math.max(1,ball.packet.massKg);ball.v[2]+=dz/r*force/Math.max(1,ball.packet.massKg);ball.settled=false;ball.bondTo=null;ball.packet.bond*=.4;this.events.push({type:'snow',time,point:[...ball.p],energy:force,id:++this.sequence});}a.cooldown=8;a.play*=.6;a.goal=null;
   }else if(goal.kind==='shovel'){
    const p=[a.p[0]+.5,0,a.p[2]],packet=world.snow.cut({min:[p[0]-.3,0,p[2]-.3],max:[p[0]+.3,.65,p[2]+.3],distance:q=>Math.max(Math.abs(q[0]-p[0])-.28,Math.abs(q[2]-p[2])-.25)},dt*5);this.spread([a.p[0]+1.5,0,a.p[2]],packet);if(packet.massKg)this.events.push({type:'shovel',time,point:[...p],energy:packet.massKg*10,id:++this.sequence});if(a.workDone>1.5){a.goal=null;a.fatigue+=.02;}
   }else if(goal.kind==='angel'){
    a.fatigue=Math.max(0,a.fatigue-dt*.12);for(const side of [-1,1])world.snow.contact({position:[a.p[0]+side*.55,0,a.p[2]+Math.sin(a.workDone*2)*.35],radiusM:.25,normalLoadN:180,slipSpeedMps:.4,durationSeconds:dt});if(a.fatigue<.12)a.goal=null;
   }else if(goal.kind==='walk'){a.goal=null;a.play=Math.min(1,a.play+.1);}
  }
  for(const [id,b] of this.balls){
   if(b.holder){const force=b.target.map((p,k)=>(p-b.p[k])*35-b.v[k]*9+(k===1?9.81:0)),magnitude=Math.hypot(...force)*b.packet.massKg,scale=Math.min(1,180/Math.max(1,magnitude));for(let k=0;k<3;k++)b.v[k]+=force[k]*scale*dt;if(Math.hypot(...b.p.map((p,k)=>p-b.target[k]))<.05&&Math.hypot(...b.v)<.2){b.holder=null;b.bondTo=b.support;}}

   if(b.bondTo){const support=this.balls.get(b.bondTo);if(support&&Math.hypot(...support.v)<.15){const gap=distance(b.p,support.p);if(gap<.12){b.p[1]=support.p[1]+support.radius+b.radius;b.v=[0,0,0];b.settled=true;continue;}}b.bondTo=null;}
   b.v[1]-=9.81*dt;for(let k=0;k<3;k++)b.p[k]+=b.v[k]*dt;const surface=world.snow.sample(b.p[0],b.p[2]),floor=surface.height+b.radius;
   if(b.p[1]<=floor){b.p[1]=floor;const rolling=Math.hypot(b.v[0],b.v[2]),adhesion=world.snow.adhesion(b.packet,0,b.packet.massKg*9.81/Math.max(.002,b.radius*b.radius));if(rolling>.15&&b.packet.massKg<40){const contact=[b.p[0],surface.height-.03,b.p[2]],collected=world.snow.cut(snowSphere(contact,Math.min(.25,b.radius)),adhesion*rolling*dt*6);b.packet=combineSnow(b.packet,collected);b.radius=Math.cbrt(b.packet.volumeM3*3/(4*Math.PI));}const impact=Math.abs(b.v[1]);b.v[1]*=-.03;b.v[0]*=Math.exp(-dt*2);b.v[2]*=Math.exp(-dt*2);b.settled=Math.hypot(...b.v)<.18;if(impact>1.8){this.events.push({type:'snow',time,point:[...b.p],energy:b.packet.massKg*impact*impact/2,id:++this.sequence});if(impact>5){this.spread(b.p,b.packet);this.balls.delete(id);}}}
   // Low-cohesion loose clumps creep into the surrounding snow under their
   // contact load. Compacted snowman parts retain their stronger bonds.
   if(b.settled&&!b.holder&&!b.bondTo&&b.packet.bond<.5&&world.scene.tick%6===0){
    const f=Math.min(1,dt*6*1.2*(1-b.packet.bond)**2),packet={...b.packet,massKg:b.packet.massKg*f,volumeM3:b.packet.volumeM3*f,enthalpyJ:b.packet.enthalpyJ*f};this.spread(b.p,packet);for(const k of ['massKg','volumeM3','enthalpyJ'])b.packet[k]*=1-f;b.radius=Math.cbrt(b.packet.volumeM3*3/(4*Math.PI));if(b.packet.massKg<.02){this.spread(b.p,b.packet);this.balls.delete(id);continue;}
   }
   if(world.cars.every(car=>distance(b.p,car.rig.body.position)>220)){this.spread(b.p,b.packet);this.balls.delete(id);}
  }
 }
 makeBall(packet,p,v){const id='snow-clump:'+this.sequence++,b={id,p:[...p],v:[...v],packet:{...packet},radius:Math.cbrt(packet.volumeM3*3/(4*Math.PI)),settled:false};this.balls.set(id,b);return b;}
 // Rendering workers receive only the observable state; plans, needs and
 // material accounting remain in the authoritative simulation.
 presentation(){return{actors:[...this.actors.values()].map(a=>({id:a.id,seed:a.seed,p:[...a.p],v:[...a.v],yaw:a.yaw,phase:a.phase,mode:a.mode})),balls:[...this.balls.values()].map(b=>({id:b.id,p:[...b.p],radius:b.radius})),sequence:this.sequence,events:[]};}
 snapshot(){return{actors:[...this.actors.values()].map(a=>({...a,p:[...a.p],v:[...a.v],packet:{...a.packet},goal:a.goal?{...a.goal,p:[...a.goal.p]}:null})),balls:[...this.balls.values()].map(b=>({...b,p:[...b.p],v:[...b.v],packet:{...b.packet}})),sequence:this.sequence,events:this.events,pendingPackets:this.pendingPackets};}
 restore(s){this.actors=new Map(s.actors.map(a=>[a.id,a]));this.balls=new Map(s.balls.map(b=>[b.id,b]));this.sequence=s.sequence;this.events=s.events;this.pendingPackets=s.pendingPackets??[];}
 publish(){
  const scene=this.world.scene,keep=new Set(),eye=scene.camera.position,direction=scene.camera.target.map((v,k)=>v-eye[k]),length=Math.hypot(...direction)||1,f=direction.map(v=>v/length),rl=Math.hypot(f[0],f[2])||1,r=[-f[2]/rl,0,f[0]/rl],u=[r[1]*f[2]-r[2]*f[1],r[2]*f[0]-r[0]*f[2],r[0]*f[1]-r[1]*f[0]],tangent=Math.tan((scene.camera.fov??58)*Math.PI/360),aspect=this.world.viewAspect??16/9;
  // Coarse actor bounds include a shadow margin. State stays authoritative;
  // off-screen clothes need neither CPU animation nor thousands of uniforms.
  const observable=(p,radius=4)=>{const q=[p[0]-eye[0],p[1]+.9-eye[1],p[2]-eye[2]],dot=v=>q[0]*v[0]+q[1]*v[1]+q[2]*v[2],z=dot(f);return z>-radius&&Math.abs(dot(r))<Math.max(0,z)*tangent*aspect+radius&&Math.abs(dot(u))<Math.max(0,z)*tangent+radius;};
  for(const a of this.actors.values()){
   const d=distance(a.p,scene.camera.position);if(d>150||(!scene.spec.rendering?.reflectionProbe&&!observable(a.p)&&!observable([a.p[0],-a.p[1]-1.8,a.p[2]])))continue;
   // A trim smaller than a pixel does not need the close-up tessellation.
   const detail=d<9?1:d<32?2:3,model=residentMesh(a.seed%6,detail),actorBindings=model.map(p=>({...p.binding,entity:a.id+':'+p.id}));
   if(!this.visuals.has(a.id)){for(const p of model)scene.add({id:a.id+':'+p.id,visualOnly:true,mesh:p.mesh,material:p.material});const ids=actorBindings.map(b=>b.entity);ids.detail=detail;this.visuals.set(a.id,ids);}else if(this.visuals.get(a.id).detail!==detail){for(const p of model)scene.entities.get(a.id+':'+p.id).mesh=p.mesh;scene.renderStructureRevision++;this.visuals.get(a.id).detail=detail;}keep.add(a.id);
   const speed=a.mode==='walk'?Math.hypot(a.v[0],a.v[2]):0,t=a.phase/5,pose=sampleWalker({id:a.id,root:[a.p[0]-Math.cos(a.yaw)*speed*t,a.p[1],a.p[2]+Math.sin(a.yaw)*speed*t],heading:a.yaw,speed,period:1.18},t);
   if(['gather','build','shovel','throw','roll'].includes(a.mode))for(const [side,sign]of[['left',-1],['right',1]]){const target=yawPoint([.5,a.mode==='gather'?.7:1.1,sign*.22],a.p,a.yaw),arm=solveTwoBone(pose.joints[side+'Shoulder'],target,.295,.27,[-Math.cos(a.yaw),0,Math.sin(a.yaw)]);pose.joints[side+'Elbow']=arm.joint;pose.joints[side+'Hand']=arm.end;}
   if(a.mode==='shovel'){
    const key=a.id+':tool',handle=key+':handle',blade=key+':blade';keep.add(key);
    if(!this.visuals.has(key)){scene.add({id:handle,visualOnly:true,mesh:{kind:'cylinder',radius:.018,height:1,segments:6},material:{kind:'wood',color:[.46,.26,.12,1]}});scene.add({id:blade,visualOnly:true,mesh:{kind:'box',size:[.56,.04,.5]},material:{kind:'steel',color:[.43,.52,.60,1],metalness:.75,roughness:.55}});this.visuals.set(key,[handle,blade]);}
    const tip=[a.p[0]+.5,this.world.snow.sample(a.p[0]+.5,a.p[2]).height,a.p[2]],hand=pose.joints.rightHand,d=hand.map((v,k)=>v-tip[k]),length=Math.hypot(...d)||1;
    scene.setVisualTransform(handle,hand.map((v,k)=>(v+tip[k])*.5),[Math.atan2(d[2],d[1]),0,Math.asin(clamp(-d[0]/length,-1,1))],[1,length,1]);scene.setVisualTransform(blade,tip,[0,a.yaw,0]);
   }
   for(const p of bindHumanoid(pose,actorBindings)){if(a.mode==='angel'){const dy=p.position[1]-a.p[1];p.position=[a.p[0]+p.position[2]-a.p[2],a.p[1]+.25,a.p[2]-dy];p.rotation=[Math.PI/2+p.rotation[0],a.yaw+p.rotation[1],p.rotation[2]];}scene.setVisualTransform(p.entity,p.position,p.rotation,p.scale);}
  }
  for(const b of this.balls.values()){if(distance(b.p,eye)>150||(!scene.spec.rendering?.reflectionProbe&&!observable(b.p,b.radius+3)&&!observable([b.p[0],-b.p[1],b.p[2]],b.radius+3)))continue;keep.add(b.id);let e=scene.entities.get(b.id);if(!e){e=scene.add({id:b.id,visualOnly:true,position:b.p,mesh:{kind:'sphere',radius:1,segments:16},material:snowMaterial});this.visuals.set(b.id,[b.id]);}scene.setVisualTransform(b.id,b.p,[0,0,0],[b.radius,b.radius,b.radius]);}
  for(const [key,ids]of this.visuals)if(!keep.has(key)){for(const id of ids)scene.remove(id);this.visuals.delete(key);}
 }
 dispose(){for(const ids of this.visuals.values())for(const id of ids)this.world.scene.remove(id);this.visuals.clear();}
}
