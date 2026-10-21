import test from 'node:test';
import assert from 'node:assert/strict';
import {stepCharacterMotion,advanceCharacterMotion,CHARACTER_MOTION_MODE as Mode,CHARACTER_MOTION_EVENT as Event} from '../dist/runtime/character-motion.js';
import {characterState,idleCharacterInput,stepCharacter} from '../dist/runtime/character-motor.js';
const ground={blocked:()=>false,floor:(_x,y,_z,range)=>y>=0&&y-range<=0?{y:0,normal:[0,1,0]}:null};

test('full Engine motion retains an existing body and obeys application action locks before querying physics',()=>{
 const p=Object.assign(characterState(2,0,3),{vx:4,vz:2,stamina:.5,pitch:0,animation:'drive',externalId:'same-body'}),before={...p};let queries=0;
 const world={blocked:()=>{queries++;throw Error('Locked actor queried collision');},floor:()=>{queries++;throw Error('Locked actor queried floor');}};
 assert.equal(stepCharacterMotion(p,{...idleCharacterInput(1),pitch:4,forward:1,jump:true},world,1/60,undefined,Mode.LOCKED),0);assert.equal(queries,0);assert.deepEqual([p.x,p.y,p.z],[before.x,before.y,before.z]);assert.equal(p.externalId,'same-body');assert.equal(p.animation,'drive');assert.equal(p.stamina,before.stamina);assert.equal(p.lookYaw,1);assert.equal(p.pitch,1.15);assert.equal(p.vx,0);assert.equal(p.vz,0);
});

test('jump reports a physical event once, uses optional stamina and leaves gameplay effects to the application',()=>{
 const p=Object.assign(characterState(0,0,0),{stamina:.08});let jumps=0;
 for(let i=0;i<30;i++)if(stepCharacterMotion(p,{...idleCharacterInput(),jump:true},ground)&Event.JUMPED)jumps++;
 assert.equal(jumps,1);assert.equal(p.stamina,0);assert.ok(p.y>0);assert.equal('combatRest'in p,false);
 const absent=characterState(0,0,0);for(let i=0;i<1200;i++)stepCharacterMotion(absent,{...idleCharacterInput(),forward:1,sprint:true},ground);assert.ok(absent.z>130);assert.equal(absent.stamina,undefined);
});

test('footprint support and legal crouching protect a restored low-ceiling body without a placement write',()=>{
 let footprintQueries=0;const world={blocked:(x,_y,_z,height)=>x<1&&height>1.2,floor:()=>null,footing:()=>{footprintQueries++;return {y:.3,normal:[0,1,0]};}},p=characterState(0,.3,0);
 stepCharacterMotion(p,{...idleCharacterInput(Math.PI/2),forward:1},world);assert.equal(p.crouch,true);assert.equal(p.y,.3);
 let maxStep=0;for(let i=0;i<180;i++){const x=p.x,y=p.y;stepCharacterMotion(p,{...idleCharacterInput(Math.PI/2),forward:1},world);maxStep=Math.max(maxStep,Math.hypot(p.x-x,p.y-y));}
 assert.ok(footprintQueries>0);assert.ok(p.x>1);assert.equal(p.crouch,false);assert.equal(p.y,.3);assert.ok(maxStep<.06);
});

test('an unresolved head overlap cannot remove real floor support, while absent support still permits falling',()=>{
 const p=characterState(0,0,0),blocked={...ground,blocked:()=>true,recover:()=>null};
 for(let i=0;i<120;i++)stepCharacterMotion(p,idleCharacterInput(),blocked);
 assert.equal(p.y,0);assert.equal(p.vy,0);assert.equal(p.grounded,true);
 const falling=characterState(0,0,0);for(let i=0;i<120;i++)stepCharacterMotion(falling,idleCharacterInput(),{blocked:()=>false,floor:()=>null});
 assert.ok(falling.y< -30);assert.equal(falling.grounded,false);
});

test('the compatibility API keeps its existing state shape and bounded presentation phase while using Engine motion',()=>{
 const p=characterState(0,0,0),keys=Object.keys(p);p.phase=1e8;
 for(let i=0;i<120;i++)stepCharacter(p,{...idleCharacterInput(),forward:1},ground);
 assert.deepEqual(Object.keys(p),keys);assert.ok(p.z>6);assert.ok(p.phase>=0&&p.phase<Math.PI*2000);
 for(const dt of [0,-1,NaN,Infinity,1/20])assert.throws(()=>stepCharacterMotion(p,idleCharacterInput(),ground,dt),RangeError);
});

test('a slow authority-owned decision interval subdivides into bounded steps and preserves one body',()=>{
 const p=Object.assign(characterState(0,0,0),{stamina:1}),expected={...p},input={...idleCharacterInput(.7),forward:1,jump:true};
 const events=advanceCharacterMotion(p,input,ground,.05);let expectedEvents=0;for(let i=0;i<2;i++)expectedEvents|=stepCharacterMotion(expected,input,ground,.025);
 assert.equal(events,expectedEvents);assert.ok(events&Event.JUMPED);assert.deepEqual(p,expected);assert.ok(p.y>0);
 for(const dt of [0,-1,NaN,Infinity,.101])assert.throws(()=>advanceCharacterMotion(p,input,ground,dt),RangeError);
});
