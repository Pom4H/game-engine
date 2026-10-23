import test from 'node:test';
import assert from 'node:assert/strict';
import {ThegameAuthority} from '../game/session.ts';
import {OpenWorld} from '../game/world.ts';
import {TransitAuthority} from '../game/transit.ts';
import {TransitVehicleAuthority} from '../game/transit-vehicle.ts';
import {characterState,idleCharacterInput} from '../../../src/runtime/character-motor.ts';

test('the authority and canonical motor consume the injected building world',()=>{
 class BuildingFixture extends OpenWorld {
  floorQueries=0;
  floor(x,y,z,range){
   this.floorQueries++;
   if(y>=4&&y-range<=4)return {y:4,normal:[0,1,0]};
   return super.floor(x,y,z,range);
  }
 }
 const world=new BuildingFixture(29),game=new ThegameAuthority({},1,false,world);
 assert.equal(game.world,world);
 const peer=game.join('p1');Object.assign(peer.state,{y:4,vy:0,grounded:true});
 game.enqueue(peer.id,[{seq:1,input:idleCharacterInput()}]);game.step();
 assert.equal(peer.state.y,4);assert.ok(world.floorQueries>0);assert.equal(peer.ack,1);
 game.dispose();
 assert.throws(()=>new ThegameAuthority({},1,false,new OpenWorld(30)),/seed/);
});

test('physical transit preserves current Engine force and energy cause closure',()=>{
 const transit=new TransitAuthority({seedDemand:false}),vehicles=new TransitVehicleAuthority(transit);
 const service=transit.services(20).find(value=>value.id==='B01:0');assert.ok(service);
 const trace=vehicles.physics.traceCauses({runId:'thegame-transit-adapter',maxRecords:100_000});
 const observer={state:characterState(...service.position,service.yaw)};
 for(let i=0;i<12;i++)vehicles.step(20+i/60,[observer]);
 const records=trace.snapshot();
 assert.ok(records.some(record=>record.type==='physics.energy-closure'));
 assert.ok(records.some(record=>JSON.stringify(record).includes('timetable-path.v1')));
 assert.ok(records.filter(record=>record.type==='physics.wrench').every(record=>record.residual.force_N<=1e-9&&record.residual.torque_Nm<=1e-9));
 vehicles.dispose();
});
