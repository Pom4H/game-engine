import test from 'node:test';
import assert from 'node:assert/strict';
import {THEGAME_TRANSIT_ROUTES,TransitAuthority,transitServiceTime} from '../dist/games/thegame/transit.js';

test('old public transport modes and capacities survive the unified migration',()=>{
 assert.deepEqual(THEGAME_TRANSIT_ROUTES.map(r=>r.id),['B01','B02','T01','M01']);
 assert.deepEqual(THEGAME_TRANSIT_ROUTES.map(r=>r.mode),['bus','bus','tram','metro']);
 assert.deepEqual(THEGAME_TRANSIT_ROUTES.map(r=>r.capacity),[68,68,84,180]);
 assert.ok(THEGAME_TRANSIT_ROUTES.every(r=>r.stops.length>=4&&r.cycleSeconds>r.dwellSeconds*r.stops.length));
 assert.equal(transitServiceTime(0),'08:00:00');
});

test('every route has two stable scheduled services and correct headway',()=>{
 const transit=new TransitAuthority({seedDemand:false}),fleet=transit.services(0);
 assert.equal(fleet.length,8);
 assert.equal(new Set(fleet.map(v=>v.id)).size,8);
 for(const route of THEGAME_TRANSIT_ROUTES){
  const services=fleet.filter(v=>v.routeId===route.id);
  assert.equal(services.length,2);
  assert.equal(route.headwaySeconds,route.cycleSeconds/2);
  assert.ok(services.every(v=>v.capacity===route.capacity));
 }
});

test('dwell opens doors and run closes them without teleporting service identity',()=>{
 const transit=new TransitAuthority({seedDemand:false}),atZero=transit.services(0).find(v=>v.id==='B01:0');
 assert.ok(atZero);assert.equal(atZero.phase,'dwell');assert.equal(atZero.doors,1);
 let running;
 for(let t=1;t<300;t++){const state=transit.services(t).find(v=>v.id==='B01:0');if(state?.phase==='run'){running=state;break;}}
 assert.ok(running);assert.equal(running.id,'B01:0');assert.equal(running.doors,0);
 assert.ok(running.position.every(Number.isFinite));assert.ok(Number.isFinite(running.yaw));
});

test('real resident identity waits, boards, rides and alights on schedule',()=>{
 const transit=new TransitAuthority({seedDemand:false}),route=THEGAME_TRANSIT_ROUTES[0],origin=route.stops[0],destination=route.stops[1],resident='crowd:-3:-1:2';
 const trip=transit.plan(resident,[origin.position[0],origin.position[2]],[destination.position[0],destination.position[2]]);
 assert.ok(trip);assert.equal(trip.residentId,resident);assert.equal(trip.state,'waiting');
 // B01:0 starts at stop 0 in dwell.
 transit.step(0);
 assert.equal(transit.passenger(resident)?.state,'riding');
 assert.equal(transit.passenger(resident)?.serviceId,'B01:0');
 let arrival=-1;
 for(let t=1;t<route.cycleSeconds;t++){
  const state=transit.services(t).find(v=>v.id==='B01:0');
  if(state?.phase==='dwell'&&state.currentStop===1){arrival=t;break;}
 }
 assert.ok(arrival>0);
 transit.step(arrival);
 assert.equal(transit.passenger(resident),undefined);
 const snapshot=transit.snapshot(arrival);
 assert.equal(snapshot.boarded,1);assert.equal(snapshot.alighted,1);assert.equal(snapshot.riding,0);
});

test('capacity is authoritative and excess residents remain physically waiting',()=>{
 const transit=new TransitAuthority({seedDemand:false}),route=THEGAME_TRANSIT_ROUTES[0],origin=route.stops[0],destination=route.stops[1];
 for(let i=0;i<route.capacity+7;i++){
  const id=`crowd:-3:-1:${i}`;
  const trip=transit.plan(id,[origin.position[0],origin.position[2]],[destination.position[0],destination.position[2]]);
  assert.ok(trip);
 }
 transit.step(0);
 const snapshot=transit.snapshot(0);
 assert.equal(snapshot.fleet.find(v=>v.id==='B01:0').passengers,route.capacity);
 assert.equal(snapshot.waiting,7);
 assert.equal(snapshot.riding,route.capacity);
});

test('default world starts with deterministic real resident demand owned by transit',()=>{
 const transit=new TransitAuthority();
 const first=transit.snapshot(0);
 assert.ok(first.waiting>0);
 const owned=[...transit.ownedResidentIds()];
 assert.ok(owned.length>0);
 assert.ok(owned.every(id=>id.startsWith('crowd:')));
 transit.step(0);
 const after=transit.snapshot(0);
 assert.ok(after.riding>0);
 assert.ok(after.boarded>0);
});

test('service identity deterministically maps to future physical vehicle identity seed',()=>{
 const a=new TransitAuthority({seedDemand:false}),b=new TransitAuthority({seedDemand:false});
 for(const id of ['B01:0','B01:1','T01:0','M01:1'])assert.equal(a.vehicleSeed(id),b.vehicleSeed(id));
 assert.notEqual(a.vehicleSeed('B01:0'),a.vehicleSeed('B01:1'));
});
