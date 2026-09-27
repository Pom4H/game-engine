/** Adapted from thegame 4e7a577 src/game/wheel-contact.ts: same bounded implicit scalar solve. */
export interface WheelContactResult {force:number;sideForce:number;speed:number;slip:number;brake:number;targetForce:number;targetSide:number;}
export function solveWheelContact(out:WheelContactResult,dt:number,radius:number,inertia:number,
 omega:number,velocity:number,sideSlip:number,limit:number,drive:number,brake:number,
 inverseSupportedMass:number,previousForce:number,previousSide:number,relaxation:number,
 longStiffness:number,sideStiffness:number):void {
 const gain=radius*dt/Math.max(1e-12,inertia),brakeDelta=brake*gain;
 let lo=-limit,hi=limit,fLo=-2*limit,fHi=2*limit,force=0,target=0,side=0,slip=0,next=omega;
 for(let i=0;i<=16;i++){
  force=i===16&&fHi>fLo?lo+(hi-lo)*(-fLo)/(fHi-fLo):(lo+hi)*.5;const free=omega+(drive-force)*gain;next=Math.sign(free)*Math.max(0,Math.abs(free)-brakeDelta);
  const road=velocity+force*dt*inverseSupportedMass,wheel=next*radius;
  slip=(wheel-road)/Math.max(1.25,Math.abs(road),Math.abs(wheel));
  const x=slip*longStiffness,y=sideSlip*sideStiffness,magnitude=Math.hypot(x,y);
  const falloff=1-.12*Math.max(0,Math.min(1,(magnitude-2)/8));
  const scale=limit*falloff/Math.sqrt(1+x*x+y*y);
  target=x*scale;side=y*scale;
  const residual=force-(previousForce+(target-previousForce)*relaxation);
  if(Math.abs(residual)<1e-7)break;
  if(residual<0){lo=force;fLo=residual;}else{hi=force;fHi=residual;}
 }
 out.force=force;out.speed=next||0;out.slip=slip;out.targetForce=target;out.targetSide=side;
 const fy=previousSide+(side-previousSide)*relaxation;
 out.sideForce=Math.max(-Math.sqrt(Math.max(0,limit*limit-force*force)),Math.min(Math.sqrt(Math.max(0,limit*limit-force*force)),fy));
 out.brake=(omega+(drive-force)*gain-next)/gain;
}
