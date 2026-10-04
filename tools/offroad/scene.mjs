import {compileDoubleCabPickupVehicle,PICKUP_CANOPY_VEHICLE_DEFINITION} from '../../dist/index.js';
import {hillyTerrainMesh,polygonSurfaceGrid} from '../../dist/procedural/terrain.js';
import {detailedOffroadWheelMeshes} from '../../dist/vehicles/offroad-wheel.js';

const corridorPoints=[[-25,.15,0],[-8,.15,0],[2,1.02,0],[8,.25,0],[20,.25,0],[32,1.18,0],[45,1.18,0]];
const terrainBase=hillyTerrainMesh({size:[104,66],segments:[112,72],amplitudeM:1.75,baseHeightM:-.48,wavelengthM:37,seed:90421,irregularity:.31,corridors:[{points:corridorPoints,halfWidthM:4.0,shoulderM:5.5}]});
const mix=(a,b,t)=>a.map((v,i)=>v+(b[i]-v)*t),smooth=(a,b,x)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};
const trackColor=x=>x<-8?[.19,.105,.045,1]:x<2?[.27,.18,.085,1]:x<8?[.34,.32,.27,1]:x<20?[.13,.095,.055,1]:x<32?[.30,.27,.20,1]:[.26,.17,.075,1];
const colors=[];
for(let i=0;i<terrainBase.positions.length;i+=3){
 const x=terrainBase.positions[i],z=terrainBase.positions[i+2],noise=.5+.5*Math.sin(x*.73+Math.sin(z*.91)*1.7),grass=[.16+.045*noise,.245+.06*noise,.085+.025*noise,1],blend=1-smooth(3.7,8.5,Math.abs(z));
 colors.push(...mix(grass,trackColor(x),blend));
}
const terrain={...terrainBase,colors};

const offroadDef={...PICKUP_CANOPY_VEHICLE_DEFINITION,id:'offroad-double-cab',dimensions:{...PICKUP_CANOPY_VEHICLE_DEFINITION.dimensions,track:1.86,wheelRadius:.54,clearance:.34},wheel:{...PICKUP_CANOPY_VEHICLE_DEFINITION.wheel,width:.42,rimRatio:.56,spokes:8,dish:.042}};
const pickup=compileDoubleCabPickupVehicle(offroadDef);
const wheelVisual={radius:.54,width:.42,rimRatio:.56,spokes:8,split:0,dish:.042,treadBlocks:48,treadDepthM:.038,deflectionM:.072,sidewallBulge:.14};
const paint=[.12,.18,.085,1],glass=[.055,.09,.095,.72],rubber=[.018,.016,.013,1],rim=[.31,.33,.32,1];

function mergedVehicle(){
 const positions=[],normals=[],indices=[],colors=[],add=(mesh,offset,color)=>{
  if(mesh.kind!=='triangle-mesh')return;
  const base=positions.length/3;
  for(let i=0;i<mesh.positions.length;i+=3){positions.push(mesh.positions[i]+offset[0],mesh.positions[i+1]+offset[1],mesh.positions[i+2]+offset[2]);normals.push(mesh.normals[i],mesh.normals[i+1],mesh.normals[i+2]);colors.push(...color);}
  for(const index of mesh.indices)indices.push(base+index);
 };
 const yShift=-1.04;
 for(const part of pickup.parts)if(part.id==='body'||part.id==='glass')add(part.mesh,[part.position[0],part.position[1]+yShift,part.position[2]],part.id==='glass'?glass:paint);
 const front=offroadDef.dimensions.wheelbase/2,rear=-front;
 for(const x of [front,rear])for(const [z,side] of [[-offroadDef.dimensions.track/2,-1],[offroadDef.dimensions.track/2,1]]){const w=detailedOffroadWheelMeshes(wheelVisual,side);add(w.tire,[x,.54+yShift,z],rubber);add(w.rim,[x,.54+yShift,z],rim);}
 return{kind:'triangle-mesh',positions,normals,indices,colors};
}

const invisible={kind:'triangle-mesh',positions:[0,0,0,0,0,0,0,0,0],normals:[0,1,0,0,1,0,0,1,0],indices:[0,1,2]};
const entities=[{id:'terrain',position:[0,0,0],mesh:terrain,material:{kind:'default',color:[1,1,1,1],roughness:.96,finish:'rough',ageYears:18}}];

const mudShape=[[-8,-3.45],[-6.2,-3.95],[-3,-3.62],[.5,-4.08],[3.7,-3.68],[7.9,-3.38],[8,3.28],[5.8,3.84],[2.2,3.52],[-1.7,4.02],[-5.1,3.66],[-8,3.38]];
entities.push({id:'track-mud',position:[-16,.135,0],mesh:{kind:'polygon-prism',points:mudShape,thickness:.03,axis:1},renderMesh:polygonSurfaceGrid(mudShape,.22),material:{kind:'default',color:[.18,.095,.038,1],roughness:.88,finish:'rough',ageYears:75},body:{},environmental:{surfaceUse:'road',waterDepthM:.016}});

