import {generateM3Vehicle,m3PartBody,m3PartMaterial} from '../../dist/vehicles/m3.js';
import {WalkWorld} from '../../dist/runtime/walker-motion.js';
import {clothLoftMesh} from '../../dist/procedural/cloth.js';

export const CAR_ORIGIN=[-2,.006,-1.2];
export const FINISH=[7,.16,2.8];
export const BOUNDS={min:[-11,-1,-5],max:[11,8,5]};

/** Small playable scene: the same surface state drives geometry, contacts and audio. */
export function makeWinterScene(){
 const entities=[],obstacles=[],vehicleParts=[];
 const box=(id,position,size,material,solid=false,environmental)=>{
  entities.push({id,position,mesh:{kind:'box',size},material,...(solid?{body:{mass:0}}:{}),...(environmental?{environmental}:{})});
  if(solid&&(!environmental||position[1]+size[1]/2>.35))obstacles.push({min:position.map((v,i)=>v-size[i]/2),max:position.map((v,i)=>v+size[i]/2)});
 };
 const brick={kind:'concrete',color:[.34,.17,.105,1],pattern:'brick',roughness:.9,ageYears:35};
 const timber={kind:'default',color:[.24,.12,.065,1],roughness:.85};
 box('road',[0,-.08,-1.6],[70,.16,6],{kind:'asphalt',color:[.12,.13,.14,1],roughness:.72},true,{surfaceUse:'road',snowDepthM:.0048,waterDepthM:.003,iceDepthM:.00012});
 box('path',[0,.05,3.15],[24,.1,3.5],{kind:'concrete',color:[.42,.43,.43,1],roughness:.87},true,{surfaceUse:'sidewalk',snowDepthM:.06,snowMaterial:{kind:'snow',roughness:.95}});
 box('kerb',[0,.05,1.37],[24,.1,.14],{kind:'concrete',color:[.46,.45,.42,1]},true,{surfaceUse:'curb',snowDepthM:.018});
 for(const z of [-7,7]){
  box('building'+z,[0,3.3,z],[27,6.6,3.6],brick,true);
  box('roof'+z,[0,6.62,z],[27.3,.12,3.9],{kind:'steel',color:[.12,.14,.14,1]},false,{surfaceUse:'generic',snowDepthM:.09});
  for(let x=-10;x<=10;x+=4)for(const y of [1.75,4.4]){
   const face=z<0?z+1.83:z-1.83;
   box(`window:${x}:${y}:${z}`,[x,y,face],[1.35,1.65,.06],{kind:'default',color:[.11,.15,.18,1],pattern:'window',roughness:.28,emissive:[.045,.025,.012]});
   box(`sill:${x}:${y}:${z}`,[x,y-.9,face],[1.65,.12,.3],{kind:'concrete',color:[.55,.50,.42,1]},false,{surfaceUse:'generic',snowDepthM:.03});
  }
 }
 for(const x of [-10,10])box('boundary'+x,[x,1.6,3.7],[.2,3.2,2.5],brick,true);
 for(const z of [3.3,3.56,3.82])box('bench-seat'+z,[8,.53,z],[2.5,.09,.21],timber,true,{surfaceUse:'generic',snowDepthM:.025});
 for(const x of [7.1,8.9])box('bench-leg'+x,[x,.3,3.55],[.08,.5,.65],{kind:'steel',color:[.10,.13,.14,1]},true);
 box('bench-back',[8,.97,4],[2.5,.65,.09],timber,true);
 for(const x of [-7,6]){
  entities.push({id:'lamp'+x,position:[x,2.2,4.6],mesh:{kind:'cylinder',radius:.045,height:4.4,segments:12},material:{kind:'steel',color:[.09,.12,.14,1],roughness:.5}});
  entities.push({id:'lamp-glow'+x,position:[x,4.45,4.6],mesh:{kind:'sphere',radius:.13,segments:12},material:{kind:'default',emissive:[2,.95,.3]},light:{kind:'point',color:[1,.61,.3],intensity:4,range:8}});
 }
 // Low-cost clothed rig. The engine owns IK, planted feet and every transform.
 const bindings=[];
 const garment=(name,joint,offset,scale,color,extra={})=>{
  const id='walker-'+name;bindings.push({entity:id,joint,offset,scale,...extra});
  const mesh=name==='head'?{kind:'sphere',radius:.5,segments:20}:clothLoftMesh({rings:name==='coat'?[[-.5,.44,.48],[-.35,.49,.5],[.18,.47,.49],[.36,.40,.46],[.5,.23,.34]]:[[-.5,.34,.38],[-.34,.49,.49],[.28,.47,.47],[.5,.33,.37]],radialSegments:16,subdivisions:2,roundness:.78,folds:.014,seed:name.length});
  entities.push({id,position:[-8,1,3],mesh,material:{kind:'default',color,roughness:.94,...(name!=='head'?{pattern:'fabric'}:{})}});
 };
 garment('coat','pelvis',[0,.22,0],[.40,.72,.51],[.18,.26,.22,1]);
 garment('head','head',[0,0,0],[.19,.23,.18],[.51,.34,.25,1]);
 garment('hat','head',[0,.12,0],[.23,.13,.22],[.62,.24,.105,1]);
 garment('pack','pelvis',[-.27,.23,0],[.20,.43,.36],[.24,.13,.08,1]);
 for(const side of ['left','right']){
  garment(side+'-thigh',side+'Hip',[0,0,0],[.16,1,.17],[.12,.15,.17,1],{boneTo:side+'Knee'});
  garment(side+'-shin',side+'Knee',[0,0,0],[.14,1,.16],[.12,.15,.17,1],{boneTo:side+'Ankle'});
  garment(side+'-boot',side+'Foot',[.04,.09,0],[.31,.18,.15],[.20,.12,.07,1],{foot:side});
  garment(side+'-arm',side+'Shoulder',[0,0,0],[.14,1,.15],[.18,.26,.22,1],{boneTo:side+'Elbow'});
  garment(side+'-forearm',side+'Elbow',[0,0,0],[.12,1,.13],[.18,.26,.22,1],{boneTo:side+'Hand'});
  garment(side+'-glove',side+'Hand',[0,-.02,0],[.10,.14,.10],[.09,.10,.09,1]);
 }
 const car=generateM3Vehicle();
 for(const part of car.parts){
  const id='car-'+part.id,position=part.position.map((v,i)=>v+CAR_ORIGIN[i]),body=m3PartBody(part,true);
  entities.push({id,position,mesh:part.mesh,...(part.renderMesh?{renderMesh:part.renderMesh}:{}),material:m3PartMaterial(part,[.055,.16,.22,1],true),...(part.rotation?{rotation:part.rotation}:{}),...(body?{body}:{})});
  vehicleParts.push({id,origin:position,...(part.rotation?{rotation:part.rotation}:{}),...(part.wheel?{wheel:true,radius:.346}: {})});
 }
 const wheels=[];
 for(const x of [1.535932,-1.300873])for(const z of [-.786994,.786994]){
  const id=`tyre-contact:${x}:${z}`,position=[CAR_ORIGIN[0]+x,.349,CAR_ORIGIN[2]+z];
  // Invisible kinematic contact bodies carry actual tyre mass, rolling speed and load.
  entities.push({id,position,body:{mass:425,motion:'kinematic',collisionSize:[.02,.02,.02],friction:.75}});
  wheels.push({entityId:id,radius:.346,lateral:[0,0,Math.sign(z)]});
  vehicleParts.push({id,origin:position,wheel:true,radius:.346});
 }
 return{vehicleParts,obstacles,spec:{version:1,seed:20261001,ground:-100,
  environment:{temperatureC:-1,snowfall:'none',sunlight:.55,humidity:.78,wind:[.8,0,.2],clock:{startHour:15,hoursPerSecond:0}},
  rendering:{sunDirection:[-.48,.44,-.25],sunColor:[1,.84,.66],sunIntensity:2.4,skyColor:[.27,.38,.51],exposure:1.08,shadowExtent:22,fogDensity:.002},
  camera:{position:[-11,2.5,6],target:[-6,1,2],fov:55},
  animation:{walkers:[{id:'walker',root:[-8,.16,3],heading:0,speed:0,period:1.3,bindings}]},
  surfaceContacts:{snow:[{surfaceId:'path',tileSize:3,coarseCellSize:.16,detailedCellSize:.04,maxTiles:32,maxDetailedTiles:12}],wheels},entities}};
}

/** Both movement and the camera see the car's current bounds, never a stale parked proxy. */
export function walkingWorld(scene,obstacles){
 const query=()=>{
  const car=scene.entities.get('car-body')?.position;
  return new WalkWorld([...obstacles,...(car?[{min:[car[0]-2.4,car[1],car[2]-.99],max:[car[0]+2.4,car[1]+1.47,car[2]+.99]}]:[])],BOUNDS);
 };
 return{move:(...args)=>query().move(...args),camera:(...args)=>query().camera(...args)};
}
