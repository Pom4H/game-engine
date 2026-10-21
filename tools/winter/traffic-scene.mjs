import {compileVehicle} from '../../dist/vehicles/framework.js';
import {M3_VEHICLE_DEFINITION} from '../../dist/vehicles/m3.js';
import {smoothCoincidentNormals} from '../../dist/vehicles/render-subdivision.js';
import {VehicleRoute} from '../../dist/animation/route.js';
import {WalkWorld} from '../../dist/runtime/walker-motion.js';
import {batchStaticScenery} from '../../dist/procedural/static-batch.js';
import {makeWinterScene} from './scene.mjs';
import {canopySnow} from '../arcade/snow-canopy.mjs';

export const TRAFFIC_VIEWS=[
 {name:'На улице',position:[-26,6.8,6.5],target:[6,1.1,-1.6],fov:60},
 {name:'Над потоком',position:[-16,18,20],target:[3,.6,0],fov:57},
 {name:'У обочины',position:[-15,1.7,7.6],target:[10,1.1,-1.8],fov:61},
];
const PALETTE=[[.91,.56,.055,1],[.10,.43,.43,1],[.68,.13,.095,1],[.73,.76,.72,1],[.12,.23,.37,1],[.33,.47,.12,1],[.76,.28,.075,1],[.32,.11,.20,1]];
const rotate=(p,root,heading)=>{const c=Math.cos(heading),s=Math.sin(heading);return[root[0]+c*p[0]+s*p[2],root[1]+p[1],root[2]-s*p[0]+c*p[2]];};
function laneRoute(lane){
 const xs=[-72,-53,-32,-11,10,31,52,72],points=xs.map((x,i)=>[x,.015,-lane+.16*Math.sin(i*1.7)]);
 points.push([81,.015,0]);for(let i=xs.length-1;i>=0;i--)points.push([xs[i],.015,lane+.16*Math.sin(i*1.7+.8)]);
 points.push([-81,.015,0]);return{points};
}

/** Scenario authoring only: native routes, wheel contacts, snow and horn events
 * own all updates. Shared traffic geometry keeps a dense scene affordable. */
