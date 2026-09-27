import test from 'node:test';
import assert from 'node:assert/strict';
import {CarBallArena,BALL,ARENA_DT,arenaProjection} from '../dist/examples/car-ball.js';
import {CarBallView,arenaOffset as o} from '../dist/examples/car-ball-view.js';
import {idleInput,readArcadeInput} from '../dist/vehicles/arcade.js';
import {Replica,Publication} from '../dist/network/index.js';
import {elasticSphere} from '../dist/procedural/elastic-sphere.js';
import {StructuralBody} from '../dist/physics/structure.js';
import {StructuralRigidContacts} from '../dist/physics/structural-rigid.js';
import {RigidBody} from '../dist/physics/world.js';
import {DynamicMesh} from '../dist/procedural/dynamic-mesh.js';
import {WebGPURenderer} from '../dist/render/webgpu.js';
const stamp=a=>({epoch:1,sequence:a.tick+1,tick:a.tick,time:a.time,paused:false});
function run(control,ticks=480){const a=new CarBallArena();let maxY=0;for(let i=0;i<ticks;i++){a.input(0,i+1,{...idleInput(),...control(i)});a.step();maxY=Math.max(maxY,a.cars[0].body.position[1]);}return{a,maxY,car:a.cars[0]};}

test('only explicit bounded input fields may write a seat; stale packets and jump serials are fenced',()=>{
 for(const raw of [null,{},[],{...idleInput(),position:[99,0,0]},{...idleInput(),throttle:Infinity},{...idleInput(),jumpSerial:1.1},{...idleInput(),boost:1}])assert.throws(()=>readArcadeInput(raw));
 const a=new CarBallArena();assert.throws(()=>a.input(2,1,idleInput()));assert.throws(()=>a.input(0,1,{...idleInput(),jumpSerial:9}));
 assert.ok(a.input(0,1,{...idleInput(),throttle:1}));assert.equal(a.input(0,1,{...idleInput(),throttle:-1}),false);assert.equal(a.cars[0].input.throttle,1);
 assert.throws(()=>a.step(1/60));a.phase=1;for(let i=0;i<32;i++)a.step();assert.equal(a.cars[0].input.throttle,0);a.dispose();
});
test('tap, held jump and second jump use the same physical integrator; no third airborne jump',()=>{
 const tap=run(t=>t>=200?{jumpSerial:1,jump:t<202}:{}),hold=run(t=>t>=200?{jumpSerial:1,jump:t<224}:{}),twice=run(t=>t>=200?{jumpSerial:t<230?1:t<235?2:3,jump:t<224||t>=230&&t<232}:{});
 assert.ok(tap.maxY>1.5);assert.ok(hold.maxY>tap.maxY+1);assert.ok(twice.maxY>hold.maxY+1);
 assert.equal(tap.car.stats.jumps,1);assert.equal(hold.car.stats.jumps,1);assert.equal(twice.car.stats.jumps,2);
 for(const r of [tap,hold,twice]){assert.equal(r.a.world.steps,960);r.a.dispose();}
});
test('directional second jump flips and air roll changes orientation; boost is finite and consumed',()=>{
 const r=run(t=>t>=200?{jumpSerial:t<230?1:2,jump:t<224||t>=230&&t<232,pitch:t>=230?-1:0,roll:.6,boost:true}:{});
 assert.equal(r.car.stats.jumps,2);assert.equal(r.car.stats.dodges,1);assert.ok(Math.abs(r.car.body.rotation[0])>.01);assert.ok(r.car.boost<100&&r.car.boost>=0);
 assert.ok(r.car.stats.boostSeconds>1);assert.ok(r.car.body.position.every(Number.isFinite));r.a.dispose();
});
test('wheel-powered car strikes the REAL deformable ball; deterministic controls preserve the same world',t=>{
 const trace=()=>run(i=>i>=200?{throttle:1,boost:true}: {},420).a,a=trace(),b=trace();
 assert.deepEqual(a.capture(stamp(a)),b.capture(stamp(b)));assert.ok(a.contacts.contacts>0);assert.ok(a.ball.centerOfMass()[0]>2||a.score[0]>0);
 const initial=BALL.definition.nodes;let strain=0;
 for(const c of BALL.definition.constraints)if(c.kind==='distance'){
  const distance=p=>Math.hypot(...[0,1,2].map(k=>p[c.a*3+k]-p[c.b*3+k]));
  const rest=initial.flatMap(n=>[...n.position]);strain=Math.max(strain,Math.abs(distance(a.ball.position)/distance(rest)-1));
 }
 assert.ok(strain>1e-5);assert.equal([...a.world.bodies.values()].some(body=>body.id==='ball'),false);
 t.diagnostic(JSON.stringify({nodes:a.ball.nodeCount,contacts:a.contacts.contacts,strain,ball:a.ball.centerOfMass(),score:a.score}));a.dispose();b.dispose();
});
test('soft/rigid contact transfers equal-and-opposite linear momentum without a rigid ball proxy',t=>{
 const shell=elasticSphere(.5,3,1),s=new StructuralBody(shell.definition);
 const b=new RigidBody({id:'box',mass:30,position:[1.6,0,0],shape:{kind:'box',half:[.3,1,1]},restitution:.5,friction:0});
 const contact=new StructuralRigidContacts([b],shell.surfaceNodes,.5,0),dt=1/240;s.activateFromRigid(s.centerOfMass(),[5,0,0],[0,0,0]);
 const momentum=()=>[0,1,2].map(k=>b.velocity[k]*30+shell.definition.nodes.reduce((sum,n,i)=>sum+n.mass*s.velocity[i*3+k],0));
 const start=momentum();let maxError=0;
 for(let i=0;i<100;i++){for(let k=0;k<3;k++)b.position[k]+=b.velocity[k]*dt;contact.begin(dt);s.wake();s.step(dt,[0,0,0],contact.project);contact.finish(s);for(let k=0;k<3;k++)maxError=Math.max(maxError,Math.abs(momentum()[k]-start[k]));}
 assert.ok(contact.contacts>0);assert.ok(b.velocity[0]>.1);assert.ok(maxError<1e-9);t.diagnostic(JSON.stringify({maxLinearMomentumError:maxError,contacts:contact.contacts,boxVx:b.velocity[0]}));
});
test('a goal needs the complete deformed ball through the mouth; only one score and a fenced kickoff',()=>{
 const a=new CarBallArena();a.phase=1;
 a.ball=new StructuralBody(BALL.definition);a.ball.translate([28,2,0]);assert.equal(a.goal(),null);
 a.ball.translate([2,0,0]);assert.equal(a.goal(),0);a.ball.wake();a.step();assert.deepEqual(a.score,[1,0]);assert.equal(a.phase,2);
 for(let i=0;i<241;i++)a.step();assert.deepEqual(a.score,[1,0]);assert.equal(a.generation,1);assert.ok(Math.abs(a.ball.centerOfMass()[0])<.01);a.dispose();
});
test('replicas skin the same immutable publication, reuse vertex buffers and seek without client physics',()=>{
 const a=new CarBallArena(),packets=[];for(let i=0;i<260;i++){a.input(0,i+1,{...idleInput(),throttle:i>200?1:0});a.step();if(i%4===0)packets.push(new Publication(arenaProjection,a.capture(stamp(a))).text());}
 const viewers=[new CarBallView(),new CarBallView()],clients=viewers.map(()=>new Replica(arenaProjection,1,100));
 const steps=a.world.steps,positions=a.ball.position.slice(),keys=viewers.map(v=>v.ballMesh.key),meshes=viewers.map(v=>v.ballMesh.vertices);
 for(const r of clients)for(const text of packets){const f=arenaProjection.decode(text);r.receive(f,f.time);}
 for(const time of [1,2,.3,1.8,2])for(let i=0;i<2;i++){viewers[i].apply(clients[i].at(time));assert.equal(viewers[i].ballMesh.vertices,meshes[i]);assert.equal(viewers[i].ballMesh.key,keys[i]);assert.equal(viewers[i].scene.physics.steps,0);assert.equal(viewers[i].scene.physics.bodies.size,0);}
 assert.deepEqual(viewers[0].ballMesh.positions,viewers[1].ballMesh.positions);assert.deepEqual(a.ball.position,positions);assert.equal(a.world.steps,steps);
 // An epoch reset at the same presentation time must not skip newly installed state.
 const view=viewers[0],r=clients[0];r.reset(2);const f=structuredClone(a.capture(stamp(a)));f.epoch=2;f.time=2;f.rows[0].generation=3;f.rows[0].values[o.nodes]+=1;r.receive(f,3);view.apply(r.at(2));assert.equal(view.ballMesh.positions[0],f.rows[0].values[o.nodes]);
 a.dispose();viewers.forEach(v=>v.dispose());
});
test('unwrapped wheel phase does not reverse at speeds above half a turn per network snapshot',()=>{
 const a=new CarBallArena(),frames=[a.capture(stamp(a)),structuredClone(a.capture(stamp(a)))];frames[1].sequence=2;frames[1].tick=4;frames[1].time=1/30;
 frames[0]=structuredClone(frames[0]);frames[0].rows[0].values[o.spin]=6;frames[1].rows[0].values[o.spin]=11;
 const r=new Replica(arenaProjection,1);r.receive(frames[0],0);r.receive(frames[1],1/30);assert.equal(r.at(1/60).rows[0].values[o.spin],8.5);a.dispose();
});
test('dynamic geometry updates one existing GPU vertex buffer; topology and cache identity stay stable',()=>{
 const m=new DynamicMesh([0,0,0,1,0,0,0,1,0],[0,1,2]),renderer=Object.create(WebGPURenderer.prototype),created=[],writes=[];
 Object.assign(renderer,{meshes:new Map(),meshByPrimitive:new WeakMap(),buffer(data){const buffer={data};created.push(buffer);return buffer;},device:{queue:{writeBuffer(...args){writes.push(args);}}},profiler:{addUpload(){}}});
 const first=renderer.mesh(m),count=created.length;assert.equal(count,3);m.positions[0]=-.4;m.commit();const next=renderer.mesh(m);
 assert.equal(next,first);assert.equal(created.length,count);assert.equal(writes.length,1);assert.equal(writes[0][0],first.vertex);assert.equal(writes[0][2],m.vertices);renderer.mesh(m);assert.equal(writes.length,1);
 assert.throws(()=>new DynamicMesh([0,NaN,0],[0]));m.positions[0]=Infinity;assert.throws(()=>m.commit());
});
