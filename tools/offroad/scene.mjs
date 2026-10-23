import {generateDetailedThreeBoxBody,generateDetailedThreeBoxGlass,M3_DETAILED_BODY_PARAMETERS} from '../../dist/vehicles/m3-detailed-procedural.js';
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

const offroadBodyParams={
 ...M3_DETAILED_BODY_PARAMETERS,
 dimensions:{width:2.02,length:5.02,height:1.78,wheelbase:2.95,track:1.80,wheelRadius:.54,axleOffset:0,clearance:.34,rideHeight:.61},
 side:[
  [-.5,.90,.55,.98],[-.42,.97,.59,.91],[-.30,1.00,.62,.88],[-.10,.995,.62,.87],
  [.08,.995,.61,.88],[.23,1.00,.61,.89],[.37,.995,.59,.94],[.47,.955,.53,.98],[.5,.89,.50,1],
 ],
 roof:[[-.30,.72,.94],[-.22,.74,.98],[-.05,.75,.995],[.08,.74,.985],[.12,.70,.94]],
 cowl:.22,rearGlassBase:-.42,quarterWindowEnd:-.30,quarterKick:.055,frontDoorRear:-.06,rearDoorRear:-.27,
 endRound:.46,archClearance:.055,archFlare:.055,shoulder:.22,roofCrown:.055,hoodCrown:.032,hoodRidge:.03,panelGap:.006,
 sculpt:{...M3_DETAILED_BODY_PARAMETERS.sculpt,rockerHeight:.13,lowerWidth:.975,sideTaper:1.12,rearEndRound:.28,rearFloorRise:.16,rearWaist:.055,rearGlassInset:.09,roofRailDrop:.032,roofRailOutset:.025,faceting:.18,bumperDepth:.075,fenderCrown:.038},
};
const wheelVisual={radius:.54,width:.42,rimRatio:.56,spokes:8,split:0,dish:.042,treadBlocks:48,treadDepthM:.038,deflectionM:.072,sidewallBulge:.14};
const paint=[.105,.155,.072,1],rubber=[.018,.016,.013,1],rim=[.31,.33,.32,1];
function translated(mesh,offset){return{...mesh,positions:mesh.positions.map((v,i)=>v+offset[i%3])};}
const bodyMesh=translated(generateDetailedThreeBoxBody(offroadBodyParams),[0,-.99,0]);
const glassMesh=generateDetailedThreeBoxGlass(offroadBodyParams);
const visualBindings=[];
function addWheelVisual(id,partId,x,z,side){
 const wheel=detailedOffroadWheelMeshes(wheelVisual,side),y=.54-1.04;
 entities.push({id:id+'-tyre',renderOnly:true,mesh:wheel.tire,material:{kind:'rubber',color:rubber,roughness:.96,pattern:'rubber'}});
 entities.push({id:id+'-rim',renderOnly:true,mesh:wheel.rim,material:{kind:'aluminum',color:rim,roughness:.22,metalness:.96}});
 visualBindings.push({entityId:id+'-tyre',assemblyId:'offroad',partId,wheelRole:'tyre',localPosition:[x,y,z]});
 visualBindings.push({entityId:id+'-rim',assemblyId:'offroad',partId,wheelRole:'rim',localPosition:[x,y,z]});
}

const invisible={kind:'triangle-mesh',positions:[0,0,0,0,0,0,0,0,0],normals:[0,1,0,0,1,0,0,1,0],indices:[0,1,2]};
const entities=[{id:'terrain',position:[0,0,0],mesh:terrain,material:{kind:'default',color:[1,1,1,1],roughness:.96,finish:'rough',ageYears:18}}];

const mudShape=[[-8,-3.45],[-6.2,-3.95],[-3,-3.62],[.5,-4.08],[3.7,-3.68],[7.9,-3.38],[8,3.28],[5.8,3.84],[2.2,3.52],[-1.7,4.02],[-5.1,3.66],[-8,3.38]];
const mudGrid=polygonSurfaceGrid(mudShape,.22),mudRender={...mudGrid,positions:mudGrid.positions.map((v,i)=>i%3===1?v+.015:v)};
entities.push({id:'track-mud',position:[-16,.135,0],mesh:{kind:'polygon-prism',points:mudShape,thickness:.03,axis:1},renderMesh:mudRender,material:{kind:'default',color:[.18,.095,.038,1],roughness:.88,finish:'rough',ageYears:75},body:{},environmental:{surfaceUse:'road',waterDepthM:.016}});

const waterShape=[[-6,-3.45],[-3,-3.75],[0,-3.58],[3.2,-3.8],[6,-3.38],[6,3.38],[2.7,3.72],[-.4,3.55],[-3.4,3.82],[-6,3.42]];
entities.push({id:'track-water-contact',position:[14,.235,0],mesh:{kind:'polygon-prism',points:waterShape,thickness:.03,axis:1},renderMesh:invisible,material:{kind:'default',color:[.14,.09,.045,1],roughness:.78,finish:'rough',ageYears:65},body:{},environmental:{surfaceUse:'road',waterDepthM:.05}});
const waterGrid=polygonSurfaceGrid(waterShape,.18),waterSurface={...waterGrid,positions:waterGrid.positions.map((v,i)=>i%3===1?v+.012:v)};
entities.push({id:'water-sheet',position:[14,.282,0],renderOnly:true,mesh:waterSurface,material:{kind:'glass',color:[.16,.28,.31,.38],roughness:.028,clearcoat:1,clearcoatRoughness:.025}});

