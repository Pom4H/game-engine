import type {Vec3} from '../math.js';
import {PhysicsWorld,RigidBody} from '../physics/world.js';
import {StructuralBody} from '../physics/structure.js';
import {StructuralRigidContacts} from '../physics/structural-rigid.js';
import {elasticSphere} from '../procedural/elastic-sphere.js';
import {ArcadeVehicle,idleInput,readArcadeInput} from '../vehicles/arcade.js';
import {vehicle,wheel} from '../vehicles/components.js';
import {projection,buffer,vector3,scalar,type Stamp} from '../network/projection.js';

export const ARENA_DT=1/120;
export const BALL=elasticSphere();
export const FIELD={halfLength:28,halfWidth:18,height:12,goalHalfWidth:5,goalHeight:4} as const;
export const PADS:readonly Vec3[]=[[-18,.05,-12],[-18,.05,12],[18,.05,-12],[18,.05,12],[0,.05,-10],[0,.05,10]];
export interface ArenaBox {id:string;position:Vec3;size:Vec3;visible:boolean;}
export const arenaBoxes:readonly ArenaBox[]=[
 {id:'floor',position:[0,-.5,0],size:[70,1,42],visible:true},
 {id:'ceiling',position:[0,12.5,0],size:[70,1,42],visible:false},
 ...[-1,1].flatMap(s=>[
  {id:`side:${s}`,position:[0,6,s*18.5] as Vec3,size:[66,12,1] as Vec3,visible:true},
  ...[-1,1].map(t=>({id:`end:${s}:${t}`,position:[s*28.5,6,t*11.5] as Vec3,size:[1,12,13] as Vec3,visible:true})),
  {id:`crossbar:${s}`,position:[s*28.5,8,0] as Vec3,size:[1,8,10] as Vec3,visible:true},
  {id:`net:${s}`,position:[s*33,2,0] as Vec3,size:[1,4,10] as Vec3,visible:true},
  ...[-1,1].map(t=>({id:`goal-side:${s}:${t}`,position:[s*30.5,2,t*5.5] as Vec3,size:[5,4,1] as Vec3,visible:true})),
  {id:`goal-roof:${s}`,position:[s*30.5,4.5,0] as Vec3,size:[5,1,10] as Vec3,visible:false},
 ]),
];
export const arenaProjection=projection('car-ball/v1',{
 car0:vector3(),rotation0:vector3('angle'),velocity0:vector3(),car1:vector3(),rotation1:vector3('angle'),velocity1:vector3(),
 ball:vector3(),nodes:buffer(BALL.definition.nodes.length*3),boost:buffer(2,{min:0,max:100}),score:buffer(2,{sample:'step',min:0,max:1e6,integer:true}),
 remaining:scalar('linear',0,300),phase:scalar('step',0,3),pads:buffer(PADS.length,{sample:'step',min:0,max:6}),ack:buffer(2,{sample:'step',min:0,max:0x7fffffff,integer:true}),spin:buffer(8),compression:buffer(8),steer:buffer(2),
},{maxEntities:1,maxBytes:32_000,maxStride:256});
const blueprint=(id:string)=>vehicle(id,{chassis:{massKg:300,sizeM:[4.65,.72,1.888],dragAreaM2:.8},parts:
 [1,-1].flatMap(x=>[-1,1].map(z=>wheel(`${x>0?'front':'rear'}.${z>0?'right':'left'}`,{
  at:[x>0?1.5365:-1.3005,.04,z*.787],massKg:15,radiusM:.34,widthM:.25,steerRad:x>0?.6:0,driveTorqueNm:450,drivePowerW:18000,brakeTorqueNm:900,grip:1.7,
  suspension:{restM:.32,travelM:.2,springNPerM:19000,damperNsPerM:1700},
 }))),});
/** Executable game recipe. Browser-independent authoritative state, no network/GPU I/O.
 * Car mass integrates only in PhysicsWorld; the ball mass only in StructuralBody. */
