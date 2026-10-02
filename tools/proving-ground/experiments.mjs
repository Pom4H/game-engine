// Pure proving-ground experiment descriptors. They own hypotheses/oracles, not simulation.
// Scene, tests, reports and render views are projections of the same descriptor.
export const experiment=definition=>Object.freeze(definition);

export const observedExperimentCauseLawIds=(records,bodyId)=>Object.freeze([...new Set(
 records.filter(record=>record.type==='physics.contribution'&&record.body_id===bodyId).map(record=>record.law_id)
)].sort());

export function assertExperimentCauseGraph(definition,records,bodyId){
 const observed=observedExperimentCauseLawIds(records,bodyId);
 const expected=[...definition.environment.allowedCauseLawIds].sort();
 if(observed.length!==expected.length||observed.some((law,index)=>law!==expected[index])){
  throw new Error(`Experiment ${definition.id} cause graph diverged: expected [${expected.join(', ')}], observed [${observed.join(', ')}]`);
 }
 return observed;
}

const add=(a,b)=>[a[0]+b[0],a[1]+b[1],a[2]+b[2]];
const scale=(v,s)=>[v[0]*s,v[1]*s,v[2]*s];

const gravity=Object.freeze([0,-9.81,0]);
const initialPosition=Object.freeze([120,60,150]);
const initialVelocity=Object.freeze([7,12,3]);
const angularVelocity=Object.freeze([.3,.5,.2]);
const massKg=100;
const radiusM=.45;
const durationS=4;
const runtimeTickRate=60;

const continuousPositionAt=t=>add(add(initialPosition,scale(initialVelocity,t)),scale(gravity,.5*t*t));
const symplecticPositionAt=(t,dt)=>add(add(initialPosition,scale(initialVelocity,t)),scale(gravity,.5*t*(t+dt)));
const momentumAt=t=>scale(add(initialVelocity,scale(gravity,t)),massKg);
const symplecticEnergyDefectJ=(t,dt)=>-.5*massKg*gravity.reduce((s,v)=>s+v*v,0)*t*dt;

export const gravityFreeFallExperiment=experiment({
 id:'gravity.free-fall',
 title:'Gravity free fall / symplectic Euler',
 domain:'ballistic',
 durationS,
 runtimeTickRate,
 gravity,
 sceneBodyId:'experiment-gravity-free-fall-body',
 environment:Object.freeze({
  gravity,
  atmosphere:'excluded',
  fluids:'excluded',
  contacts:'excluded',
  allowedCauseLawIds:Object.freeze(['gravity.v1']),
 }),
 body:Object.freeze({massKg,radiusM,initialPosition,initialVelocity,angularVelocity}),
 proof:Object.freeze({
  governingRelation:'v[n+1]=v[n]+g*dt; x[n+1]=x[n]+v[n+1]*dt',
  units:'x[m], v[m/s], g[m/s^2], p[kg*m/s], E[J]',
  assumptions:Object.freeze(['constant uniform gravity','vacuum: atmosphere excluded','no fluids','no contacts','no external torque']),
  limitingCase:'dt -> 0 recovers x(t)=x0+v0*t+0.5*g*t^2',
  conservation:'linear momentum changes only by m*g*t; spin angular momentum is constant',
  numericalDissipation:'DeltaE=-0.5*m*|g|^2*t*dt; this is integrator defect, not physical dissipation',
 }),
 continuousPositionAt,
 symplecticPositionAt,
 momentumAt,
 symplecticEnergyDefectJ,
});
const collisionCenter=Object.freeze([150,24,110]);
const collisionRadiusM=.55;
const collisionDurationS=.8;
const collisionTickRate=60;
const collisionA=Object.freeze({id:'experiment-collision-elastic-a',massKg:2,initialPosition:Object.freeze([collisionCenter[0]-2,collisionCenter[1],collisionCenter[2]]),initialVelocity:Object.freeze([6,0,0])});
const collisionB=Object.freeze({id:'experiment-collision-elastic-b',massKg:3,initialPosition:Object.freeze([collisionCenter[0]+2,collisionCenter[1],collisionCenter[2]]),initialVelocity:Object.freeze([-2,0,0])});
const elasticVelocity1D=(m1,u1,m2,u2)=>Object.freeze([
 ((m1-m2)*u1+2*m2*u2)/(m1+m2),
 (2*m1*u1+(m2-m1)*u2)/(m1+m2),
]);
const collisionTimeS=(collisionB.initialPosition[0]-collisionA.initialPosition[0]-2*collisionRadiusM)/(collisionA.initialVelocity[0]-collisionB.initialVelocity[0]);
const collisionFinalVelocityX=elasticVelocity1D(collisionA.massKg,collisionA.initialVelocity[0],collisionB.massKg,collisionB.initialVelocity[0]);
const collisionPositionAt=(bodyIndex,t,dt)=>{
 const body=bodyIndex===0?collisionA:collisionB,tc=Math.min(t,collisionTimeS),post=Math.max(0,t-collisionTimeS),vxAfter=collisionFinalVelocityX[bodyIndex];
 return[
  body.initialPosition[0]+body.initialVelocity[0]*tc+vxAfter*post,
  body.initialPosition[1]+.5*gravity[1]*t*(t+dt),
  body.initialPosition[2],
 ];
};

