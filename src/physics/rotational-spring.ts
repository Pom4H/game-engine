import {Vadd,Vsub,Vscale,Vdot,Vcross,Vlen,type SolidBody,type SolidConstraint} from './compound.js';
import {materialAngle} from './material-angle.js';
type V=[number,number,number];
export type RotationalSpringFrame={axis:V;center:V;angle:number;radial?:V;positive?:V;negative?:V;referencePositive?:V;referenceNegative?:V;axisPositive?:V;axisNegative?:V};
type MaterialConstraint={inverseMass():number;velocityInverseMass?():number;displace(lambda:number):void;available?():boolean};
/** One angular degree of freedom solved alongside contacts and hinge pins.
 * A torque couple keeps the reaction in the same nodal/rigid owners. */
export class RotationalSpring implements SolidConstraint{
 target:number|null=null;enabled=true;min=0;max=Math.PI;stiffness=0;damping=0;limitStiffness=0;maxTorque=Infinity;
 private accumulated=0;private lowerImpulse=0;private upperImpulse=0;private pending=true;private axis:V=[1,0,0];private tangent:V=[0,0,1];private positive:V=[0,0,0];private negative:V=[0,0,0];private inverse=0;private angle=0;private lever=0;
 private projected=false;private startAngle=0;private positionImpulse=0;private lowerPositionImpulse=0;private upperPositionImpulse=0;private positionA:MaterialConstraint|undefined;private positionB:MaterialConstraint|undefined;
 private reportedWork=0;
 /** Final generalized BE work for this substep, not solver-iteration work. */
 readonly work={controlJ:0,stopJ:0,angularTravel:0};
 private readonly gradientsA:V[]=Array.from({length:4},()=>[0,0,0]);private readonly gradientsB:V[]=Array.from({length:2},()=>[0,0,0]);
 get positionProjection(){return !!(this.b.deformable?.positionMaterialConstraint&&(!this.a.invMass||this.a.deformable?.positionMaterialConstraint));}
 constructor(readonly a:SolidBody,readonly b:SolidBody,readonly frame:()=>RotationalSpringFrame,readonly radius:number){if(!(radius>0&&Number.isFinite(radius)))throw new RangeError('Invalid torque-couple radius');}
 beginStep(dt:number){
  this.accumulated=0;this.lowerImpulse=0;this.upperImpulse=0;this.pending=true;
  this.projected=false;this.positionImpulse=this.lowerPositionImpulse=this.upperPositionImpulse=0;this.positionA=this.positionB=undefined;this.startAngle=this.positionProjection?this.frame().angle:0;this.reportedWork=0;this.work.controlJ=this.work.stopJ=this.work.angularTravel=0;
  // SolidWorld predicts poses before its contact iterations. Catch a fast slam
  // before that prediction, then solve new collision impulses at the new pose.
  if(this.enabled&&this.limitStiffness>0&&!(this.positionProjection&&(this.a.deformable?.active||this.b.deformable?.active))){this.prepareFrame();if(this.inverse>0)this.stops(dt);this.lowerImpulse=0;this.upperImpulse=0;this.pending=true;}
 }
 private materialRow(){
  const f=this.frame();if(!f.positive||!f.negative||!f.referencePositive||!f.referenceNegative||!f.axisPositive||!f.axisNegative)return;
  const state=materialAngle(f.axisPositive,f.axisNegative,f.referencePositive,f.referenceNegative,f.positive,f.negative);if(!state)return;
  for(let k=0;k<3;k++){this.gradientsA[0]![k]=state.reference[k]!;this.gradientsA[1]![k]=-state.reference[k]!;this.gradientsA[2]![k]=state.hinge[k]!;this.gradientsA[3]![k]=-state.hinge[k]!;this.gradientsB[0]![k]=state.child[k]!;this.gradientsB[1]![k]=-state.child[k]!;}
  if(!this.positionA){this.positionA=this.a.invMass?this.a.deformable!.positionMaterialConstraint!([f.referencePositive,f.referenceNegative,f.axisPositive,f.axisNegative],this.gradientsA):{inverseMass:()=>0,velocityInverseMass:()=>0,displace:()=>{}};this.positionB=this.b.deformable!.positionMaterialConstraint!([f.positive,f.negative],this.gradientsB);}
  if(this.positionA.available?.()===false||this.positionB!.available?.()===false)return;
  return{angle:state.angle,inverse:this.positionA.inverseMass()+this.positionB!.inverseMass()};
 }
 projectPosition(dt:number,_iteration:number){
  if(!this.enabled||!this.positionProjection)return;
  if((this.a.invMass&&!this.a.deformable?.active)||(this.b.invMass&&!this.b.deformable?.active))return;
  this.projected=true;
  const apply=(lambda:number)=>{this.positionA!.displace(lambda);this.positionB!.displace(lambda);},k=this.target!==null?this.stiffness:0,c=this.damping,denominator=dt*dt*k+dt*c;
  if(denominator>0){const row=this.materialRow();if(!row||row.inverse<=0)return;const dampingAngle=Math.atan2(Math.sin(row.angle-this.startAngle),Math.cos(row.angle-this.startAngle)),error=(dt*dt*k*(row.angle-(this.target??row.angle))+dt*c*dampingAngle)/denominator,alpha=1/denominator,limit=this.target!==null?this.maxTorque*dt*dt:Infinity,next=Math.max(-limit,Math.min(limit,this.positionImpulse-(error+alpha*this.positionImpulse)/(row.inverse+alpha)));apply(next-this.positionImpulse);this.positionImpulse=next;}
  if(this.limitStiffness>0){
   const stop=(lower:boolean)=>{const row=this.materialRow();if(!row||row.inverse<=0)return;const old=lower?this.lowerPositionImpulse:this.upperPositionImpulse,error=row.angle-(lower?this.min:this.max);let next=0;
    if(lower?error<0:error>0){if(!this.positionA!.velocityInverseMass||!this.positionB!.velocityInverseMass)throw new Error('Material angular stops require their physical velocity mass');const physicalInverse=this.positionA!.velocityInverseMass()+this.positionB!.velocityInverseMass();if(physicalInverse<=0)return;const damping=2*Math.sqrt(this.limitStiffness/physicalInverse),denominator=dt*dt*this.limitStiffness+dt*damping,alpha=1/denominator,deltaAngle=Math.atan2(Math.sin(row.angle-this.startAngle),Math.cos(row.angle-this.startAngle)),C=(dt*dt*this.limitStiffness*error+dt*damping*deltaAngle)/denominator,candidate=old-(C+alpha*old)/(row.inverse+alpha);next=lower?Math.max(0,candidate):Math.min(0,candidate);}
    apply(next-old);if(lower)this.lowerPositionImpulse=next;else this.upperPositionImpulse=next;
   };stop(true);stop(false);
  }
  const angle=this.frame().angle,travel=Math.atan2(Math.sin(angle-this.startAngle),Math.cos(angle-this.startAngle));this.work.angularTravel=Math.abs(travel);this.work.controlJ=this.positionImpulse*travel/(dt*dt);this.work.stopJ=(this.lowerPositionImpulse+this.upperPositionImpulse)*travel/(dt*dt);const total=this.work.controlJ+this.work.stopJ,owner=this.a.deformable?.active?this.a.deformable.structure:this.b.deformable?.structure;owner?.addExternalConstraintWork(total-this.reportedWork);this.reportedWork=total;
 }
 private speed(){const plus=Vsub(this.b.pointVelocity(this.positive),this.a.pointVelocity(this.positive)),minus=Vsub(this.b.pointVelocity(this.negative),this.a.pointVelocity(this.negative));return Vdot(this.tangent,Vsub(plus,minus))/(2*this.lever);}
 private apply(impulse:number){const j=Vscale(this.tangent,impulse/(2*this.lever));this.b.impulse(j,this.positive);this.b.impulse(Vscale(j,-1),this.negative);this.a.impulse(Vscale(j,-1),this.positive);this.a.impulse(j,this.negative);}
 private prepareFrame(){
  if(this.pending){
   const f=this.frame(),length=Vlen(f.axis);if(length<1e-8)return;this.axis=Vscale(f.axis,1/length);this.angle=f.angle;
   const ref:V=Math.abs(this.axis[1])<.8?[0,1,0]:[1,0,0],source=f.positive&&f.negative?Vscale(Vsub(f.positive,f.negative),.5):f.radial,radial=source?Vsub(source,Vscale(this.axis,Vdot(source,this.axis))):Vcross(this.axis,ref);this.lever=f.positive&&f.negative?Vlen(radial):this.radius;if(this.lever<1e-6){this.inverse=0;this.pending=false;return;}const r=Vscale(radial,this.lever/Math.max(1e-8,Vlen(radial)));
   this.tangent=Vscale(Vcross(this.axis,r),1/this.lever);this.positive=f.positive??Vadd(f.center,r);this.negative=f.negative??Vsub(f.center,r);
   // A folded flange need not remain perpendicular to the hinge. Use the
   // actual couple Jacobian for both work and mass, including its axial skew.
   const angular=Vscale(Vcross(Vsub(this.positive,this.negative),this.tangent),1/(2*this.lever));
   const inverse=(body:SolidBody)=>{if(!body.deformable?.active)return Vdot(angular,body.inertia(angular));if(!body.deformable.inverseCoupleMass)throw new Error('Nodal torque couple requires its shared-node mass response');return body.deformable.inverseCoupleMass(this.positive,this.negative)/(4*this.lever*this.lever);};
   this.inverse=inverse(this.a)+inverse(this.b);this.pending=false;
  }
 }
 private stops(dt:number){
  // The check strap stores finite elastic energy. A permanent flange fold can
  // put its rest angle beyond a stop; prescribing angle-error / dt forever
  // would turn that incompatible geometry into an unlimited powered motor.
  const k=this.limitStiffness,c=2*Math.sqrt(k/this.inverse),gamma=1/(dt*(c+dt*k)),beta=dt*k*gamma;
  const lowerError=this.angle-this.min,upperError=this.angle-this.max;
  let delta=lowerError<0?-(this.speed()+beta*lowerError+gamma*this.lowerImpulse)/(this.inverse+gamma):(-lowerError/dt-this.speed())/this.inverse;
  let next=Math.max(0,this.lowerImpulse+delta);this.apply(next-this.lowerImpulse);this.lowerImpulse=next;
  delta=upperError>0?-(this.speed()+beta*upperError+gamma*this.upperImpulse)/(this.inverse+gamma):(-upperError/dt-this.speed())/this.inverse;
  next=Math.min(0,this.upperImpulse+delta);this.apply(next-this.upperImpulse);this.upperImpulse=next;
 }
 solve(dt:number){
  if(!this.enabled||this.projected)return;this.prepareFrame();
  if(this.inverse<=0)return;
  const k=this.target!==null?this.stiffness:0,c=this.damping;
  if(k+c>0){
   const error=this.angle-(this.target??this.angle),gamma=1/(dt*(c+dt*k)),beta=dt*k*gamma;
   const delta=-(this.speed()+beta*error+gamma*this.accumulated)/(this.inverse+gamma),limit=this.target!==null?this.maxTorque*dt:Infinity,next=Math.max(-limit,Math.min(limit,this.accumulated+delta));
   this.apply(next-this.accumulated);this.accumulated=next;
  }
  if(this.limitStiffness>0){
   // A jamb/check strap is unilateral, independent of the handle's torque cap.
   // Predict arrival at either stop; recover existing error at a bounded speed.
   this.stops(dt);
  }
 }
}
