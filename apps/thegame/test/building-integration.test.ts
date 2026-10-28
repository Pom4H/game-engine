import {test,expect} from 'bun:test';
import {BuildingWorld,BuildingLift,LIFT} from '../building.ts';
import {worldPoint,type CharacterState,type CharacterInput} from '../shared.ts';
import {characterState,idleCharacterInput,stepCharacter} from '../../../src/runtime/character-motor.ts';

type Rider={id:string;state:CharacterState};
function journey(){
 const world=new BuildingWorld(29,1),lift=new BuildingLift(world),spawn=world.spawn();
 const riders:Rider[]=[{id:'p1',state:characterState(spawn.x,spawn.y,spawn.z)}];let tick=0;
 const advance=(inputs:CharacterInput[]=[])=>{lift.step(riders);riders.forEach((r,i)=>stepCharacter(r.state,inputs[i]??idleCharacterInput(r.state.lookYaw),world));tick++;};
 const walk=(r:Rider,x:number,z:number,max=700)=>{
  const target=worldPoint(world.binding,[x,0,z]);
  for(let i=0;i<max;i++){
   const dx=target[0]-r.state.x,dz=target[2]-r.state.z,d=Math.hypot(dx,dz);
   if(d<.06){for(let j=0;j<12;j++)advance();return;}
   const input={...idleCharacterInput(Math.atan2(dx,dz)),forward:Math.min(1,d*1.8)};
   advance(riders.map(person=>person===r?input:idleCharacterInput(person.state.lookYaw)));
  }
  throw new Error(`Motor could not walk to ${x},${z}; actual ${world.toLocal([r.state.x,r.state.y,r.state.z])}`);
 };
 const arrive=(floor:number)=>{
  for(let i=0;i<1800;i++){advance();if(world.lift.floor===floor&&world.lift.phase==='idle'&&world.lift.door===1)return;}
  throw new Error(`Lift did not arrive at floor ${floor}: ${JSON.stringify(world.lift)}`);
 };
 return{world,lift,riders,advance,walk,arrive,time:()=>tick/60};
}

test('canonical motor walks street, calls the lift, enters Office, visits every floor, and returns to street',()=>{
 const j=journey(),r=j.riders[0]!;
 j.walk(r,0,-7.2);
 expect(j.world.inCabin(r.state)).toBe(false);
 expect(j.lift.request(r,0,j.time())).toBe(true);j.arrive(0);
 j.walk(r,0,LIFT.z);expect(j.world.inCabin(r.state)).toBe(true);
 const residentState=r.state;
 expect(j.lift.request(r,2,j.time())).toBe(true);j.arrive(2);
 expect(r.state).toBe(residentState);expect(r.state.y).toBeCloseTo(6.6,6);
 j.walk(r,0,-6.2);expect(j.world.inCabin(r.state)).toBe(false);
 expect(j.world.toLocal([r.state.x,r.state.y,r.state.z])[2]).toBeCloseTo(-6.2,1);
 j.walk(r,0,LIFT.z);
 for(const floor of [1,3,4,5,0]){
  expect(j.lift.request(r,floor,j.time())).toBe(true);j.arrive(floor);
  expect(r.state.y).toBeCloseTo(floor*j.world.binding.floorHeight,6);
  expect(r.state.grounded).toBe(true);
 }
 j.walk(r,0,12);expect(r.state.y).toBe(0);
 expect(j.world.inBuilding(r.state.x,r.state.z)).toBe(false);j.world.dispose();
});

