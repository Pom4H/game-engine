import test from 'node:test';
import assert from 'node:assert/strict';
import {characterState} from '../dist/runtime/character-motor.js';
import {TransitAuthority} from '../dist/games/thegame/transit.js';
import {TransitVehicleAuthority,transitVehicleProjection} from '../dist/games/thegame/transit-vehicle.js';
import {ThegameAuthority} from '../dist/games/thegame/session.js';
import {WORLD_REVISION} from '../dist/games/thegame/world.js';
import {createThegameHost} from '../tools/thegame/host.mjs';

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

test('new player can enter the world already riding a living bus resident',()=>{
 const game=new ThegameAuthority({},51);
 const peer=game.join('p1','Passenger');
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
 const game=new ThegameAuthority({},52),peer=game.join('p1','Passenger');
 assert.ok(peer.seat);
 const start={x:peer.state.x,z:peer.state.z};
 game.enqueue(peer.id,[{seq:1,input:{forward:1,right:1,yaw:0,sprint:true,jump:true}}]);
 for(let i=0;i<120;i++)game.step();
 assert.equal(peer.ack,1);
 assert.ok(peer.seat);
 const service=game.transit.serviceForPassenger(peer.residentId,game.tick/60);assert.ok(service);
 const pose=game.transitVehicles.seatPose(service.id,game.tick/60);assert.ok(pose);
 assert.ok(Math.hypot(peer.state.x-pose.position[0],peer.state.z-pose.position[2])<.001);
 assert.ok(Math.hypot(peer.state.x-start.x,peer.state.z-start.z)>.05);
 game.dispose();
});

test('reconnect reclaims the same riding resident and the same service seat',()=>{
 let now=0;const host=createThegameHost({}, {now:()=>now,epoch:53}),packets=[];
 const socket={send:text=>{packets.push(JSON.parse(text));return text.length;},close(){host.close(socket);}};
 host.open(socket);host.message(socket,JSON.stringify({type:'join',version:WORLD_REVISION,name:'Passenger'}));
 const welcome=packets.at(-1);assert.equal(welcome.type,'welcome');assert.equal(welcome.self.seat?.mode,'bus');
 const resident=welcome.resident.id,serviceId=welcome.self.seat.serviceId,token=welcome.token;
 host.close(socket);now=1000;host.advance(now);
 const socket2={send:text=>{packets.push(JSON.parse(text));return text.length;},close(){host.close(socket2);}};
 host.open(socket2);host.message(socket2,JSON.stringify({type:'join',version:WORLD_REVISION,name:'Passenger',resume:token}));
 const resumed=packets.at(-1);assert.equal(resumed.type,'welcome');
 assert.equal(resumed.resident.id,resident);assert.equal(resumed.self.seat?.serviceId,serviceId);
 host.dispose();
});
