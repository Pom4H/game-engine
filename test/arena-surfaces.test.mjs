import test from 'node:test';
import assert from 'node:assert/strict';
import {CarBallArena,PADS,ARENA_DT,arenaBoxes,CAR_SCALE} from '../dist/examples/car-ball.js';
import {idleInput} from '../dist/vehicles/arcade.js';
import {ForceFrame} from '../dist/physics/force-frame.js';
import {advanceRotation,quaternionFromEuler} from '../dist/physics/rotation.js';
const dot=(a,b)=>a.reduce((n,v,k)=>n+v*b[k],0);
for(const [name,position,rotation,normal] of [
 ['floor',[0,.5,9],[0,0,0],[0,1,0]],
 ['side',[0,6,17.5],[-Math.PI/2,0,0],[0,0,-1]],
 ['ceiling',[0,11.5,0],[Math.PI,0,0],[0,-1,0]],
 ['end',[27.5,6,9],[0,0,Math.PI/2],[-1,0,0]],
])test(`wheel support, propulsion, jump normal and four-wheel reset on ${name}`,()=>{
 const a=new CarBallArena();a.phase=1;const c=a.cars[0];c.reset(position.map((v,k)=>v+normal[k]*(.5*CAR_SCALE-.5)),rotation);c.jumps=2;
 // Establish contact before throttle and verify that only complete wheel contact reloads it.
 for(let tick=0;tick<8;tick++)a.step();assert.equal(c.wheelContacts,4);assert.equal(c.jumps,0);assert.equal(c.stats.resets,1);
 assert.ok(dot(c.supportNormal,normal)>.99);
 const start=c.body.position.slice();for(let tick=0;tick<20;tick++){a.input(0,tick+1,{...idleInput(),throttle:1,boost:true});a.step();}
 assert.ok(Math.hypot(...c.body.position.map((v,k)=>v-start[k]))>.05);assert.ok(c.wheelContacts>=2);
 const before=c.body.velocity.slice();a.input(0,21,{...idleInput(),jump:true,jumpSerial:1});a.step();
 assert.equal(c.stats.jumps,1);assert.ok(dot(c.body.velocity.map((v,k)=>v-before[k]),normal)>4);assert.equal(c.jumps,1);
 // A held button or an old counter may not create a new jump after landing.
 c.reset(position.map((v,k)=>v+normal[k]*(.5*CAR_SCALE-.5)),rotation);c.jumps=2;for(let tick=0;tick<12;tick++){a.input(0,22+tick,{...idleInput(),jump:true,jumpSerial:1});a.step();}
 assert.equal(c.jumps,0);assert.equal(c.stats.jumps,1);a.dispose();
});
test('roof/body contact without wheels never reloads a spent jump',()=>{
 const a=new CarBallArena();a.phase=1;const c=a.cars[0];c.reset([0,.5,8],[Math.PI,0,0]);c.jumps=2;
 for(let tick=0;tick<120;tick++)a.step();assert.equal(c.wheelContacts,0);assert.equal(c.jumps,2);a.dispose();
});
test('one driven car reaches the wall and ceiling through the same rendered collision ramps',t=>{
 const a=new CarBallArena();a.phase=1;const c=a.cars[0];c.reset([0,.5,4],[0,-Math.PI/2,0]);let wall=0,ceiling=0;
 for(let i=0;i<300;i++){a.input(0,i+1,{...idleInput(),throttle:1,boost:i<240});a.step();if(c.wheelContacts>=2){if(Math.abs(c.supportNormal[1])<.25)wall++;if(c.supportNormal[1]<-.9)ceiling++;}}
 assert.ok(wall>2&&ceiling>10);assert.ok(arenaBoxes.filter(b=>b.id.startsWith('ramp:')).every(b=>b.visible&&b.rotation));
 t.diagnostic(JSON.stringify({wallSupportedTicks:wall,ceilingSupportedTicks:ceiling,pose:c.body.position}));a.dispose();
});
test('world angular velocity composes rotations correctly at arbitrary orientation, across the Euler singularity',()=>{
 const r=[.4,1.5707963267948966,-.7],q=new Float64Array(4),before=quaternionFromEuler(r),omega=[.8,-.9,.6],dt=.001;
 for(let i=0;i<1000;i++)advanceRotation(r,omega,dt,q);
 const after=quaternionFromEuler(r),s=Math.hypot(...omega),sn=Math.sin(s/2)/s,[x,y,z]=omega.map(v=>v*sn),w=Math.cos(s/2),[a,b,c,d]=before;
 const expected=[w*a+x*d+y*c-z*b,w*b-x*c+y*d+z*a,w*c+x*b-y*a+z*d,w*d-x*a-y*b-z*c];
 assert.ok(Math.abs(Math.abs(dot(after,expected))-1)<1e-10);assert.ok(r.every(Number.isFinite));
 for(const axis of [0,1,2]){const a=new CarBallArena();a.phase=1;const car=a.cars[0];car.reset([0,6,0],[.3,.4,.5]);const initial=car.body.rotation.slice(),i=idleInput();i[axis===0?'roll':axis===1?'steer':'pitch']=1;car.input=i;
  for(let n=0;n<36;n++)a.world.step(ARENA_DT/2);assert.ok(Math.hypot(...car.body.rotation.map((v,k)=>v-initial[k]))>.01);a.dispose();}
});
test('server boost pads spawn, award once, retain distinct capacities and respawn after their simulation cooldown',()=>{
 assert.equal(PADS.length,34);assert.equal(PADS.filter(p=>p.amount===100).length,6);
 for(const amount of [12,100]){const a=new CarBallArena();a.phase=1;const index=PADS.findIndex(p=>p.amount===amount),pad=PADS[index],c=a.cars[0];c.reset([pad.position[0],.5*CAR_SCALE,pad.position[2]],[0,0,0]);c.boost=1;
  a.step();assert.equal(c.boost,Math.min(100,1+amount));assert.equal(a.pads[index],pad.respawnSeconds);
  c.boost=0;c.reset([0,.5,0],[0,0,0]);
  for(let n=0;n<Math.round(pad.respawnSeconds/ARENA_DT)-1;n++)a.step();assert.ok(a.pads[index]>0);
  for(let n=0;n<2;n++)a.step();assert.equal(a.pads[index],0);a.dispose();
 }
});
