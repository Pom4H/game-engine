import {compileDoubleCabPickupVehicle,PICKUP_CANOPY_VEHICLE_DEFINITION} from '../../dist/index.js';
import {hillyTerrainMesh} from '../../dist/procedural/terrain.js';
import {detailedOffroadWheelMeshes} from '../../dist/vehicles/offroad-wheel.js';

const terrain=hillyTerrainMesh({size:[92,58],segments:[92,58],amplitudeM:1.35,baseHeightM:-.42,wavelengthM:34,seed:90421,irregularity:.28});
const offroadDef={
 ...PICKUP_CANOPY_VEHICLE_DEFINITION,
 id:'offroad-double-cab',
 dimensions:{...PICKUP_CANOPY_VEHICLE_DEFINITION.dimensions,track:1.78,wheelRadius:.49,clearance:.30},
 wheel:{...PICKUP_CANOPY_VEHICLE_DEFINITION.wheel,width:.37,rimRatio:.61,spokes:8,dish:.038},
};
const pickup=compileDoubleCabPickupVehicle(offroadDef);
const wheelVisual={radius:.49,width:.37,rimRatio:.61,spokes:8,split:0,dish:.038,treadBlocks:44,treadDepthM:.032,deflectionM:.057,sidewallBulge:.10};
const paint=[.18,.24,.13,1],glass=[.07,.11,.12,.72],rubber=[.025,.022,.018,1],rim=[.34,.36,.35,1];

function mergedVehicle(){
 const positions=[],normals=[],indices=[],colors=[];
 const add=(mesh,offset,color)=>{
  if(mesh.kind!=='triangle-mesh')return;
  const base=positions.length/3;
  for(let i=0;i<mesh.positions.length;i+=3){positions.push(mesh.positions[i]+offset[0],mesh.positions[i+1]+offset[1],mesh.positions[i+2]+offset[2]);normals.push(mesh.normals[i],mesh.normals[i+1],mesh.normals[i+2]);colors.push(...color);}
  for(const index of mesh.indices)indices.push(base+index);
 };
 const yShift=-1.03;
 for(const part of pickup.parts)if(part.id==='body'||part.id==='glass')add(part.mesh,[part.position[0],part.position[1]+yShift,part.position[2]],part.id==='glass'?glass:paint);
 const front=offroadDef.dimensions.wheelbase/2+offroadDef.dimensions.axleOffset,rear=-offroadDef.dimensions.wheelbase/2+offroadDef.dimensions.axleOffset;
 for(const x of [front,rear])for(const [z,side] of [[-offroadDef.dimensions.track/2,-1],[offroadDef.dimensions.track/2,1]]){const w=detailedOffroadWheelMeshes(wheelVisual,side);add(w.tire,[x,.49+yShift,z],rubber);add(w.rim,[x,.49+yShift,z],rim);}
 return{kind:'triangle-mesh',positions,normals,indices,colors};
}

const entities=[{id:'terrain',position:[0,0,0],mesh:terrain,material:{kind:'default',color:[.24,.31,.15,1],roughness:.98,finish:'rough',ageYears:18}}];
const addSurface=(id,x,length,top,material,environmental)=>entities.push({id,position:[x,top-.11,0],mesh:{kind:'box',size:[length,.22,8]},material,body:{},...(environmental?{environmental}:{})});
const addSlope=(id,x0,y0,x1,y1,material)=>{
 const dx=x1-x0,dy=y1-y0,length=Math.hypot(dx,dy),angle=Math.atan2(dy,dx),normal=[-Math.sin(angle),Math.cos(angle)],thickness=.22;
 entities.push({id,position:[(x0+x1)/2-normal[0]*thickness/2,(y0+y1)/2-normal[1]*thickness/2,0],rotation:[0,0,angle],mesh:{kind:'box',size:[length+.06,thickness,8]},material,body:{}});
};
const dirt={kind:'default',color:[.25,.17,.085,1],roughness:.98,finish:'rough',ageYears:45};
const mud={kind:'default',color:[.17,.095,.045,1],roughness:.86,finish:'rough',ageYears:70};
const gravel={kind:'concrete',color:[.29,.285,.25,1],roughness:.98,finish:'rough',ageYears:20};
const wet={kind:'default',color:[.11,.095,.07,1],roughness:.72,finish:'rough',ageYears:55};
addSurface('track-mud',-16,16,.15,mud,{surfaceUse:'road',waterDepthM:.014});
addSlope('track-rise',-8,.15,2,1.02,dirt);
addSlope('track-gravel',2,1.02,8,.25,gravel);
addSurface('track-water',14,12,.25,wet,{surfaceUse:'road',waterDepthM:.035});
addSlope('track-rock-rise',20,.25,32,1.18,gravel);
addSurface('track-dry-exit',38,12,1.18,dirt);
for(const [x,z,r] of [[-31,-9,.8],[-26,11,.55],[2,-12,.7],[27,12,.9],[35,-10,.6]])entities.push({id:'rock-'+x+'-'+z,position:[x,r*.45,z],mesh:{kind:'sphere',radius:r,segments:12},material:{kind:'concrete',color:[.28,.27,.23,1],roughness:.96},body:{}});

const chassisMass=2100,wheelMass=44,totalMass=chassisMass+wheelMass*4;
const wheel=(id,at,steer=0)=>({id,kind:'wheel',at,massKg:wheelMass,radiusM:.49,widthM:.37,suspension:{restM:.36,travelM:.25,springNPerM:45000,damperNsPerM:5200},tyre:{pressurePa:135000,referencePressurePa:240000,radialStiffnessNPerM:180000,radialDampingNsPerM:2800,maxDeflectionM:.085},driveTorqueNm:760,brakeTorqueNm:1200,steerRad:steer,grip:1.28,treadDepthM:.018});
const vehicle={chassis:{massKg:chassisMass,sizeM:[5.25,1.18,1.95],dragAreaM2:1.15},parts:[
 wheel('wheel.front.left',[1.61,-.18,-.86],.52),wheel('wheel.front.right',[1.61,-.18,.86],.52),
 wheel('wheel.rear.left',[-1.61,-.18,-.86]),wheel('wheel.rear.right',[-1.61,-.18,.86]),
]};
entities.push({id:'offroad',position:[-19,1.25,0],mesh:{kind:'box',size:[5.25,1.18,1.95]},renderMesh:mergedVehicle(),material:{kind:'steel',color:[1,1,1,1],roughness:.48,metalness:.08},body:{mass:totalMass,velocity:[5.2,0,0],friction:.72,restitution:.02}});

export default{
 version:1,seed:90421,ground:-4,gravity:[0,-9.81,0],clearColor:[.46,.57,.62,1],
 rendering:{sunDirection:[-.42,.74,-.36],sunColor:[1,.94,.84],skyColor:[.47,.60,.68],sunIntensity:1.15,exposure:1.05,shadowExtent:110,fogDensity:.0035,fogColor:[.53,.62,.65]},
 soilVolumes:[{id:'mud-soil',center:[-16,.15,0],sizeM:[16,8],cells:[24,14],pressureScalePa:62000,sinkageExponent:.88,maxSinkageM:.24,cohesionPa:4200,frictionAngleDeg:23,compactionRatePerSecond:.75,rollingResistance:.085}],
 vehicleAssemblies:[{entityId:'offroad',vehicle,controls:{throttle:.48}}],
 entities,
};
