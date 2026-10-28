import test from 'node:test';import assert from 'node:assert/strict';
import {SoilHydrologyGrid,exchangeHydrologyEdges} from '../dist/environment/soil-hydrology.js';
import {weatherTemperature,weatherFront} from '../dist/environment/weather-field.js';
const loam={depthM:.12,porosity:.45,fieldCapacity:.25,conductivityMps:3e-6,fineFraction:.8,rootCover:.5},sealed={depthM:0,porosity:0,fieldCapacity:0,conductivityMps:0,fineFraction:0,rootCover:0};
const make=(p=loam,bed=new Float64Array(16))=>new SoilHydrologyGrid(Array(16).fill(p),bed,4,1);
const rain={rainMps:.02/3600,snowMps:0,temperatureC:15,humidity:.9,sunlightWm2:0,windMps:1},dry={...rain,rainMps:0,humidity:.3,sunlightWm2:600,windMps:3};
test('rain is retained below loose terrain, dries slower than asphalt and creates mud with one conserved water budget',()=>{
 const soil=make(),road=make(sealed);for(let i=0;i<24;i++){soil.stepWeather(300,rain);road.stepWeather(300,rain);}
 assert.ok(soil.soil[0]>0);assert.ok(soil.sample(0).mud>0);assert.ok(soil.water.depth[0]<road.water.depth[0]);
 const soilBefore=soil.soil[0],roadBefore=road.water.depth[0];for(let i=0;i<48;i++){soil.stepWeather(300,dry);road.stepWeather(300,dry);}
 assert.ok((soilBefore-soil.soil[0])/soilBefore<(roadBefore-road.water.depth[0])/roadBefore);
 for(const field of [soil,road])assert.ok(Math.abs(field.volumeM3()+field.evaporatedM3-field.inputM3)<1e-10);
});
test('saturation produces surface runoff, downhill flow and persistent fields through restore',()=>{
 const bed=Float64Array.from({length:16},(_,i)=>(3-i%4)*.01),s=make({...loam,depthM:.02,conductivityMps:1e-7},bed);
 for(let i=0;i<12;i++){s.stepWeather(300,{...rain,rainMps:.1/3600});s.stepFlow(300);}assert.ok(s.water.depth[3]>s.water.depth[0]);
 const copy=make({...loam,depthM:.02,conductivityMps:1e-7},bed);copy.restore(s.snapshot());assert.deepEqual(copy.snapshot(),s.snapshot());
 assert.ok(Math.abs(s.volumeM3()+s.evaporatedM3-s.inputM3)<1e-9);
});
test('freezing and thawing retain precipitation instead of creating or destroying water',()=>{
 const s=make();s.addWater(0,.02);for(let i=0;i<10;i++)s.stepWeather(300,{...rain,rainMps:0,snowMps:.01/3600,temperatureC:-10});assert.ok(s.ice[0]>0);assert.ok(s.snow[0]>0);
 for(let i=0;i<20;i++)s.stepWeather(300,{...dry,temperatureC:25});assert.ok(Math.abs(s.volumeM3()+s.evaporatedM3-s.inputM3)<1e-10);
});
test('patch boundaries transfer the same water to the neighbour instead of a runoff sink',()=>{
 const a=make(sealed),b=make(sealed);a.addWater(3,1);const total=a.volumeM3()+b.volumeM3();for(let i=0;i<60;i++)exchangeHydrologyEdges([{a,b,axis:'x'}],1);
 assert.ok(b.volumeM3()>0);assert.ok(Math.abs(a.volumeM3()+b.volumeM3()-total)<1e-12);
});

test('corner donors and subsurface seams remain nonnegative and conserve mass independent of edge enumeration',()=>{
 const run=reverse=>{const a=make(),b=make(),c=make(),d=make();a.ground[15]=.03;a.inputM3=.03;a.addWater(15,.02);const edges=[{a,b,axis:'x'},{a,b:c,axis:'z'},{a:b,b:d,axis:'z'},{a:c,b:d,axis:'x'}];
  for(let i=0;i<120;i++){exchangeHydrologyEdges(reverse?[...edges].reverse():edges,60);for(const g of [a,b,c,d]){assert.ok([...g.water.depth,...g.ground].every(v=>v>=0));assert.ok(Math.abs(g.volumeM3()+g.evaporatedM3-g.inputM3-g.boundaryNetM3)<1e-12);}}
  return [a,b,c,d].map(g=>g.snapshot());};
 const a=run(false),b=run(true);for(let i=0;i<a.length;i++)for(const key of ['soil','ground','water'])for(let j=0;j<a[i][key].length;j++)assert.ok(Math.abs(a[i][key][j]-b[i][key][j])<1e-14);
 assert.ok(a[1].ground.some(v=>v>0));
});

test('invalid saved fields and forcing cannot poison a valid water budget',()=>{
 const g=make(),before=g.snapshot();for(const patch of [{inputM3:Infinity},{boundaryNetM3:NaN},{soil:[-1]},{evaporatedM3:-1}])assert.throws(()=>g.restore({...before,...patch}));
 assert.throws(()=>g.stepWeather(1,{...rain,humidity:2}));assert.throws(()=>exchangeHydrologyEdges([],NaN));assert.deepEqual(g.snapshot(),before);
});
test('weather begins at zero, changes continuously within the requested bounds and is independent of query order',()=>{
 assert.equal(weatherTemperature(29,480),0);const history=[];for(let minute=480;minute<20000;minute+=5){const t=weatherTemperature(29,minute);assert.ok(t>=-10&&t<=25);assert.ok(Math.abs(t-weatherTemperature(29,minute+.001))<.001);history.push(t);}
 assert.ok(Math.min(...history)<-5&&Math.max(...history)>20);assert.deepEqual(weatherFront(29,1700,-200,300),weatherFront(29,1700,-200,300));
});
