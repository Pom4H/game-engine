import {rotor,vehicle,wing,type VehicleBlueprint} from './vehicle.js';

export const LIGHT_HELICOPTER_HOVER_COLLECTIVE=.29;
export const LIGHT_HELICOPTER_MAIN_RPM=400;
export const LIGHT_HELICOPTER_TAIL_RPM=2000;

/** A light four-seat helicopter expressed only as ordinary Vehicle components.
 * +X forward, +Y up, +Z right. No helicopter runtime or second integrator. */
export function lightHelicopter(id='helicopter.light'):VehicleBlueprint{
 return vehicle(id,{
  chassis:{massKg:1100,sizeM:[6.4,2.0,1.75],dragAreaM2:2.7},
  parts:[
   rotor('main.rotor',{
    at:[-.20,1.25,0],massKg:120,radiusM:5.2,bladeChordM:.32,blades:4,
    governorRpm:LIGHT_HELICOPTER_MAIN_RPM,maxPowerW:600_000,spoolSeconds:1.2,
    axis:[0,1,0],forward:[1,0,0],direction:1,
    collectiveControl:'collective',collectiveTrimRad:0,collectiveGainRad:.12,
    cyclicPitchGainRad:.13,cyclicRollGainRad:.13,liftSlope:5.7,profileDragCoefficient:.011,
    condition:{failureLoadN:55_000,fatigue:{enduranceRangeN:9_000,referenceRangeN:30_000,cyclesAtReference:2e7,exponent:4}},
   }),
   rotor('tail.rotor',{
    at:[-5,1.25,0],massKg:20,radiusM:.95,bladeChordM:.16,blades:2,
    governorRpm:LIGHT_HELICOPTER_TAIL_RPM,maxPowerW:55_000,spoolSeconds:.7,
    axis:[0,0,1],forward:[1,0,0],direction:-1,
    collectiveControl:'yaw',collectiveTrimRad:.078,collectiveGainRad:.05,
    liftSlope:5.7,profileDragCoefficient:.012,
    condition:{failureLoadN:4_000},
   }),
   wing('tail.horizontal',{at:[-4.2,.4,0],massKg:18,spanM:2.1,chordM:.65,normal:[0,1,0],chord:[1,0,0],zeroLiftRad:0,dragCoefficient:.035,stallRad:.3}),
   wing('tail.vertical',{at:[-4.5,.8,0],massKg:12,spanM:1.5,chordM:.72,normal:[0,0,1],chord:[1,0,0],zeroLiftRad:0,dragCoefficient:.04,stallRad:.32}),
  ],
 });
}
