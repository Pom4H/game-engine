import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import city,{CITY_TRAFFIC,cityMetadata} from '../tools/city-benchmark/scene.mjs';
import {CITY_ROUTE_TICKS,cityCameraAtTick,cityRoute} from '../tools/city-benchmark/route.mjs';
import {validateScene} from '../dist/scene/validate.js';

test('City benchmark is an actual authored Scene with 48 dynamic vehicles',()=>{
 assert.equal(city.version,1);
 const ids=new Set(city.entities.map(entity=>entity.id));
 assert.equal(ids.size,city.entities.length,'duplicate entities');
 assert.ok(city.entities.length>=1500,'missing original procedural city');
 assert.equal(cityMetadata.districtBlocks,18);
 const moving=city.entities.filter(e=>e.id.startsWith('bench-car-'));
 assert.equal(moving.length,CITY_TRAFFIC);
 assert.ok(moving.every(e=>e.body?.mass===1250&&!e.renderOnly));
 assert.ok(city.entities.some(e=>e.environmental?.surfaceUse==='road'),'missing physical asphalt');
 assert.ok(city.entities.some(e=>e.light?.kind==='point'),'missing scene lights');
 assert.ok(city.entities.some(e=>e.id==='city-east-road'));
 assert.equal(validateScene(city).entities.length,city.entities.length);
});
test('Seeded procedural city rebuilds exact same source for either backend',async()=>{
 const fresh=await import('../tools/city-benchmark/scene.mjs?deterministic-check');
 assert.deepEqual(fresh.default,city);
 const hash=scene=>createHash('sha256').update(JSON.stringify(scene)).digest('hex');
 assert.equal(hash(fresh.default),hash(city));
});
test('Fixed camera route is continuous through all three phases',()=>{
 assert.equal(CITY_ROUTE_TICKS,180);
 assert.deepEqual(cityRoute.map(x=>x.id),['sidewalk','traffic','overlook']);
 const points=Array.from({length:CITY_ROUTE_TICKS},(_,i)=>cityCameraAtTick(i));
 assert.ok(points.every(c=>c.position.every(Number.isFinite)&&c.target.every(Number.isFinite)));
 for(let i=1;i<points.length;i++){
  const a=points[i-1].position,b=points[i].position;
  assert.ok(Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2])<3,'camera jump at '+i);
 }
 assert.throws(()=>cityCameraAtTick(-1),RangeError);
 assert.throws(()=>cityCameraAtTick(180),RangeError);
});
