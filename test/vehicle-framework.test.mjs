import test from 'node:test';
import assert from 'node:assert/strict';
import {compileVehicle,M3_VEHICLE_DEFINITION,PICKUP_CANOPY_VEHICLE_DEFINITION} from '../dist/index.js';

const bounds=(mesh)=>{
 const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
 for(let i=0;i<mesh.positions.length;i+=3)for(let a=0;a<3;a++){min[a]=Math.min(min[a],mesh.positions[i+a]);max[a]=Math.max(max[a],mesh.positions[i+a]);}
 return{min,max,size:max.map((v,i)=>v-min[i])};
};

test('one compileVehicle API builds unrelated three-box and pickup families',()=>{
 const m3=compileVehicle(M3_VEHICLE_DEFINITION),pickup=compileVehicle(PICKUP_CANOPY_VEHICLE_DEFINITION);
 assert.equal(m3.definition.family,'three-box');
 assert.equal(pickup.definition.family,'double-cab-pickup');
 assert.ok(m3.bodyTriangles>1000,m3.bodyTriangles);
 assert.ok(pickup.bodyTriangles>=50,pickup.bodyTriangles);
 for(const vehicle of [m3,pickup]){
  assert.ok(vehicle.parts.some(p=>p.role==='paint'));
  assert.ok(vehicle.parts.some(p=>p.role==='glass'));
  assert.equal(vehicle.parts.filter(p=>p.role==='tire').length,4);
  assert.equal(vehicle.parts.filter(p=>p.role==='rim').length,4);
  assert.ok(vehicle.generatedTriangles>vehicle.bodyTriangles);
 }
});

test('pickup definition preserves published external hardpoints instead of sedan assumptions',()=>{
 const d=PICKUP_CANOPY_VEHICLE_DEFINITION;
 assert.equal(d.dimensions.wheelbase,3.22);
 assert.equal(d.dimensions.track,1.60);
 assert.equal(d.hardpoints.hoodHingeX,.94);
 assert.equal(d.hardpoints.tailgateHingeX,-2.60);
 assert.equal(d.hardpoints.frontDoorHingeX,.89);
 assert.equal(d.hardpoints.rearDoorHingeX,.12);
 assert.ok(d.body.canopy);
 const compiled=compileVehicle(d),b=bounds(compiled.body);
 assert.ok(b.size[0]>5.1&&b.size[0]<5.6,b);
 assert.ok(b.size[2]>1.9&&b.size[2]<2.1,b);
 assert.ok(b.max[1]>1.70&&b.max[1]<1.82,b);
});

test('vehicle definitions stay compact causes rather than embedded reference geometry',()=>{
 const m3Bytes=Buffer.byteLength(JSON.stringify(M3_VEHICLE_DEFINITION)),pickupBytes=Buffer.byteLength(JSON.stringify(PICKUP_CANOPY_VEHICLE_DEFINITION));
 assert.ok(m3Bytes<3000,m3Bytes);
 assert.ok(pickupBytes<1500,pickupBytes);
 assert.match(PICKUP_CANOPY_VEHICLE_DEFINITION.reference.url,/model\.glb$/);
});
