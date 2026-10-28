import test from 'node:test';
import assert from 'node:assert/strict';
import {stepCharacterMotion,CHARACTER_MOTION_TUNING,CHARACTER_MOTION_MODE} from '../dist/runtime/character-motion.js';
const body=()=>({x:0,y:0,z:0,vx:0,vy:0,vz:0,yaw:0,lookYaw:0,grounded:true,phase:0,speed:0,coyote:.1,jumpBuffer:0,jumpHeld:false,landTime:0,stamina:1});
const input={forward:1,right:0,yaw:0,sprint:false,jump:false};
test('explicit curved support walkability and selected contact survive the Engine motor',()=>{
 const p=body(),world={blocked:()=>false,floor:()=>({y:0,normal:[0,.2,0],walkable:true,material:'metal',supportId:'original-roof'})};
 stepCharacterMotion(p,input,world);assert.equal(p.grounded,true);assert.equal(p.y,0);assert.equal(p.footMaterial,'metal');assert.equal(p.footSupportId,'original-roof');
 stepCharacterMotion(p,input,world,1/60,undefined,CHARACTER_MOTION_MODE.LOCKED);assert(!('footMaterial'in p));assert(!('footSupportId'in p));
 const steep=body();stepCharacterMotion(steep,input,{...world,floor:()=>({y:0,normal:[0,1,0],walkable:false})});assert.equal(steep.grounded,false);
});
test('normalized stamina capacity preserves physical work and jump cost',()=>{
 const p=body(),world={blocked:()=>false,floor:()=>({y:0,normal:[0,1,0]})};
 stepCharacterMotion(p,{...input,sprint:true,jump:true},world,1/60,{...CHARACTER_MOTION_TUNING,staminaCapacity:5});
 assert(Math.abs(p.stamina-(1-(.09/60+.08)/5))<1e-12);assert.equal(p.grounded,false);
});
test('application action modes permit aimed running and full walking speed without changing default aiming',()=>{
 const world={blocked:()=>false,floor:()=>({y:0,normal:[0,1,0]})},ordinary=body(),action=body();
 for(let i=0;i<60;i++){
  stepCharacterMotion(ordinary,{...input,aim:true,sprint:true},world);
  stepCharacterMotion(action,{...input,aim:true,sprint:true},world,1/60,undefined,CHARACTER_MOTION_MODE.SPRINT_AIM|CHARACTER_MOTION_MODE.FULL_AIM_SPEED);
 }
 assert(action.z>ordinary.z*2);assert(action.vz>6.7);assert(ordinary.vz<2.36);
});