export const collisionElasticExperiment=experiment({
 id:'collision.elastic',
 title:'Elastic collision / closed horizontal momentum',
 domain:'collision',
 durationS:collisionDurationS,
 runtimeTickRate:collisionTickRate,
 gravity,
 sceneBodyIds:Object.freeze([collisionA.id,collisionB.id]),
 environment:Object.freeze({
  gravity,
  atmosphere:'excluded',
  fluids:'excluded',
  contacts:'required: body-body only',
  allowedCauseLawIds:Object.freeze(['contact-solver.v1','gravity.v1']),
 }),
 bodies:Object.freeze([collisionA,collisionB]),
 radiusM:collisionRadiusM,
 restitution:1,
 friction:0,
 collisionTimeS,
 finalVelocityX:collisionFinalVelocityX,
 positionAt:collisionPositionAt,
 proof:Object.freeze({
  governingRelation:'m1*u1+m2*u2=m1*v1+m2*v2; 0.5*m1*u1^2+0.5*m2*u2^2=0.5*m1*v1^2+0.5*m2*v2^2',
  units:'m[kg], v[m/s], p[kg*m/s], E[J]',
  assumptions:Object.freeze(['central 1D impact','coefficient of restitution e=1','zero friction','uniform gravity perpendicular to collision axis','no atmosphere','no fluids']),
  limitingCase:'m1=m2 exchanges axial velocities',
  conservation:'horizontal linear momentum and horizontal kinetic energy are conserved',
  numericalDissipation:'none is allowed in the axial collision invariant',
 }),
});

const rotationInitialPosition=Object.freeze([165,28,135]);
const rotationAngularVelocity=Object.freeze([1.2,1.8,.7]);
const rotationDurationS=1.5;
const rotationTickRate=60;
const rotationHalfM=.55;
const rotationMassKg=12;
const rotationPositionAt=(t,dt)=>[
 rotationInitialPosition[0],
 rotationInitialPosition[1]+.5*gravity[1]*t*(t+dt),
 rotationInitialPosition[2],
];

export const rotationFreeBodyExperiment=experiment({
 id:'rotation.free-body',
 title:'Torque-free isotropic rigid body',
 domain:'rotation',
 durationS:rotationDurationS,
 runtimeTickRate:rotationTickRate,
 gravity,
 sceneBodyId:'experiment-rotation-free-body',
 environment:Object.freeze({
  gravity,
  atmosphere:'excluded',
  fluids:'excluded',
  contacts:'excluded',
  allowedCauseLawIds:Object.freeze(['gravity.v1']),
 }),
 body:Object.freeze({massKg:rotationMassKg,halfM:rotationHalfM,initialPosition:rotationInitialPosition,initialVelocity:Object.freeze([0,0,0]),angularVelocity:rotationAngularVelocity}),
 positionAt:rotationPositionAt,
 proof:Object.freeze({
  governingRelation:'tau_COM=dL_spin/dt=0; for isotropic inertia I, L_spin=I*omega and omega is constant',
  units:'I[kg*m^2], omega[rad/s], L[N*m*s], E_rot[J]',
  assumptions:Object.freeze(['isotropic cube inertia Ixx=Iyy=Izz','uniform gravity acts through center of mass','vacuum','no contacts','no external torque']),
  limitingCase:'omega=0 remains non-rotating',
  conservation:'spin angular momentum and rotational kinetic energy are constant',
  numericalDissipation:'none is allowed in torque-free rotation',
 }),
});


