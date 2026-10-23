import test from 'node:test';
import assert from 'node:assert/strict';
import {OpenWorld,climateAt,cityLamps,WORLD_REVISION} from '../game/world.ts';
import {ThegameAuthority,readCharacterInput,thegameConfig,worldSignature,peopleProjection} from '../game/session.ts';
import {characterState,stepCharacter,idleCharacterInput} from '../../../src/runtime/character-motor.ts';
import {InputReplay} from '../../../src/network/input-replay.ts';
import {Replica} from '../../../src/network/playback.ts';
const walk=(yaw=Math.PI/2)=>({...idleCharacterInput(yaw),forward:1,sprint:true});
test('thegame world is deterministic and has exact continuous triangle seams, props and bounded residency',()=>{
 const a=new OpenWorld(29,8),b=new OpenWorld(29,8);for(const [cx,cz] of [[-1,-1],[-8,2],[6,-8],[10,10]]){
  const c=a.chunk(cx,cz),r=a.chunk(cx+1,cz);for(let z=0;z<=16;z++)assert.equal(c.heights[z*17+16],r.heights[z*17]);
  for(const p of c.props)assert.ok(Math.abs(p.y-a.ground(p.x,p.z).y)<1e-9);assert.deepEqual(c,b.chunk(cx,cz));
 }
 const kinds=new Set();for(let z=-3000;z<=3000;z+=300)for(let x=-3000;x<=3000;x+=300)kinds.add(climateAt(29,x,z).biome);assert.ok(kinds.size>=7);
 const lamps=cityLamps(-1,-1);assert.equal(lamps.length,8);assert.equal(new Set(lamps.map(l=>l.id)).size,8);assert.equal(cityLamps(4,0).length,0);
 for(let i=-100;i<100;i++)a.ground(i*128+7,i*37);assert.equal(a.inspect().chunks,8);assert.ok(a.stats.evicted>100);assert.throws(()=>a.chunk(Infinity,0));
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
 const g=new ThegameAuthority({},3),a=g.join('p1'),b=g.join('p2'),replica=new Replica(peopleProjection,3,8,4096,.12);for(let tick=1;tick<=120;tick++){g.step();if(tick%3===0&&tick%9!==0)replica.receive(g.snapshot(a.id).frame,tick/60+.06);replica.present(tick/60+.09);}assert.ok(replica.inspect().frames<=8);assert.ok(replica.inspect().payloadBytes<=4096);assert.ok(replica.latest().rows.some(r=>r.id===b.residentId));assert.ok(!replica.receive({...g.snapshot(a.id).frame,epoch:2},3));b.state.x=10000;g.step();assert.ok(!g.snapshot(a.id).frame.rows.some(r=>r.id===b.id));
});
