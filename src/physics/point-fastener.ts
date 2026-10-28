import {Vsub,Vdot,Vcross,Vlen,type SolidBody,type SolidConstraint,type SolidPositionAnchor} from './compound.js';
type V=[number,number,number];
export type PointFastenerAnchor=(()=>V)&{available?:()=>boolean};
const AXES:readonly V[]=[[1,0,0],[0,1,0],[0,0,1]];
export type PointFastenerSpec={stiffness:number;damping:number;failureForce:number;engagement:number;areaM2?:number};
export type PointFastenerFailure={workJ:number;fractureWorkJ:number;point:V;areaM2:number;seconds:number;broken:number};
/** Implicit spring between two physical attachment points. Its force/engagement,
 * rather than a damage percentage, determines separation. The same impulse is
 * applied with opposite signs to the two owners, inside their contact solve. */
export class PointFastener implements SolidConstraint{
 broken=false;enabled=true;force=0;extension=0;private impulse:V=[0,0,0];
 failure:PointFastenerFailure|undefined;private stepSeconds=0;
 private pending=true;private pa:V=[0,0,0];private pb:V=[0,0,0];private error:V=[0,0,0];private inverse=new Float64Array(3);private gamma=0;private beta=0;
 private readonly positive:V=[0,0,0];private readonly negative:V=[0,0,0];
 private readonly positionLambda:V=[0,0,0];private positionA:SolidPositionAnchor|undefined;private positionB:SolidPositionAnchor|undefined;private projected=false;
 get positionProjection(){return !!this.anchorB;}
 constructor(readonly a:SolidBody,readonly b:SolidBody,readonly anchorA:PointFastenerAnchor,readonly localB:V,readonly spec:PointFastenerSpec,readonly anchorB?:PointFastenerAnchor){
  if(![spec.stiffness,spec.damping,spec.failureForce,spec.engagement].every(n=>Number.isFinite(n)&&n>0))throw new RangeError('Invalid point fastener');
  if(spec.areaM2!==undefined&&(!Number.isFinite(spec.areaM2)||spec.areaM2<=0))throw new RangeError('Invalid fastener section area');
 }
 beginStep(){this.impulse.fill(0);this.positionLambda.fill(0);this.positionA=this.positionB=undefined;this.projected=false;this.force=0;this.pending=true;}
 projectPosition(dt:number,_iteration:number){
  if(this.broken||!this.enabled||!this.anchorB)return;
  if(this.anchorA.available?.()===false||this.anchorB.available?.()===false){this.broken=true;return;}
  const active=(body:SolidBody)=>!!(body.deformable?.active&&body.deformable.positionAnchor);if(!active(this.a)&&this.a.invMass||!active(this.b)&&this.b.invMass)return;
  if(!active(this.a)&&!active(this.b))return;
  if(!this.positionA){this.pa=this.anchorA();this.pb=this.anchorB();this.extension=Vlen(Vsub(this.pb,this.pa));this.stepSeconds=dt;if(this.extension>this.spec.engagement){this.fail();return;}
   const anchor=(body:SolidBody,p:V):SolidPositionAnchor=>body.deformable?.active?body.deformable.positionAnchor!(p):{point(out){out[0]=p[0];out[1]=p[1];out[2]=p[2];},inverseMass(){return 0;},displace(){}};
   this.positionA=anchor(this.a,this.pa);this.positionB=anchor(this.b,this.pb);
  }
  this.projected=true;const alpha=1/(this.spec.stiffness*dt*dt),a=this.positionA,b=this.positionB!;
  for(let axis=0;axis<3;axis++){a.point(this.positive);b.point(this.negative);const n=AXES[axis]!,inverse=a.inverseMass(n)+b.inverseMass(n),delta=(-(this.negative[axis]!-this.positive[axis]!)-alpha*this.positionLambda[axis]!)/(inverse+alpha);this.positionLambda[axis]!+=delta;a.displace(n,-delta);b.displace(n,delta);}
 }
 // Break against the converged reaction in this same solver substep. Testing
 // intermediate axis/iteration impulses mistakes constraint cancellation for a
 // physical overload, especially when a panel also contacts an obstacle.
 endStep(){if(this.enabled&&!this.broken&&this.force>this.spec.failureForce)this.fail();}
 private fail(){
  this.broken=true;if(this.failure)return;
  // Release only energy stored in this bracket spring. The body impulse and
  // kinetic energy remain separate contact causes and are never counted again.
  const extension=Math.min(this.extension,this.spec.failureForce/this.spec.stiffness),workJ=.5*this.spec.stiffness*extension*extension;
  this.failure={workJ,fractureWorkJ:workJ,point:this.pa.map((n,k)=>(n+this.pb[k]!)*.5) as V,areaM2:this.spec.areaM2??this.spec.engagement*this.spec.engagement,seconds:this.stepSeconds,broken:1};
 }
 solve(dt:number){
  if(this.broken||!this.enabled)return;
  if(this.anchorA.available?.()===false||this.anchorB?.available?.()===false){this.broken=true;return;}
  this.stepSeconds=dt;
  if(this.pending){
   this.pa=this.anchorA();this.pb=this.anchorB?.()??this.b.point(this.localB);this.error=Vsub(this.pb,this.pa);this.extension=Vlen(this.error);
   if(this.extension>this.spec.engagement){this.fail();return;}
   this.gamma=1/(dt*(this.spec.damping+dt*(this.projected?0:this.spec.stiffness)));this.beta=this.projected?0:dt*this.spec.stiffness*this.gamma;
   for(let axis=0;axis<3;axis++){const n=AXES[axis]!;this.inverse[axis]=this.a.inverseEffectiveMass(this.pa,n)+this.b.inverseEffectiveMass(this.pb,n);}
   this.pending=false;
  }
  // Poses/masses are fixed during this velocity solve. Reuse their response;
  // only velocities and accumulated impulses change between iterations.
  const pa=this.pa,pb=this.pb,error=this.error,gamma=this.gamma,beta=this.beta;
  for(let axis=0;axis<3;axis++){
   const k=this.inverse[axis]!;if(k<=0)continue;
   const speed=this.b.pointVelocityAxis(pb,axis)-this.a.pointVelocityAxis(pa,axis),delta=-(speed+beta*error[axis]!+gamma*this.impulse[axis]!)/(k+gamma);
   this.impulse[axis]!+=delta;
   this.positive.fill(0);this.negative.fill(0);this.positive[axis]=delta;this.negative[axis]=-delta;this.b.impulse(this.positive,pb);this.a.impulse(this.negative,pa);
  }
  this.force=Math.hypot(...this.impulse.map((n,k)=>n/dt+this.positionLambda[k]!/(dt*dt)));
 }
}
