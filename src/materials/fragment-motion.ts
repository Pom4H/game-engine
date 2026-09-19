import type {RigidBody} from '../physics/world.js';
import {compose,V3,type Vec3,type MutableVec3} from '../math.js';
import {mulberry32} from '../core/random.js';

type Matrix=number[];
const zero=():MutableVec3=>[0,0,0];
function inertia(body:RigidBody):Matrix{
  const rotation=compose([0,0,0],body.rotation,[1,1,1]),result=Array<number>(9).fill(0);
  for(let axis=0;axis<3;axis++){
    const inv=body.invInertiaLocal[axis]!,moment=inv>0?1/inv:0;
    for(let row=0;row<3;row++)for(let col=0;col<3;col++)result[row*3+col]!+=moment*rotation[axis*4+row]!*rotation[axis*4+col]!;
  }
  return result;
}
function multiply(matrix:Matrix,v:Vec3):MutableVec3{return[0,1,2].map(row=>matrix[row*3]!*v[0]+matrix[row*3+1]!*v[1]+matrix[row*3+2]!*v[2]) as MutableVec3;}
function solve(matrix:Matrix,v:Vec3):MutableVec3{
  const rows=[0,1,2].map(row=>[...matrix.slice(row*3,row*3+3),v[row]!]);
  for(let col=0;col<3;col++){
    let pivot=col;for(let row=col+1;row<3;row++)if(Math.abs(rows[row]![col]!)>Math.abs(rows[pivot]![col]!))pivot=row;
    [rows[col],rows[pivot]]=[rows[pivot]!,rows[col]!];
    const divisor=rows[col]![col]!;if(Math.abs(divisor)<1e-12)return zero();
    for(let k=col;k<4;k++)rows[col]![k]!/=divisor;
    for(let row=0;row<3;row++)if(row!==col){const factor=rows[row]![col]!;for(let k=col;k<4;k++)rows[row]![k]!-=factor*rows[col]![k]!;}
  }
  return rows.map(row=>row[3]!) as MutableVec3;
}

/** Transfer the source body's momentum. Scatter is projected onto zero linear and
 * angular momentum and limited to an explicit share of the contact's energy loss.
 * Fragment inertia follows the collision backend's box/sphere approximation. */
export function transferFragmentMotion(source:RigidBody,fragments:readonly RigidBody[],impulse:Vec3,energyLoss:number,seed:number):void{
  if(!fragments.length)return;
  const mass=fragments.reduce((sum,body)=>sum+body.mass,0),center=zero();
  for(const body of fragments)for(let k=0;k<3;k++)center[k]!+=body.mass*body.position[k]!/mass;
  const offsets=fragments.map(body=>V3.sub(body.position,center));
  const inertias=fragments.map(inertia),combined=Array<number>(9).fill(0);
  for(let i=0;i<fragments.length;i++){
    const r=offsets[i]!,m=fragments[i]!.mass,r2=V3.dot(r,r);
    for(let row=0;row<3;row++)for(let col=0;col<3;col++)combined[row*3+col]!+=inertias[i]![row*3+col]!+m*((row===col?r2:0)-r[row]!*r[col]!);
  }
  // Dynamic source velocity already includes the solver impulse; never add it twice.
  let velocity:Vec3=source.invMass?source.velocity:V3.scale(impulse,1/mass);
  let scatterBudget=Math.max(0,energyLoss)*.15;
  if(!source.invMass){
    const translationEnergy=.5*mass*V3.dot(velocity,velocity),limit=Math.max(0,energyLoss)*.5;
    if(translationEnergy>limit)velocity=V3.scale(velocity,Math.sqrt(limit/translationEnergy));
  }
  const sourceL=source.invMass?multiply(inertia(source),source.angularVelocity):zero();
  const bulkAngular=solve(combined,sourceL),rng=mulberry32(seed);
  const kicks=fragments.map(()=>[rng()*2-1,rng()*2-1,rng()*2-1] as MutableVec3);
  const spins=fragments.map(()=>[rng()*2-1,rng()*2-1,rng()*2-1] as MutableVec3),mean=zero();
  for(let i=0;i<fragments.length;i++)for(let k=0;k<3;k++)mean[k]!+=fragments[i]!.mass*kicks[i]![k]!/mass;
  const scatterL=zero();
  for(let i=0;i<fragments.length;i++){
    kicks[i]=V3.sub(kicks[i]!,mean);
    const l=V3.add(V3.cross(offsets[i]!,V3.scale(kicks[i]!,fragments[i]!.mass)),multiply(inertias[i]!,spins[i]!));
    for(let k=0;k<3;k++)scatterL[k]!+=l[k]!;
  }
  const correction=solve(combined,scatterL);let energy=0;
  for(let i=0;i<fragments.length;i++){
    kicks[i]=V3.sub(kicks[i]!,V3.cross(correction,offsets[i]!));spins[i]=V3.sub(spins[i]!,correction);
    energy+=.5*(fragments[i]!.mass*V3.dot(kicks[i]!,kicks[i]!)+V3.dot(spins[i]!,multiply(inertias[i]!,spins[i]!)));
  }
  // Reserve no extra rotational energy when approximate fragment inertias require
  // more than the source; the transfer itself still preserves angular momentum.
  if(source.invMass)scatterBudget=Math.max(0,scatterBudget+.5*V3.dot(source.angularVelocity,sourceL)-.5*V3.dot(bulkAngular,sourceL));
  const scale=energy>1e-12?Math.sqrt(scatterBudget/energy):0;
  for(let i=0;i<fragments.length;i++){
    const body=fragments[i]!;
    body.velocity=V3.add(V3.add(velocity,V3.cross(bulkAngular,offsets[i]!)),V3.scale(kicks[i]!,scale));
    body.angularVelocity=V3.add(bulkAngular,V3.scale(spins[i]!,scale));
  }
}
