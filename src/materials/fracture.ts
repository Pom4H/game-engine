import type {Vec3} from '../math.js';
import type {ContactCandidate,ContactDecision,RigidBody} from '../physics/world.js';

export interface FractureDecision {
  readonly body:RigidBody;
  readonly other:RigidBody;
  readonly thickness:number;
  readonly requiredEnergy:number;
  readonly availableEnergy:number;
  readonly point:Vec3;
  readonly normal:Vec3;
  readonly sourceVelocity:Vec3;
}

export function evaluateFracture(contact:ContactCandidate):{decision:ContactDecision;fracture?:FractureDecision}{
  // Micro-debris has no recursive fracture budget, including against other bodies.
  if(contact.a.collisionClass==='debris'||contact.b.collisionClass==='debris')return{decision:{mode:'resolve'}};
  const candidates:[[RigidBody,RigidBody,Vec3],[RigidBody,RigidBody,Vec3]]=[
    [contact.a,contact.b,contact.normal],
    [contact.b,contact.a,[-contact.normal[0],-contact.normal[1],-contact.normal[2]]],
  ];
  for(const [target,other,normal] of candidates){
    if(!target.material.brittle||!target.fracturable)continue;
    const thickness=thicknessAlong(target,normal),impactRadius=contactRadius(other);
    const planeRadius=planarRadius(target,normal),crackRadius=Math.min(planeRadius,Math.max(.06,impactRadius*2.5,thickness*3));
    const fractureArea=Math.PI*crackRadius*crackRadius;
    const energyDensity=.5*target.material.failureStressPa*target.material.failureStrain;
    // Mounted plates consume more than the ideal crack-surface energy because a finite volume unloads elastically.
    const requiredEnergy=Math.max(.02,energyDensity*fractureArea*thickness);
    if(contact.normalEnergy+1e-9<requiredEnergy)continue;
    return{
      decision:{mode:'penetrate',energyLoss:requiredEnergy},
      fracture:{body:target,other,thickness,requiredEnergy,availableEnergy:contact.normalEnergy,point:contact.point,normal,sourceVelocity:[...other.velocity]},
    };
  }
  return{decision:{mode:'resolve'}};
}

function contactRadius(body:RigidBody):number{return body.shape.kind==='sphere'?body.shape.radius:Math.max(.03,Math.min(body.shape.half[0],body.shape.half[1],body.shape.half[2]));}
function thicknessAlong(body:RigidBody,normal:Vec3):number{
  if(body.shape.kind==='sphere')return body.shape.radius*2;
  return Math.max(.001,2*(Math.abs(normal[0])*body.shape.half[0]+Math.abs(normal[1])*body.shape.half[1]+Math.abs(normal[2])*body.shape.half[2]));
}
function planarRadius(body:RigidBody,normal:Vec3):number{
  if(body.shape.kind==='sphere')return body.shape.radius;
  const h=body.shape.half,axis=Math.abs(normal[0])>=Math.abs(normal[1])&&Math.abs(normal[0])>=Math.abs(normal[2])?0:Math.abs(normal[1])>=Math.abs(normal[2])?1:2;
  const dims=axis===0?[h[1],h[2]]:axis===1?[h[0],h[2]]:[h[0],h[1]];
  return Math.max(.04,Math.min(dims[0]!,dims[1]!));
}
