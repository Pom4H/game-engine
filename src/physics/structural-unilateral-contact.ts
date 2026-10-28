import type {StructuralBody} from './structure.js';

/** One unilateral material contact owns its accumulated position reaction.
 * Reset at each physical prediction, update signed delta-lambda, and remove
 * the old Jacobian when a closest feature changes. A separated/deleted feature
 * must not leave a force in the graph after another member fractures. */
export class StructuralUnilateralContact{
 readonly gradient:Float64Array;
 private readonly applied:Float64Array;
 private readonly response:ReturnType<StructuralBody['positionGradientConstraint']>;
 private epoch=-1;private lambda=0;
 constructor(readonly core:StructuralBody,readonly ids:readonly number[]){this.gradient=new Float64Array(ids.length*3);this.applied=new Float64Array(this.gradient.length);this.response=core.positionGradientConstraint(ids,this.gradient);}
 get supported(){return this.response!==undefined;}
 get reaction(){return this.epoch===this.core.steps?this.lambda:0;}
 private refresh(){if(this.epoch!==this.core.steps){this.epoch=this.core.steps;this.lambda=0;this.applied.fill(0);}}
 project(gap:number){
  this.refresh();if(!this.response||!Number.isFinite(gap))return;
  let changed=false;for(let k=0;k<this.gradient.length;k++)if(this.gradient[k]!==this.applied[k])changed=true;
  if(changed){if(this.lambda>0){this.core.adjustPositionReaction(this.ids,this.applied,-this.lambda);this.core.adjustPositionReaction(this.ids,this.gradient,this.lambda);}this.applied.set(this.gradient);}
  if(gap>=0&&this.lambda===0)return;
  const inverse=this.response.inverseContactMass();if(!(inverse>0&&Number.isFinite(inverse))){this.release();return;}
  const next=Math.max(0,this.lambda-gap/inverse),delta=next-this.lambda;if(delta!==0)this.lambda+=this.response.displaceContact(delta,inverse*delta,-this.lambda);
 }
 release(){
  this.refresh();if(!this.response||this.lambda===0)return;
  // A feature may disappear after its caller has prepared a different normal.
  // Remove the reaction using the original row, including retired node slots.
  this.gradient.set(this.applied);this.response.displaceContact(-this.lambda);this.lambda=0;
 }
}