export class CarBallArena {
 readonly world=new PhysicsWorld([0,-16,0],0);
 readonly cars:[ArcadeVehicle,ArcadeVehicle];
 ball=new StructuralBody(BALL.definition);
 readonly contacts:StructuralRigidContacts;
 readonly score=[0,0];readonly pads=new Float64Array(PADS.length);readonly ack=[0,0];
 private readonly inputTicks=[-1e9,-1e9];
 tick=0;time=0;generation=0;remaining=300;phase=0;private countdown=1.5;private overtime=false;
 constructor(){
  const boundaries=arenaBoxes.map(box=>new RigidBody({id:box.id,position:box.position,shape:{kind:'box',half:box.size.map(n=>n/2) as unknown as Vec3},restitution:.75,friction:.45}));
  // The implicit ground owns rigid floor contact. The nodal solver uses its matching box.
  for(const b of boundaries)if(b.id!=='floor')this.world.add(b);
  this.cars=[new ArcadeVehicle(this.world,blueprint('car:0'),{position:[-16,.64,0]}),new ArcadeVehicle(this.world,blueprint('car:1'),{position:[16,.64,0],rotation:[0,Math.PI,0]})];
  for(const car of this.cars){car.body.restitution=.7;car.body.friction=.18;}
  this.contacts=new StructuralRigidContacts([...boundaries,...this.cars.map(c=>c.body)],BALL.surfaceNodes);
  this.ball.translate([0,1.7,0]);this.ball.wake();
 }
 input(seat:number,sequence:number,raw:unknown):boolean {
  if(!Number.isInteger(seat)||seat<0||seat>1||!Number.isSafeInteger(sequence)||sequence<1||sequence>0x7fffffff)throw new RangeError('Input identity');
  if(sequence<=this.ack[seat]!)return false;
  const input=readArcadeInput(raw),prior=this.cars[seat]!.input.jumpSerial;
  if(input.jumpSerial<prior||input.jumpSerial-prior>8)throw new RangeError('Jump sequence');
  this.cars[seat]!.input=input;this.ack[seat]=sequence;this.inputTicks[seat]=this.tick;return true;
 }
 release(seat:number):void {const c=this.cars[seat];if(c)c.input={...idleInput(),jumpSerial:c.input.jumpSerial};}
 step(dt=ARENA_DT):void {
  if(dt!==ARENA_DT)throw new RangeError('Arena uses fixed 120 Hz ticks');
  for(let i=0;i<2;i++)if(this.tick-this.inputTicks[i]!>30)this.release(i);
  if(this.phase!==1){
   this.countdown-=dt;
   for(const c of this.cars){c.input={...idleInput(),jumpSerial:c.input.jumpSerial};c.discardJumpEdges();}
   if(this.countdown<=0&&this.phase!==3){if(this.phase===2)this.kickoff();this.phase=1;}
  }
  for(let n=0;n<2;n++){
   this.world.step(dt/2);
   // Keep elastic rest lengths while in rigid flight; auto-bake is for explicit structural LOD handoff.
   this.ball.wake();this.contacts.begin(dt/2);this.ball.step(dt/2,this.world.gravity,this.contacts.project);this.contacts.finish(this.ball);
  }
  if(this.phase===1){
   this.remaining=Math.max(0,this.remaining-dt);
   const side=this.goal();
   if(side!==null){this.score[side]!++;this.phase=this.overtime?3:2;this.countdown=2;}
   else if(this.remaining===0){if(this.score[0]===this.score[1])this.overtime=true;else this.phase=3;}
   for(let n=0;n<PADS.length;n++){
    this.pads[n]=Math.max(0,this.pads[n]!-dt);if(this.pads[n]!>0)continue;
    for(const c of this.cars){const p=c.body.position,q=PADS[n]!;if(c.boost<100&&Math.hypot(p[0]-q[0],p[2]-q[2])<1.5&&p[1]<1.7){c.boost=100;this.pads[n]=6;break;}}
   }
  }
  this.tick++;this.time=this.tick*dt;
 }
 /** A goal requires the WHOLE deformed surface across the line and inside the mouth. */
 goal():0|1|null {
  const p=this.ball.position;
  for(const sign of [-1,1]){
   let inside=true;
   for(let n=0;n<BALL.surfaceNodes;n++)if(sign*p[n*3]!<=28||Math.abs(p[n*3+2]!)>=5||p[n*3+1]!<-.001||p[n*3+1]!>=4){inside=false;break;}
   if(inside)return sign>0?0:1;
  }
  return null;
 }
 kickoff():void {
  this.cars[0].reset([-16,.64,0],[0,0,0]);this.cars[1].reset([16,.64,0],[0,Math.PI,0]);
  this.ball=new StructuralBody(BALL.definition);this.ball.translate([0,1.7,0]);this.ball.wake();this.pads.fill(0);this.generation++;
 }
 capture(at:Stamp){
  const a=this.cars[0].body,b=this.cars[1].body;
  return arenaProjection.capture(at,[{id:'arena',generation:this.generation,data:{car0:a.position,rotation0:a.rotation,velocity0:a.velocity,car1:b.position,rotation1:b.rotation,velocity1:b.velocity,
   ball:this.ball.centerOfMass(),nodes:this.ball.position,boost:this.cars.map(c=>c.boost),score:this.score,remaining:this.remaining,phase:this.phase,pads:this.pads,ack:this.ack,spin:this.cars.flatMap(c=>c.blueprint.parts.map(p=>c.part(p.source.id).spinRad)),compression:this.cars.flatMap(c=>c.blueprint.parts.map(p=>c.part(p.source.id).compressionM)),steer:this.cars.map(c=>c.input.steer)}}]);
 }
 dump(){return{tick:this.tick,time:this.time,world:this.world.stats,ball:this.ball.stats,contacts:this.contacts.contacts,score:[...this.score],restorable:false};}
 dispose():void {for(const c of this.cars)c.dispose();this.world.clear();}
}
