import test from 'node:test';
import assert from 'node:assert/strict';
import {ShallowWaterBasin} from '../dist/physics/shallow-water-basin.js';
import {SoilHydrologyGrid,exchangeHydrologyEdges} from '../dist/environment/soil-hydrology.js';
import {ShallowWaterBasin as BeforeBasin} from './fixtures/shallow-water-before-equilibrium.mjs';
import {SoilHydrologyGrid as BeforeGrid,exchangeHydrologyEdges as beforeEdges} from './fixtures/soil-hydrology-before-equilibrium.mjs';

// These fixtures are the unchanged compiled solvers before the optimization.
// Compare every authoritative reservoir/face/clock, including signed zero;
// matching aggregate volume alone would hide a changed flow or support field.
function sameBasin(actual,before){
 for(const key of ['depth','faceX','faceZ','transportX','transportZ'])assert.deepEqual(actual[key],before[key],key);
 for(const key of ['timeS','tiltRad','escapedVolumeM3','initialVolumeM3'])assert.ok(Object.is(actual[key],before[key]),key);
 for(const [x,z]of [[0,0],[-1.5,2],[1,-2]])assert.deepEqual(actual.sample(x,z),before.sample(x,z));
}
function sameGrid(actual,before){assert.deepEqual(actual.snapshot(),before.snapshot());assert.equal(actual.revision,before.revision);assert.ok(Object.is(actual.volumeM3(),before.volumeM3()));sameBasin(actual.water,before.water);}
const profile={depthM:.12,porosity:.45,fieldCapacity:.25,conductivityMps:3e-6,fineFraction:.8,rootCover:.5},sealed={depthM:0,porosity:0,fieldCapacity:0,conductivityMps:0,fineFraction:0,rootCover:0};
const bed=Float64Array.from({length:256},(_,i)=>Math.sin(i*.23)*.025+(i%16)*.002),solid=Uint8Array.from({length:256},(_,i)=>i%29===0?1:0);
const make=(Grid=SoilHydrologyGrid)=>new Grid(Array.from({length:256},(_,i)=>i%4===0?sealed:profile),bed,16,4,solid);

for(const openBoundary of [false,true])test('dry equilibrium exactly preserves signed fields, source boundaries and clock; open='+openBoundary,()=>{
 const spec={columns:16,rows:16,widthM:64,lengthM:64,depthM:0,bed,solid,openBoundary},actual=new ShallowWaterBasin(spec),before=new BeforeBasin(spec);
 for(const field of ['faceX','faceZ'])for(let i=0;i<actual[field].length;i++)actual[field][i]=before[field][i]=(i%13-6)*.031;
 actual.depth[0]=before.depth[0]=-0;actual.depth[1]=before.depth[1]=-0;actual.escapedVolumeM3=before.escapedVolumeM3=-0;
 for(const [dt,roll]of [[10,0],[10,.31],[.17,-.18],[1/60,0],[100,0]]){actual.step(dt,roll);before.step(dt,roll);sameBasin(actual,before);}
 // A formerly wet state may retain velocity and transport before drying.
 for(let step=0;step<6;step++){actual.depth[83]=before.depth[83]=.07;actual.step(.01,.03);before.step(.01,.03);sameBasin(actual,before);}
 actual.depth.fill(0);before.depth.fill(0);actual.step(10,-.1);before.step(10,-.1);sameBasin(actual,before);
 actual.addVolume(0,0,1.25);before.addVolume(0,0,1.25);for(let step=0;step<80;step++){actual.step(.05,Math.sin(step)*.04);before.step(.05,Math.sin(step)*.04);sameBasin(actual,before);}
});

test('reused flow scratch matches the frozen wet, dry, frozen and melting reservoirs after every phase',()=>{
 const actual=make(),before=make(BeforeGrid),forcings=[
  {rainMps:0,snowMps:0,temperatureC:15,humidity:.3,sunlightWm2:650,windMps:3},
  {rainMps:.03/3600,snowMps:0,temperatureC:4,humidity:.9,sunlightWm2:40,windMps:2},
  {rainMps:0,snowMps:.01/3600,temperatureC:-10,humidity:.7,sunlightWm2:0,windMps:4},
  {rainMps:0,snowMps:0,temperatureC:25,humidity:.2,sunlightWm2:850,windMps:2},
 ];
 for(let phase=0;phase<96;phase++){
  if(phase===12||phase===72){actual.addWater(15,.8);before.addWater(15,.8);}
  const weather=forcings[Math.floor(phase/24)],seconds=phase%3===0?60:phase%3===1?17.375:1/60;
  actual.stepWeather(seconds,weather);before.stepWeather(seconds,weather);sameGrid(actual,before);
  actual.stepFlow(seconds);before.stepFlow(seconds);sameGrid(actual,before);
  if(phase===33||phase===75){const saved=actual.snapshot();actual.restore(saved);before.restore(structuredClone(saved));sameGrid(actual,before);}
 }
 assert.ok(Math.abs(actual.volumeM3()+actual.evaporatedM3-actual.inputM3-actual.boundaryNetM3)<1e-9);
});

test('coupled corner and groundwater transfer remains identical and invalid restore stays atomic',()=>{
 const actual=Array.from({length:4},()=>make()),before=Array.from({length:4},()=>make(BeforeGrid));
 for(const fields of [actual,before]){fields[0].addWater(255,1);fields[0].ground[255]=.04;fields[0].inputM3+=.04*16;}
 const edges=fields=>[{a:fields[0],b:fields[1],axis:'x'},{a:fields[0],b:fields[2],axis:'z'},{a:fields[1],b:fields[3],axis:'z'},{a:fields[2],b:fields[3],axis:'x'}];
 for(let phase=0;phase<48;phase++){
  for(let i=0;i<4;i++){actual[i].stepFlow(3.5);before[i].stepFlow(3.5);}
  exchangeHydrologyEdges(edges(actual),60);beforeEdges(edges(before),60);for(let i=0;i<4;i++)sameGrid(actual[i],before[i]);
 }
 for(let i=0;i<4;i++)for(const patch of [{water:[-1]},{soil:Array(256).fill(NaN)},{boundaryNetM3:Infinity},{flowX:[]}]){
  const saved=actual[i].snapshot();assert.throws(()=>actual[i].restore({...saved,...patch}));assert.throws(()=>before[i].restore({...saved,...patch}));assert.deepEqual(actual[i].snapshot(),saved);sameGrid(actual[i],before[i]);
 }
 const mass=actual.reduce((sum,grid)=>sum+grid.volumeM3()+grid.evaporatedM3-grid.inputM3,0);assert.ok(Math.abs(mass)<1e-9);
});
