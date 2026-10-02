// Pure proving-ground experiment descriptors. They own hypotheses/oracles, not simulation.
// Scene, tests, reports and render views are projections of the same descriptor.
export const experiment=definition=>Object.freeze(definition);

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
 body:Object.freeze({massKg,radiusM,initialPosition,initialVelocity,angularVelocity}),
 proof:Object.freeze({
  governingRelation:'v[n+1]=v[n]+g*dt; x[n+1]=x[n]+v[n+1]*dt',
  units:'x[m], v[m/s], g[m/s^2], p[kg*m/s], E[J]',
  assumptions:Object.freeze(['constant uniform gravity','no contacts','no drag','no external torque']),
  limitingCase:'dt -> 0 recovers x(t)=x0+v0*t+0.5*g*t^2',
  conservation:'linear momentum changes only by m*g*t; spin angular momentum is constant',
  numericalDissipation:'DeltaE=-0.5*m*|g|^2*t*dt; this is integrator defect, not physical dissipation',
 }),
 continuousPositionAt,
 symplecticPositionAt,
 momentumAt,
 symplecticEnergyDefectJ,
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

export function materializeExperimentScene(e=gravityFreeFallExperiment){
 const p0=e.body.initialPosition,dt=1/e.runtimeTickRate,pd=e.symplecticPositionAt(e.durationS,dt),pc=e.continuousPositionAt(e.durationS);
 const entities=[
  sphere('experiment-gravity-free-fall-body',p0,e.body.radiusM,measured),
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

export const experimentSceneEntities=Object.freeze(materializeExperimentScene());
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
 }
]);
export const provingGroundExperiments=Object.freeze([gravityFreeFallExperiment]);
