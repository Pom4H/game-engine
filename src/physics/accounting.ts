import type {Vec3} from '../math.js';
import type {RigidBody} from './world.js';

export interface PhysicsAccountingState {
 readonly massKg:number;
 readonly centerOfMassM:Vec3;
 readonly linearMomentumNs:Vec3;
 /** Total angular momentum about the requested origin: orbital + spin. */
 readonly angularMomentumNms:Vec3;
 readonly translationalKineticJ:number;
 readonly rotationalKineticJ:number;
 readonly kineticJ:number;
 readonly gravitationalPotentialJ:number;
 readonly mechanicalJ:number;
}
const cross=(a:Vec3,b:Vec3):Vec3=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const dot=(a:Vec3,b:Vec3)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
function basis(rotation:Vec3):readonly[Vec3,Vec3,Vec3]{
 const [rx,ry,rz]=rotation,sx=Math.sin(rx),cx=Math.cos(rx),sy=Math.sin(ry),cy=Math.cos(ry),sz=Math.sin(rz),cz=Math.cos(rz);
 return[
  [cy*cz,sx*sy*cz+cx*sz,-cx*sy*cz+sx*sz],
  [-cy*sz,-sx*sy*sz+cx*cz,cx*sy*sz+sx*cz],
  [sy,-sx*cy,cx*cy],
 ];
}
const toLocal=(rotation:Vec3,v:Vec3):Vec3=>{const b=basis(rotation);return[dot(v,b[0]),dot(v,b[1]),dot(v,b[2])];};
const toWorld=(rotation:Vec3,v:Vec3):Vec3=>{const b=basis(rotation);return[
 b[0][0]*v[0]+b[1][0]*v[1]+b[2][0]*v[2],
 b[0][1]*v[0]+b[1][1]*v[1]+b[2][1]*v[2],
 b[0][2]*v[0]+b[1][2]*v[1]+b[2][2]*v[2],
];};

/** Read-only SI accounting over dynamic rigid bodies. Kinematic bodies are excluded
 * because their controller is an external momentum/energy source. */
export function physicsAccounting(bodies:Iterable<RigidBody>,gravity:Vec3=[0,0,0],origin:Vec3=[0,0,0]):PhysicsAccountingState{
 if(!gravity.every(Number.isFinite)||!origin.every(Number.isFinite))throw new TypeError('Accounting vectors must be finite');
 let mass=0,cx=0,cy=0,cz=0,px=0,py=0,pz=0,lx=0,ly=0,lz=0,trans=0,rot=0,potential=0;
 for(const body of bodies){
  if(!(body.mass>0)||body.kinematic)continue;
  const m=body.mass,r:Vec3=[body.position[0]-origin[0],body.position[1]-origin[1],body.position[2]-origin[2]],v=body.velocity,p:Vec3=[m*v[0],m*v[1],m*v[2]];
  mass+=m;cx+=body.position[0]*m;cy+=body.position[1]*m;cz+=body.position[2]*m;px+=p[0];py+=p[1];pz+=p[2];
  const orbital=cross(r,p),wLocal=toLocal(body.rotation,body.angularVelocity),iLocal:Vec3=[
   body.invInertiaLocal[0]>0?1/body.invInertiaLocal[0]:0,
   body.invInertiaLocal[1]>0?1/body.invInertiaLocal[1]:0,
   body.invInertiaLocal[2]>0?1/body.invInertiaLocal[2]:0,
  ],spinLocal:Vec3=[iLocal[0]*wLocal[0],iLocal[1]*wLocal[1],iLocal[2]*wLocal[2]],spin=toWorld(body.rotation,spinLocal);
  lx+=orbital[0]+spin[0];ly+=orbital[1]+spin[1];lz+=orbital[2]+spin[2];
  trans+=.5*m*dot(v,v);rot+=.5*dot(wLocal,spinLocal);potential-=m*dot(gravity,body.position);
 }
 const com:Vec3=mass>0?[cx/mass,cy/mass,cz/mass]:[0,0,0],kinetic=trans+rot;
 return Object.freeze({massKg:mass,centerOfMassM:Object.freeze(com) as Vec3,linearMomentumNs:Object.freeze([px,py,pz]) as Vec3,angularMomentumNms:Object.freeze([lx,ly,lz]) as Vec3,translationalKineticJ:trans,rotationalKineticJ:rot,kineticJ:kinetic,gravitationalPotentialJ:potential,mechanicalJ:kinetic+potential});
}