const rotorRigPosition=Object.freeze([190,45,120]);
const rotorRigVehicle=Object.freeze({
 chassis:{massKg:520,sizeM:[1.6,.5,1.6],dragAreaM2:0},
 parts:[{
  kind:'rotor',id:'proof.rotor',at:[0,0,0],massKg:80,
  radiusM:3,bladeChordM:.25,blades:3,axis:[0,1,0],forward:[1,0,0],direction:1,
  governorRpm:550,maxPowerW:150000,spoolSeconds:1,
  collectiveControl:'collective',collectiveTrimRad:0,collectiveGainRad:.12,
  cyclicPitchGainRad:0,cyclicRollGainRad:0,liftSlope:5.7,profileDragCoefficient:.011,
 }]
});
const rotorRigControls=Object.freeze({throttle:1,collective:.8});
const rotorRigAir=Object.freeze({densityKgM3:1.225,wind:Object.freeze([0,0,0]),temperatureC:15});
const rotorRigMassKg=600;
const rotorForceTickRate=120;
const rotorForceBalanceSteps=240;
const rotorForceBalanceOracle=(steps=rotorForceBalanceSteps,dt=1/rotorForceTickRate)=>{
 const rotor=rotorRigVehicle.parts[0],rho=rotorRigAir.densityKgM3,area=Math.PI*rotor.radiusM**2;
 const target=rotor.governorRpm*Math.PI/30*rotorRigControls.throttle;
 const omega=target*(1-Math.exp(-steps*dt/rotor.spoolSeconds));
 const collective=rotor.collectiveTrimRad+rotorRigControls.collective*rotor.collectiveGainRad;
 const solidity=rotor.blades*rotor.bladeChordM/(Math.PI*rotor.radiusM),ct=solidity*rotor.liftSlope*collective/6,tip=omega*rotor.radiusM;
 const raw=ct*rho*area*tip*tip,profile=(solidity*rotor.profileDragCoefficient/8)*rho*area*tip**3;
 const induced=Math.abs(raw)>0?Math.abs(raw)**1.5/Math.sqrt(2*rho*area):0,available=rotor.maxPowerW*rotorRigControls.throttle;
 const usable=Math.max(0,available-profile),powerScale=profile+induced>available&&induced>0?Math.max(0,Math.min(1,(usable/induced)**(2/3))):1;
 const thrust=raw*powerScale,power=Math.min(available,profile+induced*powerScale**1.5),reactionTorque=-rotor.direction*power/Math.max(1,Math.abs(omega));
 return Object.freeze({omega,collective,area,solidity,raw,profile,induced,powerScale,thrust,power,reactionTorque});
};

export const aeroRotorExperiment=experiment({
 id:'aero.rotor',
 title:'Actuator-disk rotor / scene-owned force driver',
 domain:'aero-rotor',
 durationS:2.4,
 runtimeTickRate:60,
 forceTickRate:rotorForceTickRate,
 forceBalanceSteps:rotorForceBalanceSteps,
 gravity,
 sceneBodyId:'experiment-aero-rotor',
 position:rotorRigPosition,
 massKg:rotorRigMassKg,
 vehicle:rotorRigVehicle,
 controls:rotorRigControls,
 environment:Object.freeze({
  gravity,
  atmosphere:rotorRigAir,
  fluids:'excluded',
  contacts:'excluded',
  allowedCauseLawIds:Object.freeze(['actuator-disk.v2','gravity.v1']),
 }),
 forceBalanceOracle:rotorForceBalanceOracle,
 proof:Object.freeze({
  governingRelation:'T=Ct*rho*A*(omega*R)^2 with induced/profile power limited by authored shaft power; Q=-P/omega',
  units:'rho[kg/m^3], omega[rad/s], T[N], P[W], Q[N*m]',
  assumptions:Object.freeze(['uniform authored atmosphere','single centered horizontal rotor','no chassis drag','no contacts','no ground effect in force-balance stage']),
  limitingCase:'rho->0 or omega->0 yields zero thrust; P cannot exceed maxPowerW',
  conservation:'Scene body is the sole pose owner; rotor contributes one causal wrench through actuator-disk.v2',
  numericalDissipation:'mechanical energy changes must close through the existing causal energy ledger',
 }),
});


const steel={kind:'steel',color:[.62,.66,.72,1],metalness:.72,roughness:.28};
const measured={kind:'steel',color:[.25,.62,1,1],metalness:.65,roughness:.24,emissive:[.04,.12,.24]};
const discrete={kind:'default',color:[.20,1,.48,.72],roughness:.25,emissive:[.08,.55,.18]};
const continuous={kind:'default',color:[1,.56,.16,.72],roughness:.25,emissive:[.55,.16,.03]};
const neutral={kind:'default',color:[.62,.64,.66,1],roughness:.75};
const sphere=(id,position,radius,material)=>({id,position,mesh:{kind:'sphere',radius,segments:32},material});
const box=(id,position,size,material=neutral)=>({id,position,mesh:{kind:'box',size},material});
const crosshair=(id,p,span,material)=>[
 box(`${id}-x`,p,[span,.035,.035],material),
 box(`${id}-y`,p,[.035,span,.035],material),
 box(`${id}-z`,p,[.035,.035,span],material),
];

