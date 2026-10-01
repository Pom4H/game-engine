import test from 'node:test';
import assert from 'node:assert/strict';
import {characterState} from '../dist/runtime/character-motor.js';
import {TransitAuthority} from '../dist/games/thegame/transit.js';
import {TransitVehicleAuthority,transitVehicleProjection} from '../dist/games/thegame/transit-vehicle.js';
import {ThegameAuthority} from '../dist/games/thegame/session.js';
function joinKnownRider(game,id='p1'){
 const rider=game.transit.ridingCandidate();assert.ok(rider);
 const service=game.transit.serviceForPassenger(rider.residentId,game.tick/60);assert.ok(service);
 const state=characterState(service.position[0],service.position[1],service.position[2],service.yaw);
 return game.join(id,'Passenger',{state,discovered:0,residentId:rider.residentId});
}

test('nearby bus service promotes into the existing Vehicle/PhysicsWorld and demotes outside interest',()=>{
 const transit=new TransitAuthority({seedDemand:false}),vehicles=new TransitVehicleAuthority(transit);
 const start=20,service=transit.services(start).find(v=>v.id==='B01:0');
 assert.ok(service);assert.equal(service.mode,'bus');assert.equal(service.phase,'run');
 const observer={state:characterState(service.position[0],service.position[1],service.position[2],service.yaw)};
 vehicles.step(start,[observer]);
 assert.equal(vehicles.hasPhysical(service.id),true);
 const before=vehicles.seatPose(service.id,start);assert.ok(before?.physical);
 for(let i=1;i<=90;i++)vehicles.step(start+i/60,[observer]);
 const after=vehicles.seatPose(service.id,start+1.5);assert.ok(after?.physical);
 assert.ok(Math.hypot(after.position[0]-before.position[0],after.position[2]-before.position[2])>.05);
 const coarse=transit.services(start+1.5).find(v=>v.id===service.id);
 assert.ok(coarse);assert.ok(Math.hypot(after.position[0]-coarse.position[0],after.position[2]-coarse.position[2])<30);
 for(let i=0;i<40;i++)vehicles.step(start+2+i/60,[]);
 assert.equal(vehicles.hasPhysical(service.id),false);
 assert.equal(vehicles.inspect().bodies,0);
 vehicles.dispose();
});

test('rail services stay route-authoritative instead of pretending to use road tyres',()=>{
 const transit=new TransitAuthority({seedDemand:false}),vehicles=new TransitVehicleAuthority(transit);
 const metro=transit.services(0).find(v=>v.id==='M01:0');assert.ok(metro);
 const observer={state:characterState(metro.position[0],metro.position[1],metro.position[2])};
 vehicles.step(0,[observer]);
 assert.equal(vehicles.hasPhysical(metro.id),false);
 const frame=vehicles.frame({epoch:1,sequence:1,tick:0,time:0,paused:false},observer.state,0);
 const row=frame.rows.find(r=>r.id===metro.id);assert.ok(row);
 assert.equal(row.values[6],2); // metro mode
 assert.equal(row.values[8],0); // not physical until rail contact exists
 vehicles.dispose();
});

test('known resident enters the world already riding the same living bus service',()=>{
 const game=new ThegameAuthority({},51);
 const peer=joinKnownRider(game);
 assert.ok(peer.seat);assert.equal(peer.seat.mode,'bus');
 const passenger=game.transit.passenger(peer.residentId);
 assert.equal(passenger?.state,'riding');assert.equal(passenger?.serviceId,peer.seat.serviceId);
 for(let i=0;i<3;i++)game.step();
 assert.equal(game.transitVehicles.hasPhysical(peer.seat.serviceId),true);
 const snapshot=game.snapshot(peer.id);
 assert.equal(snapshot.self.seat?.serviceId,peer.seat.serviceId);
 const row=snapshot.transitFrame.rows.find(r=>r.id===peer.seat.serviceId);assert.ok(row);
 assert.equal(row.values[8],1);
 assert.equal(transitVehicleProjection.read(snapshot.transitFrame).schema,transitVehicleProjection.signature);
 game.dispose();
});

test('seated player follows service authority instead of walking through the vehicle',()=>{
 const game=new ThegameAuthority({},52),peer=joinKnownRider(game);
 assert.ok(peer.seat);
 game.enqueue(peer.id,[{seq:1,input:{forward:1,right:1,yaw:0,sprint:true,jump:true}}]);
 for(let i=0;i<120;i++)game.step();
 assert.equal(peer.ack,1);
 assert.ok(peer.seat);
 const service=game.transit.serviceForPassenger(peer.residentId,game.tick/60);assert.ok(service);
 const pose=game.transitVehicles.seatPose(service.id,game.tick/60);assert.ok(pose);
 assert.ok(Math.hypot(peer.state.x-pose.position[0],peer.state.z-pose.position[2])<.001);
 game.dispose();
});

test('resident reconnect reclaims the same riding identity and service seat',()=>{
 const game=new ThegameAuthority({},53),first=joinKnownRider(game),residentId=first.residentId,serviceId=first.seat.serviceId;
 const saved={state:{...first.state},discovered:first.discovered,residentId};
 game.leave(first.id);
 for(let i=0;i<60;i++)game.step();
 const second=game.join('p1','Passenger',saved);
 assert.equal(second.residentId,residentId);assert.equal(second.seat?.serviceId,serviceId);
 assert.equal(game.transit.passenger(residentId)?.state,'riding');
 game.dispose();
});
