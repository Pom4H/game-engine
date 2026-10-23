import test from 'node:test';
import assert from 'node:assert/strict';
import {TransitAuthority} from '../game/transit.ts';
import {ThegameAuthority} from '../game/session.ts';

test('waiting transit residents have stable world poses at stops',()=>{
 const transit=new TransitAuthority(),waiting=transit.passengersState().filter(p=>p.state==='waiting');
 assert.ok(waiting.length>0);
 const sample=waiting[0],a=transit.passengerPose(sample.residentId,0),b=transit.passengerPose(sample.residentId,0);
 assert.ok(a);assert.deepEqual(a,b);assert.equal(a.state,'waiting');assert.equal(a.speed,0);
 assert.ok(a.position.every(Number.isFinite));assert.ok(Number.isFinite(a.yaw));
});

test('riding resident pose follows the promoted service transform without changing identity',()=>{
 const transit=new TransitAuthority();transit.step(0);transit.step(1.2);
 const rider=transit.ridingCandidate();assert.ok(rider?.serviceId);
 const service=transit.serviceForPassenger(rider.residentId,0);assert.ok(service);
 const coarse=transit.passengerPose(rider.residentId,0);assert.ok(coarse);
 const promoted={position:[service.position[0]+7,service.position[1]+1,service.position[2]-3],yaw:service.yaw+.2,speed:4};
 const physical=transit.passengerPose(rider.residentId,0,promoted);assert.ok(physical);
 assert.equal(physical.residentId,rider.residentId);assert.equal(physical.serviceId,rider.serviceId);
 assert.ok(Math.hypot(physical.position[0]-coarse.position[0],physical.position[2]-coarse.position[2])>5);
 assert.equal(physical.speed,4);
});

test('TheGame shared people projection includes transit-owned residents without duplicating players',()=>{
 const game=new ThegameAuthority({},61),peer=game.join('p1','Walker');
 for(let i=0;i<3;i++)game.step();
 const snapshot=game.snapshot(peer.id),transitIds=game.transit.ownedResidentIds();
 const rows=snapshot.frame.rows.filter(row=>transitIds.has(row.id));
 assert.ok(rows.length>0);
 assert.ok(rows.every(row=>row.id!==peer.residentId));
 assert.equal(new Set(snapshot.frame.rows.map(row=>row.id)).size,snapshot.frame.rows.length);
 game.dispose();
});

test('service dwell exposes open doors while run state exposes closed doors',()=>{
 const transit=new TransitAuthority({seedDemand:false});
 const dwell=transit.services(0).find(v=>v.id==='B01:0');assert.ok(dwell);
 assert.equal(dwell.phase,'dwell');assert.equal(dwell.doors,1);
 let run;
 for(let t=1;t<100;t++){const value=transit.services(t).find(v=>v.id==='B01:0');if(value?.phase==='run'){run=value;break;}}
 assert.ok(run);assert.equal(run.doors,0);
});
