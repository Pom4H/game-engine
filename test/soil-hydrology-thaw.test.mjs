import test from 'node:test';
import assert from 'node:assert/strict';
import {SoilHydrologyGrid} from '../dist/environment/soil-hydrology.js';
import {SoilHydrologyGrid as BeforeGrid} from './fixtures/soil-hydrology-before-equilibrium.mjs';

const sealed={depthM:0,porosity:0,fieldCapacity:0,conductivityMps:0,fineFraction:0,rootCover:0};
const loam={depthM:.12,porosity:.45,fieldCapacity:.25,conductivityMps:3e-6,fineFraction:.8,rootCover:.5};
const make=(profile=sealed,Grid=SoilHydrologyGrid)=>new Grid(Array(16).fill(profile),new Float64Array(16),4,1);
const melt={rainMps:0,snowMps:0,temperatureC:40,humidity:1,sunlightWm2:850,windMps:0};
const reservoirs=['soil','ground','ice','snow','water'];
function savedPhase(grid,pairs){
 const saved=grid.snapshot();
 pairs.forEach(([snow,ice],i)=>{saved.snow[i]=snow;saved.ice[i]=ice;saved.inputM3+=snow+ice;});
 return saved;
}
function assertPhysical(grid){
 const saved=grid.snapshot();
 for(const name of reservoirs)assert.ok(saved[name].every(v=>Number.isFinite(v)&&v>=0),name+' remains finite and nonnegative');
 for(const name of ['flowX','flowZ'])assert.ok(saved[name].every(Number.isFinite),name+' remains finite');
 assert.ok(Math.abs(grid.volumeM3()+grid.evaporatedM3-grid.inputM3-grid.boundaryNetM3)<1e-15,'one conserved budget');
 return saved;
}

test('a valid mixed snow/ice state survives full thaw, JSON restore and continued weather/flow',()=>{
 const actual=make();actual.restore(savedPhase(actual,[[.0001,.0002]]));
 actual.stepWeather(300,melt);
 const saved=assertPhysical(actual);assert.equal(saved.snow[0],0);assert.equal(saved.ice[0],0);
 const json=JSON.parse(JSON.stringify(saved)),restored=make();restored.restore(json);
 assert.deepEqual(restored.snapshot(),saved);
 const weather=[melt,{...melt,temperatureC:-5,sunlightWm2:0,snowMps:1e-8},{...melt,temperatureC:15,rainMps:2e-8}];
 for(let i=0;i<9;i++){
  for(const grid of [actual,restored]){grid.stepWeather(2.5,weather[i%weather.length]);grid.stepFlow(2.5);assertPhysical(grid);}
  assert.deepEqual(restored.snapshot(),actual.snapshot(),'restoring cannot alter the continued authoritative reservoirs/faces');
  assert.equal(restored.water.timeS,actual.water.timeS);
 }
});

test('bounded phase transfers preserve tiny and subnormal donors through persistence',()=>{
 const pairs=[[.0001,.0002],[5.293955920339377e-23,7.945780641910744e-23],[5.2660062629230346e-24,5.515614475109446e-24],[Number.MIN_VALUE,Number.MIN_VALUE],[Number.MIN_VALUE,2*Number.MIN_VALUE],[2*Number.MIN_VALUE,Number.MIN_VALUE]];
 const grid=make();grid.restore(savedPhase(grid,pairs));grid.stepWeather(300,melt);
 const saved=assertPhysical(grid),restored=make();restored.restore(JSON.parse(JSON.stringify(saved)));assert.deepEqual(restored.snapshot(),saved);
 for(let i=0;i<pairs.length;i++){assert.equal(saved.snow[i],0);assert.equal(saved.ice[i],0);}
});

test('ordinary partial thaw and other weather retain the frozen numerical oracle',()=>{
 const actual=make(loam),before=make(loam,BeforeGrid),saved=actual.snapshot();
 for(let i=0;i<16;i++){saved.soil[i]=.01;saved.ground[i]=.002;saved.snow[i]=.001;saved.ice[i]=.002;saved.water[i]=.0003;saved.inputM3+=.01+.002+.001+.002+.0003;}
 actual.restore(saved);before.restore(structuredClone(saved));
 const forcings=[{...melt,temperatureC:2,sunlightWm2:10},{...melt,temperatureC:-2,sunlightWm2:0,snowMps:1e-8},{...melt,temperatureC:3,sunlightWm2:20,rainMps:2e-8}];
 for(let i=0;i<18;i++){
  for(const grid of [actual,before]){grid.stepWeather(.125,forcings[i%forcings.length]);grid.stepFlow(.125);}
  assert.deepEqual(actual.snapshot(),before.snapshot(),'no reordering of ordinary weather/flow arithmetic');
 }
});

test('ordinary signed-zero phase donors retain the frozen arithmetic',()=>{
 for(const ice of [-0,0])for(const snow of [-0,0]){
  const actual=make(),before=make(sealed,BeforeGrid),saved=actual.snapshot();saved.ice[0]=ice;saved.snow[0]=snow;
  actual.restore(saved);before.restore(structuredClone(saved));
  for(const grid of [actual,before])grid.stepWeather(1,melt);
  assert.deepEqual(actual.snapshot(),before.snapshot());assert.ok(Object.is(actual.ice[0],before.ice[0]));
 }
});

test('saved paired and unpaired negative phase residues remain rejected atomically',()=>{
 const grid=make(),before=grid.snapshot();
 for(const magnitude of [5.293955920339377e-23,5.2660062629230346e-24,7.945780641910744e-23,5.515614475109446e-24,.1])for(const paired of [false,true]){
  const invalid=structuredClone(before);invalid.ice[0]=-magnitude;invalid.snow[0]=paired?magnitude:0;
  assert.throws(()=>grid.restore(invalid),/Invalid saved hydrology/);assert.deepEqual(grid.snapshot(),before);
 }
 for(const name of reservoirs){const invalid=structuredClone(before);invalid[name][3]=-Number.MIN_VALUE;assert.throws(()=>grid.restore(invalid),/Invalid saved hydrology/);assert.deepEqual(grid.snapshot(),before);}
});
