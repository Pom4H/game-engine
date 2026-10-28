import {OpenWorld,type WorldChunk} from './game/world.js';
import {characterState,type CharacterState} from '../../src/runtime/character-motor.js';
import {buildOfficeLayout,objectBounds,type OfficeLayout} from './office-layout.js';
import {bindingFor,localPoint,worldPoint,type Binding,type Bounds,type LiftState,type OfficeState,type Vec3} from './shared.js';

export const LIFT={x:0,z:-9.4,width:3.25,depth:2.5,front:-8.15};
const near=(n:number,a:number,b:number)=>n>=a&&n<=b;
export function readOfficeState(raw:unknown):OfficeState{
 const state=structuredClone(raw) as OfficeState;
 if(!state||state.version!==1||!Number.isSafeInteger(state.revision)||state.revision<0||!Array.isArray(state.floors)||state.floors.length<1||state.floors.length>12||!Array.isArray(state.objects)||state.objects.length>1200)throw new TypeError('Invalid office state');
 const identity=(x:unknown):x is string=>typeof x==='string'&&/^[A-Za-z0-9_:.\/-]{1,150}$/.test(x)&&!['__proto__','constructor','prototype'].includes(x);
 const floors=new Set<string>();for(const f of state.floors){if(!f||!identity(f.id)||floors.has(f.id)||typeof f.name!=='string'||f.name.length>80||typeof f.wallpaper!=='string'||f.wallpaper.length>32)throw new TypeError('Invalid office floor');floors.add(f.id);}
 const ids=new Map<string,OfficeState['objects'][number]>();
 const kinds=new Set(['desk','chair','plant','sofa','table','wall','window','door','corridor','room','server','aquarium','pet']);
 for(const o of state.objects){if(!o||!identity(o.id)||ids.has(o.id)||!kinds.has(o.kind)||!floors.has(o.floor)||![o.x,o.z,o.rotation].every(Number.isFinite)||Math.abs(o.x)>14||Math.abs(o.z)>10||Math.abs(o.rotation)>36000||typeof o.color!=='string'||o.color.length>32||typeof o.label!=='string'||o.label.length>100)throw new TypeError('Invalid office object');for(const key of ['width','depth','height'] as const)if(o[key]!==undefined&&(!Number.isFinite(o[key])||o[key]!<.01||o[key]!>28))throw new TypeError('Invalid office dimensions');ids.set(o.id,o);}
 for(const o of state.objects){for(const ref of [o.parent,o.host,o.from,o.to])if(ref!==undefined&&(!identity(ref)||ref===o.id||!ids.has(ref)&&!ref.startsWith('shell:')||ids.has(ref)&&ids.get(ref)!.floor!==o.floor))throw new TypeError('Invalid office reference');const visited=new Set([o.id]);let parent=o.parent;while(parent){if(visited.has(parent))throw new TypeError('Office parent cycle');visited.add(parent);parent=ids.get(parent)?.parent;}}
 if(!floors.has(state.activeFloor))throw new TypeError('Invalid active floor');return state;
}

