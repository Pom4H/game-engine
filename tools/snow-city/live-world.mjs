import {InfiniteWorld} from '../../dist/world/infinite-world.js';
import {SnowMatter} from '../../dist/environment/snow-matter.js';
import {cityTile,BLOCK} from './city.mjs';
import {createCar} from './cars.mjs';
import {Residents} from './residents.mjs';
import {SnowView} from './snow-render.mjs';
import {LiveDirector} from './live-director.mjs';
import {hash} from './math.mjs';
import {RoadService} from './road-service.mjs';
import {SnowDriver} from './driver.mjs';
import {groundSupport} from '../../dist/physics/wheel-support.js';

export class LiveSnowWorld{
 constructor(scene,{authority=false}={}){
  this.scene=scene;this.authority=authority;this.snow=new SnowMatter({cellM:.2,depthM:.48});this.cars=[0,1,2].map(i=>createCar(scene,'m3:live:'+i,[0,0,0],i));this.people=new Residents(this);this.snowView=new SnowView(this);this.director=new LiveDirector();this.colliders=new Set();this.events=[];this.collisionCount=0;this.origin=[0,0,0];this.freeCamera=null;
  for(const car of this.cars){car.rig.body.position[1]+=.48;car.phase=0;car.destination=[car.index===2?0:96,0];car.navigation=[];car.intent={throttle:1};car.route=[];car.segmentStart=car.index===2?[0,96]:[-96,0];car.driver=new SnowDriver(car,this);}
  this.world=new InfiniteWorld({generate:d=>cityTile(d.id.x,d.id.z,d.id.lod),install:(_d,entities)=>{for(const e of entities)scene.add(e);},uninstall:(_d,entities)=>{for(const e of entities)scene.remove(e.id);},onError:(_d,e)=>{throw e;}},{maxResident:25,maxConcurrent:3,retainUpdates:0});
  this.people.populate(0,0);this.installContacts();this.service=new RoadService(this);
  if(authority){
   scene.contactEnergySource=(contact,available)=>{const owners=this.cars.filter(c=>c.id===contact.a.id||c.id===contact.b.id);return owners.reduce((sum,c)=>sum+c.impact(contact,available/owners.length,c.id===contact.a.id),0);};
   scene.use({id:'city:decisions',phase:'plan',rateHz:60,context:'none',reads:['time'],writes:['city:controls'],run:()=>this.plan(1/60)});
   scene.use({id:'city:matter',phase:'publish',rateHz:10,context:'none',reads:['contacts','time'],writes:['city:matter'],after:['engine:clock'],run:()=>this.contactSnow(.1)});
   scene.use({id:'city:camera',phase:'publish',rateHz:60,context:'none',reads:['time'],writes:['city:camera'],after:['engine:clock'],run:()=>{for(const c of this.cars){c.observe();c.phase+=c.rig.drivetrainState.engineRpm/1200;}this.director.choose(this);}});
  }
 }
 installContacts(){
  const fallback=groundSupport(0);this.scene.physics.wheelSupport=(o,d,max,hit,exclude)=>{
   if(d[1]>=-.15)return fallback(o,d,max,hit,exclude);let t=(this.snow.sample(o[0],o[2]).height-o[1])/d[1];
   for(let n=0;n<3;n++)t=(this.snow.sample(o[0]+d[0]*t,o[2]+d[2]*t).height-o[1])/d[1];if(t<0||t>max)return false;
   hit.id='snow-matter';hit.distance=t;hit.body=null;hit.triangle=-1;hit.velocity.fill(0);for(let k=0;k<3;k++)hit.point[k]=o[k]+d[k]*t;hit.normal.splice(0,3,0,1,0);return true;
  };
  this.scene.physics.soilContactAt=(p,input)=>{const s=this.snow.sample(p[0],p[2]);return{tractionCoefficient:s.friction,sinkageM:Math.max(0,.48-s.height),compaction:s.compaction,rollingResistanceN:input.normalLoadN*Math.min(.1,s.height*.13),bearingPressurePa:input.normalLoadN/input.contactAreaM2};};
 }
 walkable(p){const x=p[0]-Math.round(p[0]/96)*96,z=p[2]-Math.round(p[2]/96)*96;return Math.abs(x)<17||Math.abs(z)<17||x>17&&z>17;}
 plan(dt){
  const center=this.cars[0].rig.body.position,cx=Math.round(center[0]/96),cz=Math.round(center[2]/96);const centers=this.cars.map(c=>c.rig.body.position);this.people.populate(cx,cz,centers);this.resideCollision([...centers,this.service.rig.body.position]);
  for(const car of this.cars){
   const b=car.rig.body,goal=car.destination,speed=Math.hypot(b.velocity[0],b.velocity[2]),dx=goal[0]-b.position[0],dz=goal[1]-b.position[2],range=Math.hypot(dx,dz);
   if(range<5){
    const from=[Math.round(goal[0]/96),Math.round(goal[1]/96)],directions=[[1,0],[0,1],[-1,0],[0,-1]],previous=car.previousBlock??[from[0]-Math.sign(goal[0]-car.segmentStart[0]),from[1]-Math.sign(goal[1]-car.segmentStart[1])];
    const candidates=directions.map((v,i)=>({x:from[0]+v[0],z:from[1]+v[1],score:(hash(from[0]+i,from[1],car.index+car.navigation.length)%100)/100-(from[0]+v[0]===previous[0]&&from[1]+v[1]===previous[1]?3:0)})).sort((a,b)=>b.score-a.score);
    const next=candidates[0];car.previousBlock=from;car.segmentStart=[...goal];car.destination=[next.x*96,next.z*96];car.navigation.push([...car.destination]);if(car.navigation.length>24)car.navigation.shift();car.turnUntil=this.scene.time+.25;
   }
   car.route=[car.destination];car.routeIndex=0;
   const rpm=car.rig.drivetrainState.engineRpm,slip=car.wheelIds.reduce((sum,id)=>sum+car.rig.part(id).slipPowerW,0);
   // Pedal lift responds to the limiter and loss of forward traction, then
   // power returns as the tyre catches. It is not a time-oscillating throttle.
   car.intent.throttle=rpm>6900&&slip>70000?.30:speed>23?.18:1;
   car.driver.step(dt);
  }
  this.service.step(dt);this.people.step(dt);
 }
 resideCollision(centers){const anchor=centers.map(p=>Math.round(p[0]/96)+':'+Math.round(p[2]/96)).join(';');if(this.collisionAnchor===anchor)return;this.collisionAnchor=anchor;const districts=new Map();for(const p of centers){const cx=Math.round(p[0]/96),cz=Math.round(p[2]/96);for(let dx=-1;dx<=1;dx++)for(let dz=-1;dz<=1;dz++)districts.set((cx+dx)+':'+(cz+dz),[cx+dx,cz+dz]);}const key=[...districts.keys()].sort().join(';');if(this.collisionKey===key)return;this.collisionKey=key;const keep=new Set();
  for(const [x,z] of districts.values())for(const sx of[-1,1])for(const sz of[-1,1])if(sx!==1||sz!==1){const id=`solid:${x}:${z}:${sx}:${sz}`;keep.add(id);if(!this.colliders.has(id))this.scene.add({id,position:[x*96+sx*31,12,z*96+sz*31],body:{mass:0,collisionSize:[27,24,27],friction:.7,restitution:.08}});}
  for(const id of this.colliders)if(!keep.has(id))this.scene.remove(id);this.colliders=keep;
 }
 contactSnow(dt){
  for(const car of this.cars)for(const id of car.wheelIds){const wheel=car.rig.part(id);if(!wheel.contact)continue;const p=wheel.point,speed=Math.hypot(...car.rig.body.velocity),slip=Math.abs(wheel.angularSpeed*wheel.effectiveRadiusM-speed);
   this.snow.contact({position:p,radiusM:.20,normalLoadN:wheel.loadN,slipSpeedMps:slip,durationSeconds:dt,temperatureC:-2+Math.min(55,wheel.temperatureRiseK??0),heatJ:Math.min(10000,wheel.slipPowerW*dt*.65)});
   // Shear removes real material from the tyre patch and throws it sideways.
   if(slip>2&&wheel.loadN>20){const r=.22,shape={min:[p[0]-r,Math.max(0,p[1]-.07),p[2]-r],max:[p[0]+r,p[1]+.03,p[2]+r],distance:q=>Math.max(Math.abs(q[0]-p[0])-r,Math.abs(q[2]-p[2])-r)},packet=this.snow.cut(shape,Math.min(.6,slip*dt*.08));if(packet.massKg)this.people.spread([p[0]+Math.sin(car.rig.body.rotation[1])*.6,0,p[2]+Math.cos(car.rig.body.rotation[1])*.6],packet);}
  }
  this.service.clear(dt);this.avalancheKg=this.snow.relax(dt,400);
 }
 frame(){const scene=this.scene,events=scene.drainEvents();this.events=[...events,...this.people.events];this.collisionCount+=events.filter(e=>e.type==='impact'&&e.energy>100).length;
  return{tick:scene.tick,camera:structuredClone(scene.camera),shot:this.director.shot,subject:this.director.subject,prediction:this.director.prediction,events:this.events,cars:this.cars.map(c=>{const b=c.rig.body;return{id:c.id,body:[...b.position,...b.rotation,...b.velocity,...b.angularVelocity],steer:c.steer,throttle:c.throttle,rpm:c.rig.drivetrainState.engineRpm,gear:c.rig.drivetrainState.gear,phase:c.phase,surface:this.snow.sample(b.position[0],b.position[2]),slip:c.wheelIds.reduce((s,id)=>s+c.rig.part(id).slipPowerW,0),wheels:c.wheelIds.map(id=>{const w=c.rig.part(id);return{point:[...w.point],contactNormal:[...w.contactNormal],contact:w.contact,spinRad:w.spinRad,effectiveRadiusM:w.effectiveRadiusM};}),...(c.softRevision?{soft:{nodes:[...c.soft.structure.position],panels:c.soft.panels.presentationState(),revision:c.softRevision}}:{})};}),service:this.service.snapshot(),people:this.people.presentation(),snowRemoved:this.snow.drainRemoved(),snowEdits:this.snow.drainEdits(),avalancheKg:this.avalancheKg??0};
 }
 restore(frame){const scene=this.scene;scene.tick=frame.tick;scene.time=frame.tick/60;scene.physics.time=scene.time;scene.camera=frame.camera;this.director.shot=frame.shot;this.director.subject=frame.subject;
  for(let i=0;i<this.cars.length;i++){const c=this.cars[i],s=frame.cars[i],b=c.rig.body;b.position.splice(0,3,...s.body.slice(0,3));b.rotation.splice(0,3,...s.body.slice(3,6));b.velocity.splice(0,3,...s.body.slice(6,9));b.angularVelocity.splice(0,3,...s.body.slice(9,12));c.steer=s.steer;c.throttle=s.throttle;c.replayParts=s.wheels;if(s.soft&&s.soft.revision!==c.softRevision){c.soft.structure.position.set(s.soft.nodes);c.soft.panels.restorePresentation(s.soft.panels);c.softRevision=s.soft.revision;c.softUntil=scene.time;}else if(!s.soft&&c.softRevision)c.clearSoftPresentation();}
  this.service.restore(frame.service);this.people.restore(frame.people);scene.resources.set('snow-city',{time:scene.time,source:'live-authority-60hz',shot:frame.shot,subject:frame.subject,people:this.people.actors.size,snowCells:this.snow.cells.size,avalancheKg:frame.avalancheKg,cars:frame.cars.map(c=>({rpm:c.rpm,slipW:c.slip}))});
 }
 async prepareFrame(){const scene=this.scene;if(this.freeCamera)scene.camera=this.freeCamera;const start=performance.now(),camera=scene.camera,forward=camera.target.map((v,k)=>v-camera.position[k]),length=Math.hypot(...forward),pixelScale=(this.viewHeight??1080)/(2*Math.tan((camera.fov??58)*Math.PI/360));
  for(const c of this.cars){const p=c.rig.body.position,depth=p.reduce((sum,v,k)=>sum+(v-camera.position[k])*forward[k]/length,0);c.renderDetail=depth>0&&pixelScale/Math.max(.25,depth)*.002>.5?2:1;c.publish();}this.service.publish();const vehicles=performance.now();this.people.publish();const people=performance.now();this.snowView.update();const snow=performance.now(),cx=Math.round(scene.camera.position[0]/96),cz=Math.round(scene.camera.position[2]/96),demands=[];
  for(let dz=-2;dz<=2;dz++)for(let dx=-2;dx<=2;dx++){const x=cx+dx,z=cz+dz,lod=Math.max(Math.abs(dx),Math.abs(dz))>1?1:0;demands.push({id:{lod,x,z},key:`${lod}:${x}:${z}`,bounds:{minX:x*96-48,minZ:z*96-48,maxX:x*96+48,maxZ:z*96+48},sizeM:96,distanceM:Math.hypot(dx,dz)*96,priority:10-Math.hypot(dx,dz)});}this.world.update(demands);await this.world.flush();
  this.viewStages={'view.vehicles':vehicles-start,'view.people':people-vehicles,'view.snow':snow-people,'view.city':performance.now()-snow};
 }
 dispose(){this.service.dispose();this.people.dispose();this.snowView.dispose();this.world.dispose();for(const c of this.cars)c.dispose();for(const id of this.colliders)this.scene.remove(id);}
}
