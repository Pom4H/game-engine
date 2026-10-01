import test from 'node:test';import assert from 'node:assert/strict';
import {OpenWorld,climateAt,cityLamps,WORLD_REVISION} from '../dist/games/thegame/world.js';
import {chunkGeometry} from '../dist/games/thegame/geometry.js';
import {ThegameAuthority,readCharacterInput,thegameConfig,worldSignature,peopleProjection} from '../dist/games/thegame/session.js';
import {characterState,stepCharacter,idleCharacterInput} from '../dist/runtime/character-motor.js';
import {InputReplay} from '../dist/network/input-replay.js';import {ChunkWindow} from '../dist/runtime/chunk-window.js';import {Replica} from '../dist/network/playback.js';
import {thegame,project} from '../dist/games/thegame/project.js';import {createThegameHost} from '../tools/thegame/host.mjs';
const walk=(yaw=Math.PI/2)=>({...idleCharacterInput(yaw),forward:1,sprint:true});
test('thegame world is deterministic and has exact continuous triangle seams, props and bounded residency',()=>{
 const a=new OpenWorld(29,8),b=new OpenWorld(29,8);for(const [cx,cz] of [[-1,-1],[-8,2],[6,-8],[10,10]]){
  const c=a.chunk(cx,cz),r=a.chunk(cx+1,cz);for(let z=0;z<=16;z++)assert.equal(c.heights[z*17+16],r.heights[z*17]);
  for(const p of c.props)assert.ok(Math.abs(p.y-a.ground(p.x,p.z).y)<1e-9);assert.deepEqual(c,b.chunk(cx,cz));
 }
 const kinds=new Set();for(let z=-3000;z<=3000;z+=300)for(let x=-3000;x<=3000;x+=300)kinds.add(climateAt(29,x,z).biome);assert.ok(kinds.size>=7);
 const lamps=cityLamps(-1,-1);assert.equal(lamps.length,4);assert.equal(new Set(lamps.map(l=>l.id)).size,4);assert.equal(cityLamps(4,0).length,0);
 for(let i=-100;i<100;i++)a.ground(i*128+7,i*37);assert.equal(a.inspect().chunks,8);assert.ok(a.stats.evicted>100);assert.throws(()=>a.chunk(Infinity,0));
});
test('rendered terrain triangles agree with collision, road/prop geometry stays chunk-local',()=>{
 const world=new OpenWorld();for(const [cx,cz] of [[-3,-1],[-8,-2],[10,0]]){const entities=chunkGeometry(world,cx,cz),mesh=entities[0].mesh;assert.ok(entities.length<=9) // material batches, not per-window/lamp draws
;assert.equal(mesh.indices.length,16*16*6);
 for(let i=0;i<mesh.indices.length;i+=3){const tri=mesh.indices.slice(i,i+3).map(k=>mesh.positions.slice(k*3,k*3+3)),x=tri.reduce((s,p)=>s+p[0],0)/3,z=tri.reduce((s,p)=>s+p[2],0)/3,y=tri.reduce((s,p)=>s+p[1],0)/3;assert.ok(Math.abs(world.ground(cx*128+x,cz*128+z).y-y)<1e-8);}
 for(const e of entities){assert.equal(e.collision,'none');if(e.mesh.kind==='triangle-mesh'){assert.ok(e.mesh.indices.length);assert.ok(e.mesh.positions.every(Number.isFinite));}}
 }
});
test('ported character motor has bounded speed, normalized diagonal, jump/landing and wall sliding',()=>{
 const floor={blocked:(x,y,z,h,r)=>x+r>10&&y<10,floor:(_x,y,_z,range)=>y>=0&&y-range<=0?{y:0,normal:[0,1,0]}:null},p=characterState(0,0,0);
 for(let i=0;i<600;i++)stepCharacter(p,walk(),floor);assert.ok(p.x<9.711&&p.x>9.5);assert.equal(p.y,0);
 const q=characterState(0,0,0);for(let i=0;i<60;i++)stepCharacter(q,{...walk(0),right:1},floor);assert.ok(Math.hypot(q.vx,q.vz)<=6.801);
 stepCharacter(q,{...idleCharacterInput(),jump:true},floor);assert.ok(q.y>0);let high=q.y;for(let i=0;i<100;i++){stepCharacter(q,idleCharacterInput(),floor);high=Math.max(high,q.y);}assert.ok(high>.8);assert.equal(q.y,0);assert.equal(q.grounded,true);assert.throws(()=>stepCharacter(q,walk(),floor,.2));
});
test('authority only accepts bounded controls, enqueues transactionally, and acknowledges execution not arrival',()=>{
 const g=new ThegameAuthority(),p=g.join('p1');const before={...p.state};g.enqueue('p1',[{seq:1,input:walk()}]);assert.deepEqual(p.state,before);assert.equal(p.ack,0);g.step();assert.equal(p.ack,1);assert.ok(p.state.x>before.x);
 assert.throws(()=>readCharacterInput({...walk(),x:999}));assert.throws(()=>readCharacterInput({...walk(),forward:NaN}));assert.throws(()=>g.enqueue('p1',[{seq:2,input:walk()},{seq:4,input:walk()}]));assert.equal(p.inputs.length,0);assert.equal(p.received,1);
 g.enqueue('p1',[{seq:1,input:walk()},{seq:2,input:walk()}]);assert.equal(p.inputs.length,1);for(let i=0;i<200;i++)g.step();assert.ok(p.state.x-before.x<1);assert.equal(p.ack,2);g.leave('p1');assert.equal(g.peers.size,0);
});
test('bounded local replay exactly matches authority after delayed ACKs without accepting positions',()=>{
 const g=new ThegameAuthority(),peer=g.join('p1'),world=new OpenWorld(),r=new InputReplay(peer.state,p=>({...p}),(p,i)=>stepCharacter(p,i,world),120);let held=[];
 for(let n=1;n<=120;n++){const item=r.push({...walk(),jump:n===25});g.enqueue('p1',[item]);g.step();held.push({ack:peer.ack,state:{...peer.state}});if(n>9){const a=held.shift();assert.ok(r.correct(a.ack,a.state));}assert.deepEqual(r.state,peer.state);}
 assert.ok(!r.correct(999,peer.state));r.correct(peer.ack,peer.state);assert.equal(r.pending,0);assert.deepEqual(r.state,peer.state);
 for(let i=0;i<120;i++)assert.ok(r.push(walk()));assert.equal(r.push(walk()),undefined);assert.equal(r.pending,120);
});
test('shared projection tolerates snapshot loss/jitter and rejects old epochs; AOI and histories are bounded',()=>{
 const g=new ThegameAuthority({},3),a=g.join('p1'),b=g.join('p2'),replica=new Replica(peopleProjection,3,8,4096,.12);for(let tick=1;tick<=120;tick++){g.step();if(tick%3===0&&tick%9!==0)replica.receive(g.snapshot(a.id).frame,tick/60+.06);replica.present(tick/60+.09);}assert.ok(replica.inspect().frames<=8);assert.ok(replica.inspect().payloadBytes<=4096);assert.ok(replica.latest().rows.some(r=>r.id===b.id));assert.ok(!replica.receive({...g.snapshot(a.id).frame,epoch:2},3));b.state.x=10000;g.step();assert.ok(!g.snapshot(a.id).frame.rows.some(r=>r.id===b.id));
});
test('chunk admission is one credit, stale work is discarded, rebase keeps resident object identity',()=>{
 const released=[],window=new ChunkWindow((key,v)=>released.push([key,v]));window.want(0,0,2);const t=window.next();assert.equal(window.next(),undefined);const value={mesh:{}};window.prepared(t,value);assert.equal(window.next(),undefined);window.admit(()=>{});window.want(1,0,2);assert.equal(window.has(t.key),true);assert.equal(released.length,0);
 const stale=window.next();window.want(100,0,2);assert.equal(window.prepared(stale,{}),false);assert.ok(window.inspect().stale);for(let i=0;i<25;i++){const n=window.next();window.prepared(n,{});window.admit(()=>{});}assert.equal(window.inspect().resident,25);assert.equal(window.next(),undefined);window.dispose();assert.equal(window.inspect().resident,0);
});
test('thegame is a normal public project module; view-only changes keep shared identity',()=>{const p=project({id:'thegame',modules:{rules:thegame()},presets:{compact:{rules:{viewRadius:2}}}}),r=p.start('compact');assert.equal(r.values.rules.config.viewRadius,2);assert.equal(worldSignature(thegameConfig()),worldSignature(thegameConfig({viewRadius:1,exposure:2})));assert.notEqual(worldSignature(thegameConfig()),worldSignature(thegameConfig({seed:30})));r.dispose();assert.throws(()=>thegame({runSpeed:NaN}));});
test('network host is real peer authority, bounded latest-state backpressure and safe session resume',()=>{
 let now=0;const h=createThegameHost({}, {now:()=>now,epoch:7}),packets=[];let blocked=false;const socket={send:s=>{packets.push(JSON.parse(s));return blocked?-1:s.length;},close(){h.close(socket);}};
 h.open(socket);h.message(socket,JSON.stringify({type:'join',version:WORLD_REVISION,name:'Roman'}));const hello=packets[0];assert.ok(hello.token);h.advance(0);for(let i=1;i<120;i++){now=i*1000/60;h.advance(now);}assert.ok(packets.some(p=>p.type==='state'));
 blocked=true;now+=60;h.advance(now);const count=packets.length;for(let i=0;i<10;i++){now+=50;h.advance(now);}assert.equal(packets.length,count);assert.equal(h.inspect().transport.unsent,1);blocked=false;h.drain(socket);assert.equal(packets.length,count+1);assert.equal(h.inspect().transport.unsent,0);
 const id=hello.id;h.close(socket);assert.equal(h.game.peers.size,0);h.open(socket);h.message(socket,JSON.stringify({type:'join',version:WORLD_REVISION,name:'Again',resume:hello.token}));assert.equal(packets.at(-1).id,id);h.dispose();assert.equal(h.inspect().transport.sockets,0);
});
