import type {MutableVec3,Vec3} from '../math.js';
import {finiteVec3} from '../math.js';
import {PhysicsWorld,RigidBody,type PhysicsForceDriver} from '../physics/world.js';
import {ForceFrame} from '../physics/force-frame.js';
import {DeformationAttachment,type DeformationField} from '../physics/deformation-field.js';
import {solveWheelContact,type WheelContactResult} from '../physics/wheel-contact.js';
import {PartCondition} from './condition.js';
import type {CompiledComponent,VehicleBlueprint,WingSpec,WheelSpec} from './components.js';
export {vehicle,wheel,wing,type VehicleBlueprint,type VehicleSpec,type WingSpec,type WheelSpec} from './components.js';
export {PartCondition,type ConditionSpec} from './condition.js';
export type {DeformationField} from '../physics/deformation-field.js';

export interface VehicleControls {readonly handbrake?:number;readonly throttle?:number;readonly brake?:number;readonly steer?:number;readonly pitch?:number;readonly roll?:number;readonly flap?:number;}
export interface VehicleAir {readonly densityKgM3:number;readonly wind:Vec3;}
export interface VehiclePose {readonly position?:Vec3;readonly rotation?:Vec3;readonly velocity?:Vec3;readonly angularVelocity?:Vec3;}
export interface PartSample {
  readonly id:string;readonly kind:'wheel'|'wing';readonly force:Vec3;readonly point:Vec3;
  /** COM-local frame used by the most recent physical force evaluation. */
  readonly localPosition:Vec3;readonly localChord:Vec3;readonly localNormal:Vec3;readonly mountValid:boolean;
  readonly loadN:number;readonly liftN:number;readonly dragN:number;readonly alphaRad:number;readonly stall:number;
  readonly angularSpeed:number;readonly spinRad:number;readonly compressionM:number;readonly permanentSetM:number;
  readonly plasticWorkJ:number;readonly slipPowerW:number;readonly dissipatedJ:number;readonly wear:number;readonly fatigue:number;readonly failed:boolean;
  readonly temperatureRiseK:number;readonly effectiveRadiusM:number;readonly effectiveGrip:number;readonly treadDepthM:number;readonly derivedBuilds:number;
}
interface PartRuntime {
  readonly compiled:CompiledComponent;readonly condition:PartCondition;
  readonly attachment:DeformationAttachment;readonly localArm:MutableVec3;
  readonly force:MutableVec3;readonly point:MutableVec3;readonly arm:MutableVec3;readonly velocity:MutableVec3;
  readonly chord:MutableVec3;readonly normal:MutableVec3;readonly localChord:MutableVec3;readonly localNormal:MutableVec3;
  readonly wheelSolve:WheelContactResult;
  revision:number;control:number;radius:number;tread:number;grip:number;liftScale:number;omega:number;spin:number;longForce:number;sideForce:number;
  load:number;lift:number;drag:number;alpha:number;stall:number;compression:number;permanent:number;plasticWork:number;
  slipPower:number;derivedBuilds:number;
}
const clamp=(x:number,a=0,b=1)=>Math.max(a,Math.min(b,x));
const dot=(a:Vec3,b:Vec3)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const ZERO:Vec3=[0,0,0];
// Read-only borrowed vectors, without exposing writable simulation arrays.
const viewVector=(v:MutableVec3):Vec3=>Object.freeze(Object.defineProperties([0,0,0],{
  0:{get:()=>v[0]},1:{get:()=>v[1]},2:{get:()=>v[2]},
})) as unknown as Vec3;

/** Composition of wheel/aerodynamic force generators on one existing PhysicsWorld body.
 * No car/aircraft mode, no private clock, no second pose integration. Current support backend:
 * static world.ground plane. A failed wing remains attached mass (no debris claim). */
