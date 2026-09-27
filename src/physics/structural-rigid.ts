import type {Vec3,MutableVec3} from '../math.js';
import {V3} from '../math.js';
import {RigidBody,applyInvInertiaWorld} from './world.js';
import {ForceFrame} from './force-frame.js';
import type {StructuralBody} from './structure.js';

type Hit={node:number;rigid:RigidBody;normal:Vec3;point:Vec3;incoming:number;lambda:number};
/** Coupled nodal/OBB contacts. Nodal mass is the only soft mass: no rigid ball proxy.
 * Position corrections give equal/opposite impulses to the existing rigid body.
 * Restitution/friction run ONCE after XPBD, never once per constraint iteration.
 * Node surface sampling + fixed small substeps, not general continuous mesh collision. */
export class StructuralRigidContacts {
 private readonly hits:Hit[]=[];private readonly keys=new Map<string,Hit>();
 private readonly frames=new Map<RigidBody,ForceFrame>();private dt=0;
 contacts=0;maxPenetration=0;
 constructor(readonly bodies:readonly RigidBody[],readonly surfaceNodes:number,readonly restitution=.68,readonly friction=.4){
  if(!Number.isSafeInteger(surfaceNodes)||surfaceNodes<1||bodies.some(b=>b.shape.kind!=='box'))throw new TypeError('Surface nodes and box colliders required');
  for(const b of bodies)this.frames.set(b,new ForceFrame());
 }
 begin(dt:number):void {if(!Number.isFinite(dt)||dt<=0||dt>1/30)throw new RangeError('Contact dt');this.dt=dt;this.hits.length=0;this.keys.clear();for(const [b,f] of this.frames)f.update(b.rotation);}
 project=(soft:StructuralBody):void=>{
  if(this.surfaceNodes>soft.nodeCount)throw new RangeError('Contact topology mismatch');
  for(let node=0;node<this.surfaceNodes;node++){
   const j=node*3;
   for(const b of this.bodies){
    const basis=this.frames.get(b)!.basis,half=b.collisionHalf!,p=soft.position;
    const dx=p[j]!-b.position[0],dy=p[j+1]!-b.position[1],dz=p[j+2]!-b.position[2];
    const x=dx*basis[0]!+dy*basis[1]!+dz*basis[2]!-b.collisionOffsetLocal[0],y=dx*basis[3]!+dy*basis[4]!+dz*basis[5]!-b.collisionOffsetLocal[1],z=dx*basis[6]!+dy*basis[7]!+dz*basis[8]!-b.collisionOffsetLocal[2];
    if(Math.abs(x)>=half[0]||Math.abs(y)>=half[1]||Math.abs(z)>=half[2])continue;
    const gaps=[half[0]-Math.abs(x),half[1]-Math.abs(y),half[2]-Math.abs(z)],axis=gaps[0]!<gaps[1]!&&gaps[0]!<gaps[2]!?0:gaps[1]!<gaps[2]!?1:2;
    const sign=([x,y,z][axis]??0)>=0?1:-1,n:Vec3=[basis[axis*3]!*sign,basis[axis*3+1]!*sign,basis[axis*3+2]!*sign];
    const point:Vec3=[p[j]!,p[j+1]!,p[j+2]!],arm=V3.sub(point,b.position),cross=V3.cross(arm,n),angular=applyInvInertiaWorld(b,cross);
    const inverse=soft.inverseMass[node]!+b.invMass+(b.invMass?V3.dot(cross,angular):0),lambda=gaps[axis]!/inverse;
    const key=`${node}:${b.id}`;let hit=this.keys.get(key);
    if(!hit){hit={node,rigid:b,normal:n,point,incoming:this.relative(soft,node,b,point,n),lambda:0};this.keys.set(key,hit);this.hits.push(hit);this.contacts++;}
    hit.lambda+=lambda;this.maxPenetration=Math.max(this.maxPenetration,gaps[axis]!);
    for(let k=0;k<3;k++){
     p[j+k]!+=n[k]!*lambda*soft.inverseMass[node]!;
     if(b.invMass){b.position[k]!-=n[k]!*lambda*b.invMass;b.velocity[k]!-=n[k]!*lambda*b.invMass/this.dt;b.rotation[k]!-=angular[k]!*lambda;b.angularVelocity[k]!-=angular[k]!*lambda/this.dt;}
    }
    if(b.invMass){b.wake();this.frames.get(b)!.update(b.rotation);}
   }
  }
 };
 finish(soft:StructuralBody):void {
  for(const h of this.hits){
   const {node,rigid:b,normal:n,point}=h,target=-Math.min(0,h.incoming)*Math.min(this.restitution,b.restitution);
   const current=this.relative(soft,node,b,point,n),arm=V3.sub(point,b.position),cross=V3.cross(arm,n);
   const inverse=soft.inverseMass[node]!+b.invMass+(b.invMass?V3.dot(cross,applyInvInertiaWorld(b,cross)):0);
   const impulse=Math.max(0,target-current)/inverse;
   if(impulse)this.impulse(soft,node,b,point,V3.scale(n,impulse));
   const v:MutableVec3=[0,0,0];for(let k=0;k<3;k++)v[k]=soft.velocity[node*3+k]!-(b.velocity[k]!+V3.cross(b.angularVelocity,arm)[k]!);
   const tangent=V3.sub(v,V3.scale(n,V3.dot(v,n))),speed=V3.length(tangent);
   if(speed>1e-8){const dir=V3.scale(tangent,1/speed),c=V3.cross(arm,dir),inv=soft.inverseMass[node]!+b.invMass+(b.invMass?V3.dot(c,applyInvInertiaWorld(b,c)):0);
    this.impulse(soft,node,b,point,V3.scale(dir,-Math.min(speed/inv,Math.min(this.friction,b.friction)*(h.lambda/this.dt+impulse))));}
  }
 }
 private relative(s:StructuralBody,node:number,b:RigidBody,p:Vec3,n:Vec3):number {
  const spin=V3.cross(b.angularVelocity,V3.sub(p,b.position));let v=0;for(let k=0;k<3;k++)v+=(s.velocity[node*3+k]!-b.velocity[k]!-spin[k]!)*n[k]!;return v;
 }
 private impulse(s:StructuralBody,node:number,b:RigidBody,p:Vec3,impulse:Vec3):void {
  const dw=applyInvInertiaWorld(b,V3.cross(V3.sub(p,b.position),impulse));
  for(let k=0;k<3;k++){s.velocity[node*3+k]!+=impulse[k]!*s.inverseMass[node]!;if(b.invMass){b.velocity[k]!-=impulse[k]!*b.invMass;b.angularVelocity[k]!-=dw[k]!;}}
 }
}