/** The same authoritative boxes support the motor and both rendered views. */
export class BuildingWorld extends OpenWorld{
 readonly binding:Binding;
 readonly lift:LiftState={floor:2,target:2,elevation:6.6,door:1,phase:'idle',velocity:0};
 layout:OfficeState|null=null;layoutRevision=0;
 readonly floorLayouts=new Map<number,OfficeLayout>();
 readonly officeObstacles=new Map<number,Bounds[]>();
 constructor(seed=29,epoch=1){super(seed);this.binding=bindingFor(seed,epoch);}
 override chunk(cx:number,cz:number):WorldChunk{
  const c=super.chunk(cx,cz),x=this.binding?.origin[0]??-224,z=this.binding?.origin[2]??-32;
  return {...c,props:c.props.filter(p=>!(p.kind==='building'&&Math.abs(p.x-x)<1&&Math.abs(p.z-z)<1))};
 }
 setLayout(raw:unknown):void{
  const state=readOfficeState(raw),plans=new Map<number,OfficeLayout>(),obstacles=new Map<number,Bounds[]>();
  for(let i=0;i<state.floors.length;i++){
   const floor=this.binding.officeFloor+i,plan=buildOfficeLayout({...state,activeFloor:state.floors[i]!.id});
   const solids:Bounds[]=[...plan.obstacles];
   for(const o of state.objects.filter(o=>o.floor===state.floors[i]!.id&&['desk','chair','plant','sofa','table','server','aquarium'].includes(o.kind)))solids.push(plan.objects.get(o.id)??objectBounds(o));
   plans.set(floor,plan);obstacles.set(floor,solids);
  }
  this.layout=state;this.floorLayouts.clear();this.officeObstacles.clear();for(const [f,p]of plans)this.floorLayouts.set(f,p);for(const [f,p]of obstacles)this.officeObstacles.set(f,p);
  this.binding.floorCount=Math.max(6,this.binding.officeFloor+state.floors.length);this.layoutRevision++;
 }
 toLocal(p:Vec3):Vec3{return localPoint(this.binding,p);}
 inBuilding(x:number,z:number,margin=0):boolean{const p=this.toLocal([x,0,z]);return Math.abs(p[0])<=14+margin&&near(p[2],-10.8-margin,10+margin);}
 inCabin(p:{x:number;y:number;z:number},margin=0):boolean{const q=this.toLocal([p.x,p.y,p.z]);return Math.abs(q[0]-LIFT.x)<LIFT.width/2-margin&&Math.abs(q[2]-LIFT.z)<LIFT.depth/2-margin&&Math.abs(q[1]-this.lift.elevation)<.28;}
 atThreshold(p:{x:number;y:number;z:number}):boolean{const q=this.toLocal([p.x,p.y,p.z]);return Math.abs(q[0])<1.65&&Math.abs(q[2]-LIFT.front)<.46&&Math.abs(q[1]-this.lift.elevation)<.4;}
 liftNearby(p:{x:number;y:number;z:number}):{floor:number;inside:boolean}|null{if(this.inCabin(p))return{floor:this.lift.floor,inside:true};const q=this.toLocal([p.x,p.y,p.z]),floor=Math.round(q[1]/this.binding.floorHeight);return floor>=0&&floor<this.binding.floorCount&&Math.abs(q[1]-floor*this.binding.floorHeight)<.35&&Math.abs(q[0])<2.6&&q[2]<-6&&q[2]>-10.8?{floor,inside:false}:null;}
 override blocked(x:number,y:number,z:number,height:number,radius:number):boolean{
  if(super.blocked(x,y,z,height,radius))return true;
  if(!this.inBuilding(x,z,radius+.2))return false;
  const [lx,ly,lz]=this.toLocal([x,y,z]),shaft=Math.abs(lx)<1.84&&near(lz,-10.8,-8.10);
  // The shaft enclosure and closed landing gates are physical even when hidden in Office.
  if(lz<-8.1){if(Math.abs(lx)>LIFT.width/2&&Math.abs(lx)<1.95||lz<-10.65)return true;if(shaft&&Math.abs(lz-LIFT.front)<radius+.08&&!(this.lift.door>.95&&Math.abs(ly-this.lift.elevation)<.3))return true;}
  for(let floor=0;floor<this.binding.floorCount;floor++){
   const base=floor*this.binding.floorHeight;if(ly>=base+3.1||ly+height<=base+.02)continue;
   const plan=this.officeObstacles.get(floor);
   if(plan){for(const b of plan){if(b.id==='shell:rear'&&shaft)continue;if(intersects(b,lx,ly-base,lz,height,radius))return true;}}
   else{
    if(Math.abs(lx)>13.78&&Math.abs(lx)<14.25||lz<-9.78&&!shaft||lz>9.78&&!(floor===0&&Math.abs(lx)<1.6))return true;
   }
  }
  return false;
 }
 override floor(x:number,y:number,z:number,range:number):{y:number;normal:readonly[number,number,number]}|null{
  let result=super.floor(x,y,z,range);if(!this.inBuilding(x,z))return result;
  const [lx,,lz]=this.toLocal([x,y,z]),shaft=Math.abs(lx)<1.85&&near(lz,-10.8,-8.10);
  const supports:number[]=[];
  if(shaft){if(Math.abs(lx)<LIFT.width/2&&near(lz,LIFT.z-LIFT.depth/2,LIFT.front))supports.push(this.binding.origin[1]+this.lift.elevation);}
  else if(Math.abs(lx)<14&&near(lz,-10,10))for(let i=0;i<=this.binding.floorCount;i++)supports.push(this.binding.origin[1]+i*this.binding.floorHeight);
  for(const h of supports)if(h<=y+.001&&h>=y-range&&(!result||h>result.y))result={y:h,normal:[0,1,0]};return result;
 }
 override spawn(slot=0):{x:number;y:number;z:number}{const p=worldPoint(this.binding,[(slot%4-.5)*.6,0,12+Math.floor(slot/4)*.6]);return{x:p[0],y:p[1],z:p[2]};}
 officeSpawn(slot=0):CharacterState{const p=worldPoint(this.binding,[(slot%3-1)*.6,0,-6.2+Math.floor(slot/3)*.7],this.binding.officeFloor);return characterState(...p);}
}
function intersects(b:Bounds,x:number,y:number,z:number,height:number,radius:number):boolean{
 const base=b.baseY??0;if(y+height<=base+.012||y>=base+b.height-.012)return false;
 const dx=x-b.x,dz=z-b.z,c=Math.cos(b.rotation),s=Math.sin(b.rotation),a=Math.max(0,Math.abs(c*dx-s*dz)-b.width/2),v=Math.max(0,Math.abs(s*dx+c*dz)-b.depth/2);return a*a+v*v<radius*radius;
}

