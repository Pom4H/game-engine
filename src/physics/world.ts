import {SpatialHash} from '../core/spatial-hash.js';
import {material,type PhysicalMaterial} from '../materials/catalog.js';
import type {MutableVec3,Vec3} from '../math.js';
import {V3} from '../math.js';

export type CollisionShape = {kind:'sphere';radius:number}|{kind:'box';half:Vec3};
export interface RigidBodyOptions {
  id:string;
  position:Vec3;
  rotation?:Vec3;
  velocity?:Vec3;
  angularVelocity?:Vec3;
  mass?:number;
  restitution?:number;
  friction?:number;
  material?:PhysicalMaterial;
  shape:CollisionShape;
}
export class RigidBody {
  readonly id:string;
  position:MutableVec3;
  rotation:MutableVec3;
  velocity:MutableVec3;
  angularVelocity:MutableVec3;
  readonly mass:number;
  readonly invMass:number;
  readonly material:PhysicalMaterial;
  /** Engine-generated micro debris does not recursively fracture or self-collide. */
  fracturable=true;
  collisionClass:'solid'|'debris'='solid';
  restitution:number;
  friction:number;
  readonly shape:CollisionShape;
  x:number;z:number;w:number;l:number;

  constructor(options:RigidBodyOptions){
    if(!options.id)throw new TypeError('Rigid body id is required');
    const mass=options.mass??0;
    if(!Number.isFinite(mass)||mass<0)throw new RangeError('Body mass must be finite and non-negative');
    this.id=options.id;
    this.position=[...options.position];
    this.rotation=[...(options.rotation??[0,0,0])];
    this.velocity=[...(options.velocity??[0,0,0])];
    this.angularVelocity=[...(options.angularVelocity??[0,0,0])];
    this.mass=mass;
    this.invMass=mass>0?1/mass:0;
    this.material=options.material??material();
    this.restitution=Math.max(0,Math.min(1,options.restitution??this.material.restitution));
    this.friction=Math.max(0,options.friction??this.material.friction);
    this.shape=options.shape;
    const r=shapeRadius(options.shape);
    this.x=this.position[0];this.z=this.position[2];this.w=r*2;this.l=r*2;
  }
  syncSpatial():void{this.x=this.position[0];this.z=this.position[2];}
}

export interface ContactCandidate {
  readonly a:RigidBody;
  readonly b:RigidBody;
  /** Unit normal from A toward B. */
  readonly normal:Vec3;
  readonly point:Vec3;
  readonly penetration:number;
  readonly approachSpeed:number;
  readonly effectiveMass:number;
  readonly normalEnergy:number;
}
export interface ContactDecision {
  readonly mode:'resolve'|'penetrate';
  /** Energy consumed by fracture/plastic work while bodies continue through each other. */
  readonly energyLoss?:number;
}
export type ContactModel=(contact:ContactCandidate)=>ContactDecision;

export interface Contact {
  readonly a:string;
  readonly b:string|'ground';
  readonly normal:Vec3;
  readonly point:Vec3;
  readonly penetration:number;
  readonly impulse:number;
  readonly normalSpeed:number;
  readonly normalEnergy:number;
  readonly mode:'resolve'|'penetrate';
}
export interface PhysicsStats {steps:number;substeps:number;contacts:number;bodies:number}

/** Deterministic rigid-body contact core. Material failure may replace bounce with energy-consuming penetration. */
export class PhysicsWorld {
  readonly bodies=new Map<string,RigidBody>();
  readonly contacts:Contact[]=[];
  readonly index:SpatialHash<RigidBody>;
  steps=0;substeps=0;
  constructor(
    readonly gravity:Vec3=[0,-9.81,0],
    readonly ground=0,
    cellSize=8,
    readonly groundMaterial:PhysicalMaterial=material('concrete'),
  ){this.index=new SpatialHash<RigidBody>(cellSize);}

  add(body:RigidBody):RigidBody{if(this.bodies.has(body.id))throw new TypeError(`Duplicate body ${body.id}`);this.bodies.set(body.id,body);return body;}
  remove(id:string):boolean{return this.bodies.delete(id);}
  clear():void{this.bodies.clear();this.index.clear();this.contacts.length=0;this.steps=0;this.substeps=0;}

