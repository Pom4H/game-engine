import {test} from 'node:test';
import assert from 'node:assert/strict';
import {SnowMatter} from '../dist/environment/snow-matter.js';
const mass=m=>[...m.cells.values()].reduce((n,c)=>n+c.massKg,0);
const deposit=()=>{const m=new SnowMatter({cellM:1,depthM:0,temperatureC:0});m.deposit([.5,0,.5],{massKg:320,volumeM3:2,enthalpyJ:0,bond:.04});return m;};
test('surface energy melts finite snow and carries latent heat with the drained mass',()=>{
 const m=deposit(),before=mass(m),energy=m.heatAddedJ,result=m.exchangeHeat(3600,{temperatureC:20,windMps:2,sunlightWm2:800});
 assert.ok(result.drainedKg>0);assert.ok(m.sample(.5,.5).height<2);assert.ok(Math.abs(mass(m)+result.drainedKg-before)<1e-9);
 assert.ok(Math.abs((m.heatAddedJ-energy)-result.drainedKg*334000)<1e-6);
 const frozen=deposit();frozen.exchangeHeat(3600,{temperatureC:0,windMps:0,sunlightWm2:0});assert.equal(mass(frozen),before);
});
test('wind and sunlight accelerate heat exchange, empty piles never regenerate, cold snow warms first',()=>{
 const calm=deposit(),windy=deposit();calm.exchangeHeat(3600,{temperatureC:20,windMps:0,sunlightWm2:0});windy.exchangeHeat(3600,{temperatureC:20,windMps:10,sunlightWm2:800});assert.ok(mass(windy)<mass(calm));
 const cold=deposit();cold.apply([['0,0,0',160,1,-160*2100*5,.04],['0,1,0',160,1,-160*2100*5,.04]]);assert.equal(cold.exchangeHeat(1,{temperatureC:20,windMps:0,sunlightWm2:0}).drainedKg,0);
 for(let i=0;i<100;i++)windy.exchangeHeat(3600,{temperatureC:30,windMps:20,sunlightWm2:1000});assert.equal(mass(windy),0);assert.equal(windy.sample(.5,.5).height,0);assert.equal(windy.exchangeHeat(1,{temperatureC:20,windMps:1,sunlightWm2:1}).drainedKg,0);
 assert.throws(()=>windy.exchangeHeat(NaN,{temperatureC:20,windMps:0,sunlightWm2:0}),RangeError);
});