export class Vehicle implements PhysicsForceDriver {
  readonly maxStepSeconds=1/120;
  readonly body:RigidBody;
  readonly frame=new ForceFrame();
  readonly force=this.frame.force;
  readonly torque=this.frame.torque;
  private readonly parts:PartRuntime[];
  private readonly byId=new Map<string,PartRuntime>();
  private readonly views=new Map<string,PartSample>();
  private readonly controls={handbrake:0,throttle:0,brake:0,steer:0,pitch:0,roll:0,flap:0};
  private air:VehicleAir={densityKgM3:1.225,wind:[0,0,0]};
  private readonly unbind:()=>void;
  private disposed=false;
  private deformation:DeformationField|undefined;
  private readonly ownsBody:boolean;
  private readonly dragForce:MutableVec3=[0,0,0];
  private readonly referenceFrame:ForceFrame|undefined;
  readonly diagnostics={steps:0,supportQueries:0,aeroEvaluations:0,wheelSolves:0};
  constructor(readonly world:PhysicsWorld,readonly blueprint:VehicleBlueprint,pose:VehiclePose={},options:{reuseDerived?:boolean;body?:RigidBody}={}) {
    const position=pose.position??ZERO,rotation=pose.rotation??ZERO,velocity=pose.velocity??ZERO,angular=pose.angularVelocity??ZERO;
    for(const v of [position,rotation,velocity,angular])finiteVec3(v,'Vehicle pose');
    this.frame.update(rotation);const offset:MutableVec3=[0,0,0];this.frame.rotate(blueprint.centerOfMass,offset);
    const size=blueprint.source.chassis.sizeM;
    this.ownsBody=options.body===undefined;
    this.body=options.body??new RigidBody({id:blueprint.source.id,mass:blueprint.massKg,shape:{kind:'box',half:[size[0]/2,size[1]/2,size[2]/2]},position:[position[0]+offset[0],position[1]+offset[1],position[2]+offset[2]],rotation,velocity,angularVelocity:angular,friction:.5,restitution:.05});
    if(options.body){
      const b=options.body;
      if(Object.keys(pose).length||world.bodies.get(b.id)!==b||b.id!==blueprint.source.id||b.mass!==blueprint.massKg||!b.invMass||b.shape.kind!=='box'||b.shape.half.some((v,k)=>v!==size[k]!/2))throw new TypeError('Adopted body must be the matching scene-owned vehicle; supply pose to Scene.add');
      this.frame.update(b.rotation);
    }
    this.parts=blueprint.parts.map(compiled=>{
      const mount=compiled.source.mountAt,com=blueprint.centerOfMass;
      const anchor:Vec3=mount?[mount[0]-com[0],mount[1]-com[1],mount[2]-com[2]]:compiled.arm;
      const part:PartRuntime={compiled,attachment:new DeformationAttachment(anchor),localArm:[...compiled.arm],condition:new PartCondition(compiled.source.condition),force:[0,0,0],point:[0,0,0],arm:[0,0,0],velocity:[0,0,0],chord:[0,0,0],normal:[0,0,0],localChord:[0,0,0],localNormal:[0,0,0],wheelSolve:{force:0,sideForce:0,speed:0,slip:0,brake:0,targetForce:0,targetSide:0},revision:-1,control:NaN,radius:0,tread:0,grip:0,liftScale:1,omega:0,spin:0,longForce:0,sideForce:0,load:0,lift:0,drag:0,alpha:0,stall:0,compression:0,permanent:0,plasticWork:0,slipPower:0,derivedBuilds:0};
      if(compiled.source.kind==='wheel')part.omega=dot(this.body.velocity,[this.frame.basis[0]!,this.frame.basis[1]!,this.frame.basis[2]!])/compiled.source.radiusM;
      this.byId.set(compiled.source.id,part);return part;
    });
    this.referenceFrame=options.reuseDerived===false?new ForceFrame():undefined;
    if(this.ownsBody)world.add(this.body);
    try{this.unbind=world.drive(this.body,this);}catch(error){if(this.ownsBody)world.remove(this.body.id);throw error;}
    for(let k=0;k<3;k++){this.body.invInertiaLocal[k]=1/blueprint.inertia[k]!;this.body.collisionOffsetLocal[k]=-blueprint.centerOfMass[k]!;}
    for(const p of this.parts)this.derive(p);
  }
  get basisBuilds():number{return this.frame.builds+(this.referenceFrame?.builds??0);}
  /** Bind a physical shape owner, not an extra damage simulation. Body-local COM coordinates. */
  bindDeformation(field?:DeformationField):void {
    if(field&&(!Number.isSafeInteger(field.revision)||field.revision<0))throw new TypeError('Invalid deformation field');
    this.deformation=field;this.body.wake();
  }
  get deformationBuilds():number{return this.parts.reduce((n,p)=>n+p.attachment.builds,0);}
  get deformationSamples():number{return this.parts.reduce((n,p)=>n+p.attachment.samples,0);}
  setControls(input:VehicleControls):void {
    for(const [key,value] of Object.entries(input))if(!Object.hasOwn(this.controls,key)||typeof value!=='number'||!Number.isFinite(value)||value < (key==='brake'||key==='handbrake'?0:-1)||value>1)throw new RangeError(`Invalid control ${key}`);
    Object.assign(this.controls,input);if(Object.values(input).some(v=>v!==0))this.body.wake();
  }
  setAir(air:VehicleAir):void {
    finiteVec3(air.wind,'Wind');if(!Number.isFinite(air.densityKgM3)||air.densityKgM3<0||air.densityKgM3>100)throw new RangeError('Invalid air density');
    this.air={densityKgM3:air.densityKgM3,wind:[...air.wind]};this.body.wake();
  }
  /** Borrowed read-only live view, shared by presentation/audio/HUD. No allocations after first read.
   * Use structuredClone(view) explicitly when recording history. Reading never advances physics. */
  part(id:string):PartSample {
    const previous=this.views.get(id);if(previous)return previous;
    const p=this.byId.get(id);if(!p)throw new RangeError(`Unknown vehicle part ${id}`);
    const s=p.compiled.source,c=p.condition;
    const view:PartSample=Object.freeze({id,kind:s.kind,force:viewVector(p.force),point:viewVector(p.point),
      localPosition:viewVector(p.localArm),localChord:viewVector(p.localChord),localNormal:viewVector(p.localNormal),get mountValid(){return p.attachment.valid;},
      get loadN(){return p.load;},get liftN(){return p.lift;},get dragN(){return p.drag;},get alphaRad(){return p.alpha;},get stall(){return p.stall;},
      get angularSpeed(){return p.omega;},get spinRad(){return p.spin;},get compressionM(){return p.compression;},get permanentSetM(){return p.permanent;},get plasticWorkJ(){return p.plasticWork;},
      get slipPowerW(){return p.slipPower;},get dissipatedJ(){return c.dissipatedJ;},get wear(){return c.wear;},get fatigue(){return c.fatigue;},get failed(){return c.failed;},
      get temperatureRiseK(){return c.temperatureRiseK;},get effectiveRadiusM(){return p.radius;},get effectiveGrip(){return p.grip;},
      get treadDepthM(){return p.tread;},get derivedBuilds(){return p.derivedBuilds;},
    });
    this.views.set(id,view);return view;
  }
  /** Runtime instance removal releases the exact body's driver; no leaked per-part schedulers. */
  dispose():void {if(this.disposed)return;this.disposed=true;this.unbind();if(this.ownsBody&&this.world.bodies.get(this.body.id)===this.body)this.world.remove(this.body.id);}
  evaluate(dt:number):void {
    if(this.disposed)throw new Error('Vehicle disposed');
    if(!Number.isFinite(dt)||dt<=0||dt>this.maxStepSeconds+1e-12)throw new RangeError('Vehicle forces require <=1/120 s substeps');
    this.frame.clear();if(!this.referenceFrame)this.frame.update(this.body.rotation);this.diagnostics.steps++;
    const b=this.body,air=this.air;
    const vx=b.velocity[0]-air.wind[0],vy=b.velocity[1]-air.wind[1],vz=b.velocity[2]-air.wind[2];
    const speed=Math.hypot(vx,vy,vz),drag=-.5*air.densityKgM3*(this.blueprint.source.chassis.dragAreaM2??0)*speed;
    this.dragForce[0]=drag*vx;this.dragForce[1]=drag*vy;this.dragForce[2]=drag*vz;this.frame.add(this.dragForce,ZERO);
    for(const p of this.parts){
      const frame=this.referenceFrame??this.frame;if(this.referenceFrame)frame.update(b.rotation);
      const s=p.compiled.source;p.force.fill(0);p.load=p.lift=p.drag=p.alpha=p.stall=p.slipPower=0;
      this.derive(p);
      frame.rotate(p.localArm,p.arm);
      for(let k=0;k<3;k++)p.point[k]=b.position[k]!+p.arm[k]!;
      const r=p.arm,w=b.angularVelocity,v=p.velocity;
      v[0]=b.velocity[0]+w[1]*r[2]-w[2]*r[1];v[1]=b.velocity[1]+w[2]*r[0]-w[0]*r[2];v[2]=b.velocity[2]+w[0]*r[1]-w[1]*r[0];
      if(s.kind==='wing')this.aerodynamics(p,s,frame);
      else {this.wheelForces(p,s,frame,dt);p.spin+=p.omega*dt;}
      this.frame.add(p.force,p.arm);p.condition.observeLoad(s.kind==='wing'?p.lift:p.load);
    }
    // A sleeping supported body must react to changed wind or loss of support, too.
    if(b.sleeping&&(speed>.1||Math.hypot(...this.torque)>1||Math.hypot(this.force[0]+b.mass*this.world.gravity[0],this.force[1]+b.mass*this.world.gravity[1],this.force[2]+b.mass*this.world.gravity[2])>b.mass*.05))b.wake();
  }
  private derive(p:PartRuntime):void {
    const s=p.compiled.source,c=p.condition;
    const control=s.kind==='wheel'?this.controls.steer*(s.steerRad??0):s.control?this.controls[s.control]*(s.controlGainRad??0):0;
    const attachmentChanged=p.attachment.update(this.deformation,!this.referenceFrame);
    if(attachmentChanged){
      if(this.deformation)p.attachment.point(p.compiled.arm,p.localArm);
      else p.localArm.splice(0,3,...p.compiled.arm);
    }
    if(!this.referenceFrame&&!attachmentChanged&&p.revision===c.revision&&p.control===control)return;
    p.revision=c.revision;p.control=control;p.derivedBuilds++;
    if(s.kind==='wheel'){const depth=s.treadDepthM??Math.min(.008,s.radiusM*.03);p.tread=depth*(1-c.wear);p.radius=s.radiusM-depth*c.wear;}
    p.grip=s.kind==='wheel'?(s.grip??1.1)*(1-c.wear*(1-(s.wornGripFraction??.65))):0;
    p.liftScale=c.failed||!p.attachment.valid?0:1-c.wear*.35;
    const angle=s.kind==='wing'?(s.incidenceRad??0)+control:control,co=Math.cos(angle),si=Math.sin(angle),ch=p.compiled.chord,n=p.compiled.normal;
    for(let k=0;k<3;k++){p.localChord[k]=ch[k]!*co+n[k]!*si;p.localNormal[k]=n[k]!*co-ch[k]!*si;}
    if(s.kind==='wheel'){p.localChord[0]=co;p.localChord[1]=0;p.localChord[2]=si;p.localNormal[0]=0;p.localNormal[1]=1;p.localNormal[2]=0;}
    if(this.deformation){p.attachment.direction(p.localChord,p.localChord);p.attachment.direction(p.localNormal,p.localNormal);}
  }
  /** Finite-wing polar from thegame flight/aerodynamics.ts, evaluated on any assembly part. */
  private aerodynamics(p:PartRuntime,s:WingSpec,frame:ForceFrame):void {
    this.diagnostics.aeroEvaluations++;
    frame.rotate(p.localChord,p.chord);frame.rotate(p.localNormal,p.normal);
    const v=p.velocity,n=p.normal,ch=p.chord,air=this.air;
    const vx=v[0]-air.wind[0],vy=v[1]-air.wind[1],vz=v[2]-air.wind[2],v2=vx*vx+vy*vy+vz*vz;if(v2<1e-12||air.densityKgM3===0)return;
    const speed=Math.sqrt(v2),ux=vx/speed,uy=vy/speed,uz=vz/speed,vn=vx*n[0]+vy*n[1]+vz*n[2],vc=vx*ch[0]+vy*ch[1]+vz*ch[2];
    const alpha=Math.atan2(-vn,vc),effective=alpha-(s.zeroLiftRad??-.035),x=clamp((Math.abs(effective)-(s.stallRad??.26))/(s.stallWidthRad??.20)),stall=x*x*(3-2*x);
    const cl=(p.compiled.slope*effective*(1-stall)+1.1*Math.sin(2*alpha)*stall)*p.liftScale;
    const cd=(s.dragCoefficient??.025)+(1-p.liftScale)*.18+(1-stall)*cl*cl*p.compiled.induced+stall*1.9*Math.sin(alpha)**2;
    const lift=.5*air.densityKgM3*(vn*vn+vc*vc)*p.compiled.area*cl,drag=.5*air.densityKgM3*v2*p.compiled.area*cd;
    const un=ux*n[0]+uy*n[1]+uz*n[2];let lx=n[0]-ux*un,ly=n[1]-uy*un,lz=n[2]-uz*un;const norm=Math.hypot(lx,ly,lz);
    if(norm>1e-9){lx/=norm;ly/=norm;lz/=norm;}else{lx=ly=lz=0;}
    p.alpha=alpha;p.stall=stall;p.lift=norm>1e-9?lift:0;p.drag=drag;
    p.force[0]=lx*lift-ux*drag;p.force[1]=ly*lift-uy*drag;p.force[2]=lz*lift-uz*drag;
  }
  private wheelForces(p:PartRuntime,s:WheelSpec,frame:ForceFrame,dt:number):void {
    this.diagnostics.supportQueries++;
    frame.rotate(p.localChord,p.chord);frame.rotate(p.localNormal,p.normal);
    const b=frame.basis,upY=p.normal[1],susp=s.suspension,radius=p.radius;
    const motor=this.controls.throttle*(s.driveTorqueNm??0),torque=s.drivePowerW===undefined?motor:Math.sign(motor)*Math.min(Math.abs(motor),s.drivePowerW/Math.max(1,Math.abs(p.omega)));
    const slide=s.at[0]<0?this.controls.handbrake:0;
    const brake=Math.max(this.controls.brake,slide)*(s.brakeTorqueNm??0);
    const length=upY>.15?(p.point[1]-this.world.ground-radius)/upY:Infinity;
    p.compression=Math.max(0,susp.restM-length);
    if(length>=susp.restM||upY<=.15||p.condition.failed||!p.attachment.valid){
      p.longForce=p.sideForce=0;const free=p.omega+torque*dt/p.compiled.inertia;
      p.omega=Math.sign(free)*Math.max(0,Math.abs(free)-brake*dt/p.compiled.inertia);return;
    }
    const geometric=p.compression;
    // Compression-only elastoplastic spring return mapping. A held load is not another impact.
    if(susp.yieldForceN!==undefined){const next=Math.max(p.permanent,geometric-susp.yieldForceN/susp.springNPerM);p.plasticWork+=(next-p.permanent)*susp.yieldForceN;p.permanent=next;}
    const compressionSpeed=-p.velocity[1]/upY;
    p.load=Math.max(0,(susp.springNPerM*Math.max(0,geometric-p.permanent)+susp.damperNsPerM*compressionSpeed)/upY);
    if(geometric>susp.travelM)p.load+=susp.springNPerM*(geometric-susp.travelM)*3;
    let fx=p.chord[0],fz=p.chord[2];const fl=Math.hypot(fx,fz);if(fl<1e-9)return;fx/=fl;fz/=fl;
    const rx=-fz,rz=fx;
    // Force acts at the actual contact point. Recompute its lever/velocity once and share it.
    p.point[0]-=p.normal[0]*length;p.point[1]=this.world.ground;p.point[2]-=p.normal[2]*length;
    for(let k=0;k<3;k++)p.arm[k]=p.point[k]!-this.body.position[k]!;
    const arm=p.arm,w=this.body.angularVelocity,v=this.body.velocity;
    const pvx=v[0]+w[1]*arm[2]-w[2]*arm[1],pvz=v[2]+w[0]*arm[1]-w[1]*arm[0];
    const longitudinal=pvx*fx+pvz*fz,lateral=pvx*rx+pvz*rz;
    // Directional effective mass includes chassis angular inertia. The support is static.
    const tx=arm[1]*fz,ty=arm[2]*fx-arm[0]*fz,tz=-arm[1]*fx;
    const localX=tx*b[0]!+ty*b[1]!+tz*b[2]!,localY=tx*b[3]!+ty*b[4]!+tz*b[5]!,localZ=tx*b[6]!+ty*b[7]!+tz*b[8]!;
    const inv=this.body.invMass+localX*localX*this.body.invInertiaLocal[0]+localY*localY*this.body.invInertiaLocal[1]+localZ*localZ*this.body.invInertiaLocal[2];
    const relaxation=1-Math.exp(-Math.max(1,Math.abs(longitudinal))*dt/.25);
    solveWheelContact(p.wheelSolve,dt,radius,p.compiled.inertia,p.omega,longitudinal,-lateral/Math.max(1.25,Math.abs(longitudinal)),p.load*p.grip*(1-.75*slide),torque/radius,brake/radius,inv,p.longForce,p.sideForce,relaxation,12,9.5);
    this.diagnostics.wheelSolves++;const solved=p.wheelSolve;p.omega=solved.speed;p.longForce=solved.force;p.sideForce=solved.sideForce;
    p.force[0]=fx*solved.force+rx*solved.sideForce;p.force[1]=p.load;p.force[2]=fz*solved.force+rz*solved.sideForce;
    const slip=p.omega*radius-(longitudinal+solved.force*dt*inv);
    p.slipPower=Math.max(0,solved.force*slip-solved.sideForce*lateral);
    p.condition.consumeWork(p.slipPower*dt);
  }
}