  step(dt:number,contactModel?:ContactModel):void{
    if(!Number.isFinite(dt)||dt<=0||dt>.25)throw new RangeError('Physics dt must be in (0, 0.25]');
    this.contacts.length=0;
    const substeps=this.adaptiveSubsteps(dt),subDt=dt/substeps;
    for(let substep=0;substep<substeps;substep++)this.stepSubstep(subDt,contactModel);
    this.steps++;this.substeps+=substeps;
  }

  private adaptiveSubsteps(dt:number):number{
    let required=1;
    for(const body of this.bodies.values()){
      if(!body.invMass)continue;
      const speed=Math.hypot(body.velocity[0],body.velocity[1],body.velocity[2]),travel=speed*dt;
      const feature=body.shape.kind==='sphere'?body.shape.radius*1.5:Math.max(.025,Math.min(body.shape.half[0],body.shape.half[1],body.shape.half[2])*1.5);
      required=Math.max(required,Math.ceil(travel/Math.max(.015,feature)));
    }
    return Math.max(1,Math.min(12,required));
  }

  private stepSubstep(dt:number,contactModel?:ContactModel):void{
    for(const body of this.bodies.values())if(body.invMass){
      body.velocity[0]+=this.gravity[0]*dt;body.velocity[1]+=this.gravity[1]*dt;body.velocity[2]+=this.gravity[2]*dt;
      body.position[0]+=body.velocity[0]*dt;body.position[1]+=body.velocity[1]*dt;body.position[2]+=body.velocity[2]*dt;
      body.rotation[0]+=body.angularVelocity[0]*dt;body.rotation[1]+=body.angularVelocity[1]*dt;body.rotation[2]+=body.angularVelocity[2]*dt;
      this.resolveGround(body);
    }
    this.rebuildIndex();
    const seen=new Set<string>(),scratch:RigidBody[]=[];
    for(const a of this.bodies.values()){
      if(!a.invMass)continue;
      const radius=shapeRadius(a.shape),candidates=this.index.near(a.position[0],a.position[2],radius*2+2,scratch);
      for(const b of candidates){
        if(a===b||a.collisionClass==='debris'&&b.collisionClass==='debris')continue;
        const key=a.id<b.id?`${a.id}\u0000${b.id}`:`${b.id}\u0000${a.id}`;
        if(seen.has(key))continue;seen.add(key);
        if(!a.invMass&&!b.invMass)continue;
        const hit=intersect(a,b);
        if(!hit)continue;
        const candidate=this.contactCandidate(a,b,hit),decision=contactModel?.(candidate)??{mode:'resolve' as const};
        if(decision.mode==='penetrate')this.resolvePenetration(candidate,Math.max(0,decision.energyLoss??0));
        else this.resolvePair(candidate);
      }
    }
  }

  get stats():PhysicsStats{return{steps:this.steps,substeps:this.substeps,contacts:this.contacts.length,bodies:this.bodies.size};}

  private contactCandidate(a:RigidBody,b:RigidBody,hit:Hit):ContactCandidate{
    const rv:Vec3=[b.velocity[0]-a.velocity[0],b.velocity[1]-a.velocity[1],b.velocity[2]-a.velocity[2]];
    const approachSpeed=Math.max(0,-V3.dot(rv,hit.normal));
    const inv=a.invMass+b.invMass,effectiveMass=inv>0?1/inv:0;
    return{a,b,normal:hit.normal,point:hit.point,penetration:hit.penetration,approachSpeed,effectiveMass,normalEnergy:.5*effectiveMass*approachSpeed*approachSpeed};
  }

  private rebuildIndex():void{
    this.index.clear();this.index.beginBatch();
    for(const body of this.bodies.values()){body.syncSpatial();this.index.add(body,shapeRadius(body.shape));}
    this.index.endBatch();
  }