export class BuildingLift{
 private readonly queue:number[]=[];private hold=0;private readonly requests=new Map<string,number>();
 constructor(readonly world:BuildingWorld){}
 request(actor:{id:string;state:CharacterState},floor:number,time:number):boolean{
  const near=this.world.liftNearby(actor.state);if(!near||!Number.isInteger(floor)||floor<0||floor>=this.world.binding.floorCount||!near.inside&&floor!==near.floor||time-(this.requests.get(actor.id)??-Infinity)<.35)return false;
  this.requests.set(actor.id,time);const l=this.world.lift;
  if(l.phase==='idle'&&floor===l.floor){l.door=1;this.hold=.75;return true;}
  if(this.queue.length>=12)return false;if(!this.queue.includes(floor)&&!(l.phase!=='idle'&&l.target===floor))this.queue.push(floor);return true;
 }
 step(actors:Iterable<{state:CharacterState}>,dt=1/60):void{
  if(dt!==1/60)throw new RangeError('Lift uses authority fixed tick');const people=[...actors].map(a=>a.state),l=this.world.lift;l.velocity=0;
  if(l.phase==='idle'){this.hold=Math.max(0,this.hold-dt);if(this.queue.length&&this.hold===0){l.target=this.queue.shift()!;l.phase=l.target===l.floor?'opening':'closing';}}
  else if(l.phase==='closing'){if(people.some(p=>this.world.atThreshold(p))){l.phase='opening';this.queue.unshift(l.target);this.hold=1;}else{l.door=Math.max(0,l.door-dt*1.5);if(l.door===0)l.phase='moving';}}
  else if(l.phase==='moving'){
   const end=l.target*this.world.binding.floorHeight,delta=Math.sign(end-l.elevation)*Math.min(dt*2.2,Math.abs(end-l.elevation));
   for(const p of people)if(this.world.inCabin(p)){p.y+=delta;p.vx=p.vy=p.vz=p.speed=0;p.grounded=true;p.jumpBuffer=0;}
   l.elevation+=delta;l.velocity=delta/dt;if(Math.abs(l.elevation-end)<1e-7){l.floor=l.target;l.phase='opening';}
  }else{l.door=Math.min(1,l.door+dt*1.5);if(l.door===1){l.phase='idle';this.hold=.75;}}
 }
 recover(state:CharacterState):CharacterState{const p={...state};if(this.world.inCabin(p)){const floor=Math.max(0,Math.min(this.world.binding.floorCount-1,Math.round(this.world.lift.elevation/this.world.binding.floorHeight))),landing=worldPoint(this.world.binding,[0,0,-6.5],floor);p.x=landing[0];p.y=landing[1];p.z=landing[2];p.vx=p.vy=p.vz=p.speed=0;p.grounded=true;}return p;}
 forget(id:string):void{this.requests.delete(id);}
}