export function makeTrafficScene({count=48}={}){
 if(!Number.isInteger(count)||count<12||count>64||count%2)throw new RangeError('Traffic count must be even, within 12..64');
 const old=makeWinterScene(),entities=[],obstacles=[],vehicles=[],wheels=[],cars=[];
 const box=(id,position,size,material,{solid=false,environmental,rotation}={})=>{
  entities.push({id,position,mesh:{kind:'box',size},material,...(solid?{body:{mass:0}}:{}),...(environmental?{environmental}:{}),...(rotation?{rotation}:{})});
  if(solid&&position[1]+size[1]/2>.4)obstacles.push({min:position.map((v,i)=>v-size[i]/2),max:position.map((v,i)=>v+size[i]/2)});
 };
 const snow={kind:'snow',color:[.86,.91,.96,1],roughness:.92};
 const metal={kind:'steel',color:[.09,.12,.14,1],roughness:.46};
 const frame={kind:'default',color:[.095,.13,.14,1],roughness:.75};
 box('traffic-road',[0,-.1,0],[190,.2,12.7],{kind:'asphalt',color:[.075,.085,.098,1],roughness:.24},
  {solid:true,environmental:{surfaceUse:'road',snowDepthM:.009,waterDepthM:.0028,iceDepthM:.00008,snowMaterial:snow}});
 for(const sign of [-1,1]){
  box('traffic-sidewalk'+sign,[0,.07,sign*8.25],[180,.14,3.7],{kind:'concrete',color:[.46,.46,.43,1],roughness:.86},
   {solid:true,environmental:{surfaceUse:'sidewalk',snowDepthM:.14,snowMaterial:snow}});
  box('traffic-kerb'+sign,[0,.13,sign*6.38],[180,.26,.18],{kind:'concrete',color:[.49,.48,.43,1]},
   {solid:true,environmental:{surfaceUse:'curb',snowDepthM:.045,snowMaterial:snow}});
 }
 const facadeColors=[[.48,.24,.15,1],[.31,.38,.40,1],[.59,.46,.29,1],[.35,.45,.41,1]];
 const signs=['ЧАЙ · КОФЕ','ПЕКАРНЯ','ЦВЕТЫ','МАСТЕРСКАЯ','ПРОДУКТЫ','ТЁПЛЫЙ ХЛЕБ'];
 for(const sign of [-1,1])for(let i=0;i<9;i++){
  const x=(i-4)*12,z=sign*13.3,h=8.3+(i%3)*1.65,front=sign*9.78;
  const plaster={kind:'concrete',color:facadeColors[(i+(sign>0?1:0))%4],pattern:i%3===0?'brick':'plaster',ageYears:45,roughness:.86};
  box(`facade:${sign}:${i}`,[x,h/2,z],[11.6,h,7],plaster,{solid:true});
  for(const y of [2.9,h-.18]){
   box(`cornice:${sign}:${i}:${y}`,[x,y,front-sign*.08],[11.8,.20,.32],{kind:'concrete',color:[.61,.59,.52,1]});
   box(`cornice-snow:${sign}:${i}:${y}`,[x,y+.125,front-sign*.08],[11.8,.05,.32],snow);
  }
  box(`roof:${sign}:${i}`,[x,h+.03,z],[11.85,.12,7.2],metal,{environmental:{surfaceUse:'generic',snowDepthM:.13,snowMaterial:snow}});
  for(const dx of [-3.5,0,3.5])for(const y of [4.55,6.8,...(h>10?[9.05]:[])]){
   const warm=((i+Math.round(y)+Math.round(dx))%3+3)%3!==0;
   box(`window:${sign}:${i}:${dx}:${y}`,[x+dx,y,front-sign*.05],[1.30,1.7,.065],
    {kind:'default',color:[.12,.18,.24,1],roughness:.26,pattern:'window',emissive:warm?[.16,.085,.028]:[.002,.004,.007]});
   for(const side of [-1,1]){
    box(`jamb:${sign}:${i}:${dx}:${y}:${side}`,[x+dx+side*.69,y,front-sign*.11],[.09,1.85,.14],frame);
    box(`lintel:${sign}:${i}:${dx}:${y}:${side}`,[x+dx,y+side*.9,front-sign*.11],[1.48,.09,.14],frame);
   }
   box(`mullion:${sign}:${i}:${dx}:${y}`,[x+dx,y,front-sign*.13],[.065,1.7,.12],frame);
   box(`crossbar:${sign}:${i}:${dx}:${y}`,[x+dx,y+.2,front-sign*.13],[1.3,.06,.12],frame);
   box(`sill:${sign}:${i}:${dx}:${y}`,[x+dx,y-.88,front-sign*.17],[1.55,.12,.40],{kind:'concrete',color:[.58,.58,.54,1]});
   box(`sill-snow:${sign}:${i}:${dx}:${y}`,[x+dx,y-.803,front-sign*.17],[1.55,.035,.40],snow);
  }
  box(`shop:${sign}:${i}`,[x,1.42,front-sign*.04],[8.6,2.3,.08],
   {kind:'default',color:[.23,.16,.085,1],pattern:'window',roughness:.21,emissive:[.25,.11,.031]});
  for(const dx of [-4.35,-2.2,0,2.2,4.35])box(`shop-frame:${sign}:${i}:${dx}`,[x+dx,1.42,front-sign*.13],[.10,2.42,.16],frame);
  for(const y of [.23,1.87,2.63])box(`shop-crossbar:${sign}:${i}:${y}`,[x,y,front-sign*.13],[8.8,.08,.16],frame);
  box(`shop-sign:${sign}:${i}`,[x,3.18,front-sign*.20],[8.9,.65,.16],
   {kind:'default',color:[.045,.12,.13,1],roughness:.7,label:signs[i%signs.length],labelColor:[.95,.72,.36],emissive:[.018,.033,.034]});
  // The slope-aware canopy snow from our arcade work, retained as one shell.
  const awningX=x-2.5;
  const shell=canopySnow(0,2.25,.58,i+7,24,8);
  const rotation=sign>0?[0,Math.PI,0]:[0,0,0];
  entities.push({id:`canopy-snow:${sign}:${i}`,position:[awningX,0,sign>0?front-2.92:front+2.92],rotation,mesh:shell,material:snow});
  entities.push({id:`canopy:${sign}:${i}`,position:[awningX,-.075,sign>0?front-2.92:front+2.92],rotation,mesh:shell,material:{kind:'default',color:i%2?[.09,.27,.22,1]:[.55,.18,.10,1],roughness:.85}});
  box(`awning:${sign}:${i}`,[awningX,3.15,front-sign*.93],[4.55,.13,1.95],{kind:'default',color:i%2?[.09,.27,.22,1]:[.55,.18,.10,1],roughness:.85});
 }
 for(const sign of [-1,1])for(const x of [-38,-18,2,22,42]){
  entities.push({id:`pole:${sign}:${x}`,position:[x,2.9,sign*7.1],mesh:{kind:'cylinder',height:5.8,radius:.055,segments:10},material:metal});
  box(`lamp-arm:${sign}:${x}`,[x,5.7,sign*6.65],[.07,.07,.9],metal);
  entities.push({id:`street-light:${sign}:${x}`,position:[x,5.68,sign*6.15],mesh:{kind:'box',size:[.46,.09,.30]},
   material:{kind:'default',color:[.9,.71,.40,1],emissive:[5.2,2.7,.95]},light:{kind:'point',color:[1,.66,.34],intensity:13,range:14}});
 }
 // A few quiet foreground details give the busy road scale and a place to walk.
 for(const x of [-16,17]){
  box('bench-seat:'+x,[x,.6,8.6],[2.6,.14,.56],{kind:'wood',color:[.25,.12,.06,1]},{environmental:{surfaceUse:'generic',snowDepthM:.055,snowMaterial:snow},solid:true});
  box('bench-back:'+x,[x,.95,8.86],[2.6,.65,.10],{kind:'wood',color:[.25,.12,.06,1]},{solid:true});
  for(const dx of [-.9,.9])box(`bench-leg:${x}:${dx}`,[x+dx,.3,8.6],[.09,.6,.46],metal);
 }
 for(let i=0;i<9;i++){
  const x=-40+i*10;
  box('bollard:'+i,[x,.48,7.0],[.13,.85,.13],metal,{solid:true});
  box('bollard-snow:'+i,[x,.95,7.0],[.18,.08,.18],snow);
 }
 const walker=old.spec.animation.walkers[0],root=[-13,.27,8.2];
 for(const e of old.spec.entities.filter(e=>e.id.startsWith('walker-')))entities.push({...e,position:root});
 const compiled=compileVehicle(M3_VEHICLE_DEFINITION),bodyMesh=smoothCoincidentNormals(compiled.body,65),routes=[laneRoute(1.6),laneRoute(4.25)];
 for(let i=0;i<count;i++){
  const lane=i%2,route=routes[lane],curve=new VehicleRoute(route),offsetM=Math.floor(i/2)*curve.lengthM/(count/2)+lane*5.4;
  const pose=curve.sample(offsetM),parts=[],paint=PALETTE[i%PALETTE.length],taxi=i%5===0,van=i%7===3;
  const addPart=(name,local,mesh,material,extra={})=>{
   const id=`traffic:${i}:${name}`,position=rotate(local,pose.position,pose.heading);
   entities.push({id,position,mesh,material,rotation:[...(extra.rotation??[0,0,0])].map((v,k)=>v+(k===1?pose.heading:0)),...(extra.scale?{scale:extra.scale}:{}),...(extra.body?{body:extra.body}:{})});
   parts.push({id,origin:local.map((v,k)=>v+route.points[0][k]),...(extra.rotation?{rotation:extra.rotation}:{}),...(extra.wheel?{wheel:true,radius:.346}:{})});return id;
  };
  for(const part of compiled.parts){
   const tire=part.role==='tire',material=part.role==='paint'?{kind:'steel',color:taxi?PALETTE[0]:paint,treatment:'painted',roughness:.31,metalness:.06,clearcoat:.72,clearcoatRoughness:.25}:part.role==='glass'?{kind:'glass',color:[.15,.22,.27,.80],roughness:.16}:part.material;
   const id=addPart(part.id,part.position,part.role==='paint'?bodyMesh:part.mesh,material,{wheel:part.wheel,rotation:part.rotation,...(part.role==='paint'?{body:{mass:1280,motion:'kinematic',collisionSize:[4.78,1.48,1.89]}}:tire?{body:{mass:320,motion:'kinematic',collisionSize:[.69,.69,.25]}}:{})});
   if(tire)wheels.push({entityId:id,radius:.346});
  }
  if(taxi)addPart('taxi',[0,1.58,0],{kind:'box',size:[.46,.17,.43]},{kind:'default',color:[.96,.73,.2,1],emissive:[.5,.26,.035],label:'TAXI',labelColor:[.045,.04,.03]});
  if(van){addPart('van-canopy',[-.55,1.58,0],{kind:'box',size:[2.25,.56,1.75]},{kind:'steel',color:paint,roughness:.3,clearcoat:.6});addPart('van-snow',[-.55,1.88,0],{kind:'box',size:[2.28,.07,1.77]},snow);}
  else addPart('roof-snow',[-.34,1.485,0],{kind:'box',size:[1.42,.055,1.30]},snow);
  for(const side of [-1,1]){
   addPart('headlamp:'+side,[2.36,.61,side*.65],{kind:'box',size:[.045,.13,.35]},
    {kind:'default',color:[.9,.9,.75,1],emissive:[3.5,3.3,2.3]});
   addPart('tail-light:'+side,[-2.35,.64,side*.66],{kind:'box',size:[.045,.12,.34]},
    {kind:'default',color:[.46,.02,.014,1],emissive:[2.2,.015,.008]});
  }
  // One bounded point emitter per nearby car; all lamps still carry emissive detail.
  if(i%3===0){const id=addPart('headlight-glow',[2.63,.53,0],{kind:'sphere',radius:.025,segments:6},{kind:'default',emissive:[.4,.36,.25]});entities.at(-1).light={kind:'point',color:[1,.87,.61],intensity:2.6,range:6};}
  vehicles.push({id:'traffic-'+i,velocity:[lane?8.1:10.4,0,0],route:{...route,offsetM},parts});
  cars.push({id:`traffic:${i}:body`,index:i,frequencyHz:[255,330,395,290,440][i%5]});
 }
 const spec={version:1,seed:20261002,ground:-100,
  environment:{temperatureC:-2.5,snowfall:'moderate',sunlight:.12,humidity:.87,wind:[1.6,0,.25],clock:{startHour:17.4,hoursPerSecond:0}},
  rendering:{sunDirection:[-.65,.24,-.3],sunColor:[1,.68,.40],sunIntensity:.55,skyColor:[.16,.23,.36],exposure:1.10,shadowExtent:65,
   fogDensity:.011,fogColor:[.12,.17,.24],fogBaseHeight:0,fogHeightFalloff:.14,fogStartDistance:8,fogRampDistance:24,
   reflectionProbe:{position:[0,1.4,0],radius:70,facesPerFrame:1,boxHalfExtents:[65,12,18]}},
  camera:TRAFFIC_VIEWS[0],
  animation:{walkers:[{...walker,root}],vehicles},
  surfaceContacts:{snow:[{surfaceId:'traffic-sidewalk1',tileSize:4,coarseCellSize:.2,detailedCellSize:.045,maxTiles:64,maxDetailedTiles:10}],wheels},
  entities:batchStaticScenery(entities,e=>!e.id.startsWith('traffic:')&&!e.id.startsWith('walker-'),20)};
 return{spec,cars,obstacles,count,bounds:{min:[-46,-1,6.7],max:[46,20,10.0]}};
}