  private resolveGround(body:RigidBody):void{
    const bottom=body.position[1]-verticalExtent(body.shape);if(bottom>=this.ground)return;
    const penetration=this.ground-bottom;body.position[1]+=penetration;
    const speed=Math.max(0,-body.velocity[1]),normalEnergy=.5*body.mass*speed*speed;
    let impulse=0;
    if(body.velocity[1]<0){const before=body.velocity[1],restitution=Math.min(body.restitution,this.groundMaterial.restitution);body.velocity[1]=-body.velocity[1]*restitution;impulse=Math.abs((body.velocity[1]-before)*body.mass);}
    const damping=Math.max(0,1-Math.sqrt(body.friction*this.groundMaterial.friction)*.035);body.velocity[0]*=damping;body.velocity[2]*=damping;
    this.contacts.push({a:body.id,b:'ground',normal:[0,1,0],point:[body.position[0],this.ground,body.position[2]],penetration,impulse,normalSpeed:speed,normalEnergy,mode:'resolve'});
  }

  private resolvePenetration(contact:ContactCandidate,energyLoss:number):void{
    const {a,b,normal,approachSpeed,effectiveMass,normalEnergy}=contact;
    if(approachSpeed<=0||effectiveMass<=0){this.pushContact(contact,0,'penetrate');return;}
    const remaining=Math.max(0,normalEnergy-energyLoss);
    const after=Math.sqrt(2*remaining/effectiveMass);
    const impulse=Math.max(0,(approachSpeed-after)/(a.invMass+b.invMass));
    this.applyImpulse(a,b,normal,impulse);
    this.pushContact(contact,impulse,'penetrate');
  }

  private resolvePair(contact:ContactCandidate):void{
    const {a,b,normal,penetration,approachSpeed}=contact,inv=a.invMass+b.invMass;if(inv<=0)return;
    const slop=.0005,correction=Math.max(0,penetration-slop)*.8/inv;
    if(a.invMass){a.position[0]-=normal[0]*correction*a.invMass;a.position[1]-=normal[1]*correction*a.invMass;a.position[2]-=normal[2]*correction*a.invMass;}
    if(b.invMass){b.position[0]+=normal[0]*correction*b.invMass;b.position[1]+=normal[1]*correction*b.invMass;b.position[2]+=normal[2]*correction*b.invMass;}
    let impulse=0;
    if(approachSpeed>0){
      const restitution=Math.min(a.restitution,b.restitution),j=(1+restitution)*approachSpeed/inv;impulse=j;this.applyImpulse(a,b,normal,j);
      const post:Vec3=[b.velocity[0]-a.velocity[0],b.velocity[1]-a.velocity[1],b.velocity[2]-a.velocity[2]],normalSpeed=V3.dot(post,normal);
      const tangentRaw:Vec3=[post[0]-normal[0]*normalSpeed,post[1]-normal[1]*normalSpeed,post[2]-normal[2]*normalSpeed],length=V3.length(tangentRaw);
      if(length>1e-8){
        const tangent=V3.scale(tangentRaw,1/length),limit=j*Math.sqrt(a.friction*b.friction),jt=Math.max(-limit,Math.min(limit,-V3.dot(post,tangent)/inv));
        this.applyImpulse(a,b,tangent,jt);
      }
    }
    this.pushContact(contact,impulse,'resolve');
  }

  private applyImpulse(a:RigidBody,b:RigidBody,normal:Vec3,j:number):void{
    const ix=normal[0]*j,iy=normal[1]*j,iz=normal[2]*j;
    if(a.invMass){a.velocity[0]-=ix*a.invMass;a.velocity[1]-=iy*a.invMass;a.velocity[2]-=iz*a.invMass;}
    if(b.invMass){b.velocity[0]+=ix*b.invMass;b.velocity[1]+=iy*b.invMass;b.velocity[2]+=iz*b.invMass;}
  }
  private pushContact(contact:ContactCandidate,impulse:number,mode:'resolve'|'penetrate'):void{
    this.contacts.push({a:contact.a.id,b:contact.b.id,normal:contact.normal,point:contact.point,penetration:contact.penetration,impulse,normalSpeed:contact.approachSpeed,normalEnergy:contact.normalEnergy,mode});
  }
}