const addSlope=(id,x0,y0,x1,y1)=>{
 const dx=x1-x0,dy=y1-y0,length=Math.hypot(dx,dy),angle=Math.atan2(dy,dx),normal=[-Math.sin(angle),Math.cos(angle)],thickness=.20;
 entities.push({id,position:[(x0+x1)/2-normal[0]*thickness/2,(y0+y1)/2-normal[1]*thickness/2,0],rotation:[0,0,angle],mesh:{kind:'box',size:[length+.08,thickness,8]},renderMesh:invisible,material:{kind:'default'},body:{}});
};
addSlope('track-rise',-8,.15,2,1.02);
addSlope('track-gravel',2,1.02,8,.25);
addSlope('track-rock-rise',20,.25,32,1.18);
entities.push({id:'track-dry-exit',position:[38,1.08,0],mesh:{kind:'box',size:[12,.20,8]},renderMesh:invisible,material:{kind:'default'},body:{}});

for(const [x,z,r] of [[-33,-9,.85],[-27,11,.58],[3,-12,.72],[27,12,.92],[36,-10,.64],[23,-8,.45]])entities.push({id:'rock-'+x+'-'+z,position:[x,r*.42,z],scale:[1.15,.78,.95],mesh:{kind:'sphere',radius:r,segments:14},material:{kind:'concrete',color:[.26,.245,.205,1],roughness:.95},body:{}});

const chassisMass=2180,wheelMass=49,totalMass=chassisMass+wheelMass*4;
const wheel=(id,at,steer=0)=>({id,kind:'wheel',at,massKg:wheelMass,radiusM:.54,widthM:.42,suspension:{restM:.41,travelM:.29,springNPerM:43500,damperNsPerM:5700},tyre:{pressurePa:118000,referencePressurePa:240000,radialStiffnessNPerM:175000,radialDampingNsPerM:3000,maxDeflectionM:.105},driveTorqueNm:900,brakeTorqueNm:1380,steerRad:steer,grip:1.34,treadDepthM:.022});
const vehicle={chassis:{massKg:chassisMass,sizeM:[5.02,1.42,2.02],dragAreaM2:1.22},parts:[
 wheel('wheel.front.left',[1.475,-.20,-.92],.54),wheel('wheel.front.right',[1.475,-.20,.92],.54),
 wheel('wheel.rear.left',[-1.475,-.20,-.92]),wheel('wheel.rear.right',[-1.475,-.20,.92]),
]};
entities.push({id:'offroad',position:[-19,1.30,0],mesh:{kind:'box',size:[5.02,1.42,2.02]},renderMesh:bodyMesh,material:{kind:'steel',color:paint,roughness:.28,metalness:.10,treatment:'painted',clearcoat:.82,clearcoatRoughness:.085},body:{mass:totalMass,shape:'box',collisionSize:[5.02,1.42,2.02],velocity:[5.0,0,0],friction:.74,restitution:.02}});
entities.push({id:'offroad-glass',renderOnly:true,mesh:glassMesh,material:{kind:'glass',color:[.055,.105,.12,.30],roughness:.035,pattern:'window'}});
visualBindings.push({entityId:'offroad-glass',assemblyId:'offroad',localPosition:[0,-.99,0]});
const front=offroadBodyParams.dimensions.wheelbase/2,rear=-front,halfTrack=offroadBodyParams.dimensions.track/2;
addWheelVisual('offroad-front-left','wheel.front.left',front,-halfTrack,-1);
addWheelVisual('offroad-front-right','wheel.front.right',front,halfTrack,1);
addWheelVisual('offroad-rear-left','wheel.rear.left',rear,-halfTrack,-1);
addWheelVisual('offroad-rear-right','wheel.rear.right',rear,halfTrack,1);

export default{
 version:1,seed:90421,ground:-4,gravity:[0,-9.81,0],clearColor:[.36,.47,.52,1],
 camera:{position:[-15,2.05,6.4],target:[-17,.68,0],fov:46},
 cameraRail:{durationSeconds:7.5,keyframes:[
  {position:[-14.8,1.95,6.1],target:[-17,.62,0]},
  {position:[-.5,2.65,7.1],target:[-3,.82,0]},
  {position:[13.5,1.82,5.7],target:[10.8,.58,0]},
  {position:[27,2.55,7.0],target:[24.5,.92,0]},
 ]},
 rendering:{sunDirection:[-.48,.70,-.31],sunColor:[1,.91,.78],skyColor:[.40,.53,.60],sunIntensity:1.35,exposure:1.02,shadowExtent:115,fogDensity:.0023,fogColor:[.45,.54,.56],reflectionProbe:{entity:'offroad',offset:[0,.45,0],radius:38,exclude:['offroad','offroad-glass','offroad-front-left-tyre','offroad-front-left-rim','offroad-front-right-tyre','offroad-front-right-rim','offroad-rear-left-tyre','offroad-rear-left-rim','offroad-rear-right-tyre','offroad-rear-right-rim','water-sheet'],facesPerFrame:6,boxHalfExtents:[34,13,24]}},
 fluids:[{id:'water-crossing',shape:'box',center:[14,.275,0],sizeM:[11.7,.05,7.1],densityKgM3:998.2,velocity:[0,0,0],dragCoefficient:1.05}],
 soilVolumes:[{id:'mud-soil',center:[-16,.15,0],sizeM:[16,8],cells:[32,18],pressureScalePa:56000,sinkageExponent:.86,maxSinkageM:.29,cohesionPa:3600,frictionAngleDeg:21,compactionRatePerSecond:.82,rollingResistance:.095}],
 vehicleAssemblies:[{entityId:'offroad',vehicle,controls:{throttle:.55}}],
 vehicleVisuals:visualBindings,
 entities,
};
