import test from 'node:test';
import assert from 'node:assert/strict';
import {ShallowWaterBasin} from '../dist/physics/shallow-water-basin.js';
test('dry fronts flow downhill into depressions while retaining source volume and nonnegative depths',()=>{
 const bed=new Float64Array(144);for(let z=0;z<12;z++)for(let x=0;x<12;x++)bed[z*12+x]=x<6?.2:0;
 const water=new ShallowWaterBasin({columns:12,rows:12,widthM:12,lengthM:12,depthM:0,bed,dampingPerSecond:2});
 assert.equal(water.addVolume(-1.5,0,1),true);assert.equal(water.addVolume(20,0,1),false);
 for(let i=0;i<2400;i++){water.step(1/120,0);assert.ok(Math.abs(water.volumeM3()-1)<1e-10);assert.ok(water.depth.every(h=>h>=0));}
 let lower=0;for(let z=0;z<12;z++)for(let x=6;x<12;x++)lower+=water.depth[z*12+x];assert.ok(lower>.5);assert.ok([...water.depth].filter(h=>h>.0001).length>1);
});
test('water head rather than bed slope drives a settled puddle; obstacle cells remain dry',()=>{
 const bed=Float64Array.from({length:64},(_,i)=>(i%8)*.001),solid=new Uint8Array(64);solid[0]=1;
 const water=new ShallowWaterBasin({columns:8,rows:8,widthM:8,lengthM:8,depthM:0,bed,solid});
 for(let i=1;i<64;i++)water.depth[i]=.02-bed[i];const initial=[...water.depth];for(let i=0;i<100;i++)water.step(.01,0);
 assert.equal(water.addVolume(-3.5,-3.5,1),false);assert.deepEqual([...water.depth],initial);
});
test('open streaming boundaries export runoff without invisible basin walls or losing the water ledger',()=>{
 const water=new ShallowWaterBasin({columns:8,rows:8,widthM:8,lengthM:8,depthM:0,openBoundary:true});water.addVolume(3.5,0,1);
 for(let i=0;i<400;i++)water.step(.01,0);assert.ok(water.escapedVolumeM3>0);assert.ok(Math.abs(water.volumeM3()+water.escapedVolumeM3-1)<1e-10);
});