export function materializeGravityExperimentScene(e=gravityFreeFallExperiment){
 const p0=e.body.initialPosition,dt=1/e.runtimeTickRate,pd=e.symplecticPositionAt(e.durationS,dt),pc=e.continuousPositionAt(e.durationS);
 const entities=[
  sphere(e.sceneBodyId,p0,e.body.radiusM,measured),
  sphere('experiment-gravity-free-fall-start',p0,e.body.radiusM*1.18,{...neutral,color:[.75,.78,.82,.22]}),
  sphere('experiment-gravity-free-fall-oracle-discrete',pd,e.body.radiusM*.62,discrete),
  sphere('experiment-gravity-free-fall-oracle-continuous',pc,e.body.radiusM*.62,continuous),
  box('experiment-gravity-free-fall-ruler',[pd[0]+2,(pd[1]+pc[1])/2,pd[2]],[.055,2.2,.055],steel),
 ];
 const deltaY=Math.abs(pc[1]-pd[1]),deltaMidY=(pc[1]+pd[1])/2,bracketX=pd[0]+1.1;
 entities.push(...crosshair('experiment-gravity-free-fall-crosshair-discrete',pd,1.25,discrete));
 entities.push(...crosshair('experiment-gravity-free-fall-crosshair-continuous',pc,.92,continuous));
 entities.push(box('experiment-gravity-free-fall-error-vector',[bracketX,deltaMidY,pd[2]],[.045,deltaY,.045],continuous));
 entities.push(box('experiment-gravity-free-fall-error-lower',[bracketX,pd[1],pd[2]],[.65,.035,.035],discrete));
 entities.push(box('experiment-gravity-free-fall-error-upper',[bracketX,pc[1],pd[2]],[.65,.035,.035],continuous));
 entities[0]={...entities[0],body:{mass:e.body.massKg,velocity:e.body.initialVelocity,angularVelocity:e.body.angularVelocity,restitution:0,friction:0}};
 for(let i=1;i<=8;i++){
  const t=e.durationS*i/8;
  entities.push(sphere(`experiment-gravity-free-fall-trace-discrete-${i}`,e.symplecticPositionAt(t,dt),.09,discrete));
  entities.push(sphere(`experiment-gravity-free-fall-trace-continuous-${i}`,e.continuousPositionAt(t),.07,continuous));
 }
 for(let i=-5;i<=5;i++)entities.push(box(`experiment-gravity-free-fall-ruler-tick-${i+5}`,[pd[0]+2,pd[1]+i*.2,pd[2]],[.42,.018,.018],steel));
 const mid=[(p0[0]+pd[0])/2,(p0[1]+pd[1])/2,(p0[2]+pd[2])/2];
 entities.push(box('experiment-gravity-free-fall-label-rail',[mid[0]-3,mid[1],mid[2]-2],[.08,Math.abs(p0[1]-pd[1])+6,.08],steel));
 entities.push(box('experiment-gravity-free-fall-base',[pd[0]+2,pd[1]-1.15,pd[2]],[1.2,.08,1.2],neutral));
 return entities;
}


export function materializeCollisionExperimentScene(e=collisionElasticExperiment){
 const dt=1/e.runtimeTickRate,pa=e.positionAt(0,e.durationS,dt),pb=e.positionAt(1,e.durationS,dt);
 const entities=[
  sphere(e.sceneBodyIds[0],e.bodies[0].initialPosition,e.radiusM,measured),
  sphere(e.sceneBodyIds[1],e.bodies[1].initialPosition,e.radiusM,measured),
  sphere('experiment-collision-elastic-start-a',e.bodies[0].initialPosition,e.radiusM*1.08,{...neutral,color:[.75,.78,.82,.18]}),
  sphere('experiment-collision-elastic-start-b',e.bodies[1].initialPosition,e.radiusM*1.08,{...neutral,color:[.75,.78,.82,.18]}),
  ...crosshair('experiment-collision-elastic-oracle-a',pa,1.0,discrete),
  ...crosshair('experiment-collision-elastic-oracle-b',pb,1.0,continuous),
  box('experiment-collision-elastic-axis',[collisionCenter[0],collisionCenter[1]-1.1,collisionCenter[2]],[12,.04,.04],steel),
 ];
 entities[0]={...entities[0],body:{mass:e.bodies[0].massKg,velocity:e.bodies[0].initialVelocity,restitution:e.restitution,friction:e.friction}};
 entities[1]={...entities[1],body:{mass:e.bodies[1].massKg,velocity:e.bodies[1].initialVelocity,restitution:e.restitution,friction:e.friction}};
 return entities;
}

