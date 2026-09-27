import {vehicle,wheel,wing,Vehicle} from '../dist/vehicles/vehicle.js';
import {PhysicsWorld} from '../dist/physics/world.js';
import {M3_DETAILED_BODY_PARAMETERS} from '../dist/vehicles/m3-detailed-procedural.js';

/** Demonstration calibration, not a claim to reproduce a measured BMW or 1:64 mechanics. */
export function carBlueprint({wings=true,id='vehicle',wearEnergyJ=2e7,wingCondition={},incidenceRad=.20}={}){
 const d=M3_DETAILED_BODY_PARAMETERS.dimensions;
 const wheels=[];
 for(const [axle,x] of [['front',d.wheelbase/2],['rear',-d.wheelbase/2]])for(const [side,z] of [['left',-d.track/2],['right',d.track/2]])wheels.push(wheel(`${axle}.${side}`,{
  at:[x,0,z],massKg:20,radiusM:d.wheelRadius,widthM:.30,
  suspension:{restM:.50,travelM:.25,springNPerM:35000,damperNsPerM:3200,yieldForceN:30000},
  driveTorqueNm:axle==='rear'?2400:0,drivePowerW:140000,brakeTorqueNm:2000,steerRad:axle==='front'?.5:0,
  condition:{wearEnergyJ,heatCapacityJPerK:20000},
 }));
 return vehicle(id,{chassis:{massKg:1500,sizeM:[d.length,.65,d.width],dragAreaM2:.75},parts:[...wheels,...(wings?[-1,1].map(sign=>wing(sign<0?'wing.left':'wing.right',{
  at:[0,0,sign*2.8],massKg:25,spanM:4,chordM:1.6,incidenceRad,zeroLiftRad:0,
  control:'flap',controlGainRad:.20,condition:wingCondition,
 })):[])]});
}
export function fixture(options={},pose={},runtimeOptions={}){
 const world=new PhysicsWorld(),blueprint=carBlueprint(options),car=new Vehicle(world,blueprint,{position:[0,.75,0],...pose},runtimeOptions);
 return{world,car,blueprint};
}