const waterShape=[[-6,-3.45],[-3,-3.75],[0,-3.58],[3.2,-3.8],[6,-3.38],[6,3.38],[2.7,3.72],[-.4,3.55],[-3.4,3.82],[-6,3.42]];
entities.push({id:'track-water-contact',position:[14,.235,0],mesh:{kind:'polygon-prism',points:waterShape,thickness:.03,axis:1},renderMesh:invisible,material:{kind:'default',color:[.14,.09,.045,1],roughness:.78,finish:'rough',ageYears:65},body:{},environmental:{surfaceUse:'road',waterDepthM:.05}});
entities.push({id:'water-sheet',position:[14,.282,0],mesh:{kind:'box',size:[11.7,.045,7.15]},material:{kind:'glass',color:[.18,.31,.34,.42],roughness:.035,clearcoat:1,clearcoatRoughness:.025}});

const addSlope=(id,x0,y0,x1,y1)=>{
 const dx=x1-x0,dy=y1-y0,length=Math.hypot(dx,dy),angle=Math.atan2(dy,dx),normal=[-Math.sin(angle),Math.cos(angle)],thickness=.20;
 entities.push({id,position:[(x0+x1)/2-normal[0]*thickness/2,(y0+y1)/2-normal[1]*thickness/2,0],rotation:[0,0,angle],mesh:{kind:'box',size:[length+.08,thickness,8]},renderMesh:invisible,material:{kind:'default'},body:{}});
};
addSlope('track-rise',-8,.15,2,1.02);
addSlope('track-gravel',2,1.02,8,.25);
addSlope('track-rock-rise',20,.25,32,1.18);
entities.push({id:'track-dry-exit',position:[38,1.08,0],mesh:{kind:'box',size:[12,.20,8]},renderMesh:invisible,material:{kind:'default'},body:{}});

for(const [x,z,r] of [[-33,-9,.85],[-27,11,.58],[3,-12,.72],[27,12,.92],[36,-10,.64],[23,-8,.45]])entities.push({id:'rock-'+x+'-'+z,position:[x,r*.42,z],scale:[1.15,.78,.95],mesh:{kind:'sphere',radius:r,segments:14},material:{kind:'concrete',color:[.26,.245,.205,1],roughness:.95},body:{}});

const chassisMass=2140,wheelMass=49,totalMass=chassisMass+wheelMass*4;
const wheel=(id,at,steer=0)=>({id,kind:'wheel',at,massKg:wheelMass,radiusM:.54,widthM:.42,suspension:{restM:.41,travelM:.29,springNPerM:43000,damperNsPerM:5600},tyre:{pressurePa:118000,referencePressurePa:240000,radialStiffnessNPerM:175000,radialDampingNsPerM:3000,maxDeflectionM:.105},driveTorqueNm:860,brakeTorqueNm:1350,steerRad:steer,grip:1.34,treadDepthM:.022});
const vehicle={chassis:{massKg:chassisMass,sizeM:[5.25,1.24,2.02],dragAreaM2:1.18},parts:[
 wheel('wheel.front.left',[1.61,-.20,-.91],.54),wheel('wheel.front.right',[1.61,-.20,.91],.54),
 wheel('wheel.rear.left',[-1.61,-.20,-.91]),wheel('wheel.rear.right',[-1.61,-.20,.91]),
]};
entities.push({id:'offroad',position:[-19,1.28,0],mesh:{kind:'box',size:[5.25,1.24,2.02]},renderMesh:mergedVehicle(),material:{kind:'steel',color:[1,1,1,1],roughness:.38,metalness:.08,treatment:'painted',clearcoat:.72,clearcoatRoughness:.12},body:{mass:totalMass,shape:'box',collisionSize:[5.25,1.24,2.02],velocity:[5.0,0,0],friction:.74,restitution:.02}});

export default{
 version:1,seed:90421,ground:-4,gravity:[0,-9.81,0],clearColor:[.36,.47,.52,1],
 camera:{position:[-15,2.05,6.4],target:[-17,.68,0],fov:46},
 cameraRail:{durationSeconds:7.5,keyframes:[
  {position:[-14.8,1.95,6.1],target:[-17,.62,0]},
  {position:[-.5,2.65,7.1],target:[-3,.82,0]},
  {position:[13.5,1.82,5.7],target:[10.8,.58,0]},
  {position:[27,2.55,7.0],target:[24.5,.92,0]},
 ]},
 rendering:{sunDirection:[-.48,.70,-.31],sunColor:[1,.91,.78],skyColor:[.40,.53,.60],sunIntensity:1.35,exposure:1.02,shadowExtent:115,fogDensity:.0023,fogColor:[.45,.54,.56],reflectionProbe:{entity:'offroad',offset:[0,.45,0],radius:38,exclude:['offroad','water-sheet'],facesPerFrame:6,boxHalfExtents:[34,13,24]}},
 fluids:[{id:'water-crossing',shape:'box',center:[14,.275,0],sizeM:[11.7,.05,7.1],densityKgM3:998.2,velocity:[0,0,0],dragCoefficient:1.05}],
 soilVolumes:[{id:'mud-soil',center:[-16,.15,0],sizeM:[16,8],cells:[32,18],pressureScalePa:56000,sinkageExponent:.86,maxSinkageM:.29,cohesionPa:3600,frictionAngleDeg:21,compactionRatePerSecond:.82,rollingResistance:.095}],
 vehicleAssemblies:[{entityId:'offroad',vehicle,controls:{throttle:.55}}],
 entities,
};