export function materializeRotationExperimentScene(e=rotationFreeBodyExperiment){
 const dt=1/e.runtimeTickRate,pf=e.positionAt(e.durationS,dt),size=e.body.halfM*2;
 return[
  {id:e.sceneBodyId,position:e.body.initialPosition,mesh:{kind:'box',size:[size,size,size]},material:measured,body:{mass:e.body.massKg,velocity:e.body.initialVelocity,angularVelocity:e.body.angularVelocity,restitution:0,friction:0}},
  box('experiment-rotation-free-body-start',e.body.initialPosition,[size*1.06,size*1.06,size*1.06],{...neutral,color:[.75,.78,.82,.16]}),
  ...crosshair('experiment-rotation-free-body-oracle-com',pf,1.2,discrete),
  box('experiment-rotation-free-body-omega-x',[pf[0]+1.4,pf[1],pf[2]],[Math.abs(e.body.angularVelocity[0]),.05,.05],continuous),
  box('experiment-rotation-free-body-omega-y',[pf[0]+1.4,pf[1]+.7,pf[2]],[.05,Math.abs(e.body.angularVelocity[1]),.05],continuous),
  box('experiment-rotation-free-body-omega-z',[pf[0]+1.4,pf[1]+1.6,pf[2]],[.05,.05,Math.abs(e.body.angularVelocity[2])],continuous),
 ];
}

export function materializeRotorExperimentScene(e=aeroRotorExperiment){
 const chassis=e.vehicle.chassis.sizeM,rotor=e.vehicle.parts[0];
 return[
  {
   id:e.sceneBodyId,position:e.position,
   mesh:{kind:'box',size:chassis},
   renderMesh:{kind:'cylinder',radius:rotor.radiusM,height:.14,segments:64},
   material:measured,
   body:{mass:e.massKg,collisionSize:chassis,restitution:0,friction:0},
  },
  {id:'experiment-aero-rotor-start-ring',position:e.position,mesh:{kind:'torus',radius:rotor.radiusM,tube:.045,segments:64},material:{...neutral,color:[.75,.78,.82,.28]}},
  box('experiment-aero-rotor-axis',[e.position[0],e.position[1]+2.2,e.position[2]],[.07,4.4,.07],continuous),
 ];
}

export const experimentVehicleAssemblies=Object.freeze([{
 entityId:aeroRotorExperiment.sceneBodyId,
 vehicle:aeroRotorExperiment.vehicle,
 controls:aeroRotorExperiment.controls,
 air:aeroRotorExperiment.environment.atmosphere,
}]);

export const experimentSceneEntities=Object.freeze([
 ...materializeGravityExperimentScene(),
 ...materializeCollisionExperimentScene(),
 ...materializeRotationExperimentScene(),
 ...materializeRotorExperimentScene(),
]);
export const experimentViews=Object.freeze([
 {
  name:'proving-ground-gravity-free-fall',
  output:'artifacts/proving-ground-gravity-free-fall.png',
  time:gravityFreeFallExperiment.durationS,
  camera:{position:[181,72,204],target:[135,44,156],fov:43,aperture:0},
 },
 {
  name:'proving-ground-gravity-free-fall-measurement',
  output:'artifacts/proving-ground-gravity-free-fall-measurement.png',
  time:gravityFreeFallExperiment.durationS,
  camera:{position:[155,33.5,171],target:[148,29.35,162],fov:27,aperture:0},
 },
 {
  name:'proving-ground-collision-elastic',
  output:'artifacts/proving-ground-collision-elastic.png',
  time:collisionElasticExperiment.durationS,
  camera:{position:[160,28,126],target:[150,20.5,110],fov:30,aperture:0},
 },
 {
  name:'proving-ground-rotation-free-body',
  output:'artifacts/proving-ground-rotation-free-body.png',
  time:rotationFreeBodyExperiment.durationS,
  camera:{position:[177,25,150],target:[165,18,135],fov:30,aperture:0},
 },
 {
  name:'proving-ground-aero-rotor',
  output:'artifacts/proving-ground-aero-rotor.png',
  time:aeroRotorExperiment.durationS,
  camera:{position:[202,48,134],target:[190,42,120],fov:31,aperture:0},
 }
]);
export const provingGroundExperiments=Object.freeze([gravityFreeFallExperiment,collisionElasticExperiment,rotationFreeBodyExperiment,aeroRotorExperiment]);