test('two riders walk into the cabin and the authoritative lift carries both on the same ticks',()=>{
 const j=journey(),r=j.riders[0]!,spawn=j.world.spawn(1),other={id:'p2',state:characterState(spawn.x,spawn.y,spawn.z)};
 j.riders.push(other);j.walk(r,-.45,-7.2);j.walk(other,.45,-7.2);
 expect(j.lift.request(r,0,j.time())).toBe(true);j.arrive(0);
 j.walk(r,-.45,LIFT.z);j.walk(other,.45,LIFT.z);
 expect(j.world.inCabin(r.state)).toBe(true);expect(j.world.inCabin(other.state)).toBe(true);
 expect(j.lift.request(r,5,j.time())).toBe(true);
 let observedMoving=false;
 for(let i=0;i<1400;i++){
  j.advance();
  expect(r.state.y).toBeCloseTo(other.state.y,6);
  if(j.world.lift.phase==='moving')observedMoving=true;
  if(j.world.lift.floor===5&&j.world.lift.phase==='idle')break;
 }
 expect(observedMoving).toBe(true);expect(r.state.y).toBeCloseTo(16.5,6);j.world.dispose();
});

test('doorway occupant prevents departure and closed gates prevent motor entry from another floor',()=>{
 const j=journey(),r=j.riders[0]!;
 j.walk(r,0,-7.2);expect(j.lift.request(r,0,j.time())).toBe(true);j.arrive(0);j.walk(r,0,LIFT.z);
 expect(j.lift.request(r,2,j.time())).toBe(true);
 // Trusted boundary fixture: position a rider precisely across the door sweep.
 Object.assign(r.state,characterState(...worldPoint(j.world.binding,[0,0,LIFT.front])));
 for(let i=0;i<150;i++)j.advance();
 expect(j.world.lift.elevation).toBe(0);expect(j.world.lift.phase).not.toBe('moving');
 j.walk(r,0,-7.2);j.arrive(2);
 for(let i=0;i<120;i++)j.advance([{...idleCharacterInput(Math.PI),forward:1}]);
 expect(j.world.toLocal([r.state.x,r.state.y,r.state.z])[2]).toBeGreaterThan(LIFT.front-.05);
 expect(r.state.y).toBe(0);j.world.dispose();
});

test('all six landings have flat floor support and retain physical walls while the stairs are absent',()=>{
 const world=new BuildingWorld();
 for(let floor=0;floor<world.binding.floorCount;floor++){
  const y=floor*world.binding.floorHeight;
  for(const [x,z] of [[0,0],[7,2],[-7,-5],[0,-6.2]]){
   const p=worldPoint(world.binding,[x!,0,z!],floor);
   expect(world.floor(p[0],p[1]+.1,p[2],.2)?.y).toBeCloseTo(y,8);
   expect(world.blocked(p[0],p[1],p[2],1.8,.29)).toBe(false);
  }
  const outside=worldPoint(world.binding,[14,0,0],floor);
  expect(world.blocked(outside[0],outside[1],outside[2],1.8,.29)).toBe(true);
 }
 // Trusted boundary fixture: a falling character lands on a slab rather than passing through it.
 const state=characterState(...worldPoint(world.binding,[5,1.2,2],3));state.grounded=false;
 for(let i=0;i<100;i++)stepCharacter(state,idleCharacterInput(),world);
 expect(state.y).toBeCloseTo(9.9,6);expect(state.grounded).toBe(true);world.dispose();
});

test('a rider can select a different floor while the cabin is travelling between landings',()=>{
 const j=journey(),r=j.riders[0]!;
 j.walk(r,0,-7.2);expect(j.lift.request(r,0,j.time())).toBe(true);j.arrive(0);j.walk(r,0,LIFT.z);
 expect(j.lift.request(r,5,j.time())).toBe(true);
 for(let i=0;i<500;i++){
  j.advance();if(j.world.lift.phase==='moving'&&j.world.lift.elevation>1&&j.world.lift.elevation<2)break;
 }
 expect(j.world.inCabin(r.state)).toBe(true);expect(j.world.lift.elevation).toBeGreaterThan(1);expect(j.world.lift.elevation).toBeLessThan(2);
 expect(j.lift.request(r,3,j.time())).toBe(true);j.arrive(5);j.arrive(3);
 expect(r.state.y).toBeCloseTo(9.9,6);j.world.dispose();
});