function verticalExtent(shape:CollisionShape):number{return shape.kind==='sphere'?shape.radius:shape.half[1];}
export function shapeRadius(shape:CollisionShape):number{return shape.kind==='sphere'?shape.radius:Math.hypot(shape.half[0],shape.half[2]);}
interface Hit{normal:Vec3;penetration:number;point:Vec3}
function intersect(a:RigidBody,b:RigidBody):Hit|null{
  if(a.shape.kind==='sphere'&&b.shape.kind==='sphere')return sphereSphere(a,b);
  if(a.shape.kind==='box'&&b.shape.kind==='box')return boxBox(a,b);
  return a.shape.kind==='sphere'?sphereBox(a,b,false):sphereBox(b,a,true);
}
function sphereSphere(a:RigidBody,b:RigidBody):Hit|null{
  const d:Vec3=[b.position[0]-a.position[0],b.position[1]-a.position[1],b.position[2]-a.position[2]],distance=V3.length(d),ar=(a.shape as {radius:number}).radius,br=(b.shape as {radius:number}).radius,radius=ar+br;
  if(distance>=radius)return null;const normal:Vec3=distance>1e-8?V3.scale(d,1/distance):[1,0,0];
  return{normal,penetration:radius-distance,point:[a.position[0]+normal[0]*ar,a.position[1]+normal[1]*ar,a.position[2]+normal[2]*ar]};
}
function boxBox(a:RigidBody,b:RigidBody):Hit|null{
  const ah=(a.shape as {half:Vec3}).half,bh=(b.shape as {half:Vec3}).half,dx=b.position[0]-a.position[0],dy=b.position[1]-a.position[1],dz=b.position[2]-a.position[2],px=ah[0]+bh[0]-Math.abs(dx),py=ah[1]+bh[1]-Math.abs(dy),pz=ah[2]+bh[2]-Math.abs(dz);
  if(px<=0||py<=0||pz<=0)return null;
  const point:Vec3=[(a.position[0]+b.position[0])/2,(a.position[1]+b.position[1])/2,(a.position[2]+b.position[2])/2];
  if(px<=py&&px<=pz)return{normal:[Math.sign(dx)||1,0,0],penetration:px,point};
  if(py<=pz)return{normal:[0,Math.sign(dy)||1,0],penetration:py,point};
  return{normal:[0,0,Math.sign(dz)||1],penetration:pz,point};
}
function sphereBox(sphere:RigidBody,box:RigidBody,invert:boolean):Hit|null{
  const radius=(sphere.shape as {radius:number}).radius,half=(box.shape as {half:Vec3}).half;
  const x=Math.max(box.position[0]-half[0],Math.min(sphere.position[0],box.position[0]+half[0])),y=Math.max(box.position[1]-half[1],Math.min(sphere.position[1],box.position[1]+half[1])),z=Math.max(box.position[2]-half[2],Math.min(sphere.position[2],box.position[2]+half[2]));
  let d:Vec3=[x-sphere.position[0],y-sphere.position[1],z-sphere.position[2]],distance=V3.length(d);
  if(distance>=radius)return null;
  if(distance<1e-8){
    const axis:Vec3=[sphere.position[0]-box.position[0],sphere.position[1]-box.position[1],sphere.position[2]-box.position[2]],gaps=[half[0]-Math.abs(axis[0]),half[1]-Math.abs(axis[1]),half[2]-Math.abs(axis[2])];
    const i=gaps[0]!<=gaps[1]!&&gaps[0]!<=gaps[2]!?0:gaps[1]!<=gaps[2]!?1:2;
    const outward:Vec3=i===0?[Math.sign(axis[0])||1,0,0]:i===1?[0,Math.sign(axis[1])||1,0]:[0,0,Math.sign(axis[2])||1];
    d=outward;const normal=invert?V3.scale(d,-1):d;
    return{normal,penetration:radius+gaps[i]!,point:[sphere.position[0]+d[0]*radius,sphere.position[1]+d[1]*radius,sphere.position[2]+d[2]*radius]};
  }
  d=V3.scale(d,1/distance);const normal=invert?V3.scale(d,-1):d;
  return{normal,penetration:radius-distance,point:[x,y,z]};
}