/** Driver signal decisions are scenario policy. The engine records, positions,
 * synthesizes and replays every honk at its authoritative tick. */
export class TrafficDirector {
 constructor(scene,cars){
  // Native tyre contacts already own road work. Avoid applying the legacy
  // whole-body traffic estimate to the same cars a second time.
  for(const car of cars)scene.surfaces.claimContactBody(car.id);
  this.scene=scene;this.cars=cars;this.honks=0;this.next=cars.map(c=>.4+(c.index*.731)%12);this.enabled=true;
  scene.use({id:'winter:traffic-signals',phase:'commit',rateHz:10,context:'none',reads:['entities','time'],writes:['traffic:signals','events'],after:['engine:clock','engine:fracture'],run:()=>{
   const commands=[];
   for(const car of cars){
    if(scene.time<this.next[car.index])continue;
    this.next[car.index]=scene.time+8.5+(car.index*3.17)%10;
    const entity=scene.entities.get(car.id);if(!this.enabled||!entity||Math.abs(entity.position[0])>48||Math.abs(entity.position[2])>6)continue;
    commands.push({type:'horn',id:car.id,durationSeconds:car.index%4===0?.55:.16+(car.index%3)*.09,frequencyHz:car.frequencyHz});this.honks++;
   }
   return [...commands,{type:'resource',key:'winter:traffic',value:this.inspect()}];
  }});
 }
 honkNearest(){
  const eye=this.scene.camera.position,car=this.cars.map(c=>({c,e:this.scene.entities.get(c.id)})).filter(x=>x.e).sort((a,b)=>Math.hypot(...a.e.position.map((v,k)=>v-eye[k]))-Math.hypot(...b.e.position.map((v,k)=>v-eye[k])))[0]?.c;
  if(car){this.scene.honk(car.id,.45,car.frequencyHz);this.honks++;}
 }
 inspect(){
  const live=this.cars.map(c=>this.scene.entities.get(c.id)).filter(Boolean),visible=live.filter(e=>Math.abs(e.position[0])<48&&Math.abs(e.position[2])<6);
  return{cars:live.length,visibleCars:visible.length,rightbound:visible.filter(e=>e.body.velocity[0]>0).length,leftbound:visible.filter(e=>e.body.velocity[0]<0).length,honks:this.honks,time:this.scene.time,sprayEmitted:this.scene.contacts.sprayEmitted};
 }
}
export function trafficWalkingWorld(scene,data){
 const query=()=>new WalkWorld([...data.obstacles,...data.cars.map(c=>scene.entities.get(c.id)).filter(Boolean).map(e=>{
  const c=Math.abs(Math.cos(e.rotation[1])),s=Math.abs(Math.sin(e.rotation[1])),x=2.4*c+s,z=2.4*s+c;
  return{min:[e.position[0]-x,e.position[1],e.position[2]-z],max:[e.position[0]+x,e.position[1]+1.6,e.position[2]+z]};
 })],data.bounds);
 return{move:(...a)=>query().move(...a),camera:(...a)=>query().camera(...a)};
}
