import test from 'node:test';
import assert from 'node:assert/strict';
import {SnowMatter,snowSphere,snowThermal,snowBearingDensity} from '../dist/environment/snow-matter.js';

test('soft support and mass contacts share the same pressure-density law',()=>{
 assert.equal(snowBearingDensity(0),160);assert.equal(snowBearingDensity(55000),160+400*(1-Math.exp(-1)));
 assert(snowBearingDensity(200000)>snowBearingDensity(55000));
 for(const n of [-1,NaN,Infinity])assert.throws(()=>snowBearingDensity(n),RangeError);
 const snow=new SnowMatter({cellM:.2,depthM:.48});
 for(let i=0;i<40;i++)snow.contact({position:[.1,0,.1],radiusM:.01,normalLoadN:2200,slipSpeedMps:0,durationSeconds:.1});
 assert(Math.abs(snow.sample(.1,.1).densityKgM3-snowBearingDensity(2200/.04))<1e-8);
});

test('uniform snowfall shares an immutable sample without caching untouched city coordinates',()=>{
 const snow=new SnowMatter({cellM:.2,depthM:.48});snow.cut(snowSphere([0,.25,0],.3));
 const a=snow.sample(100,100),b=snow.sample(-10000,5000);assert.equal(a,b);assert.equal(a.height,.48);assert(Object.isFrozen(a));
 snow.contact({position:[100,0,100],radiusM:.2,normalLoadN:5000,slipSpeedMps:0,durationSeconds:.1});assert(snow.sample(100,100).height<.48);assert.equal(snow.sample(-10000,5000),b);
});
const inventory=(s,min=-10,max=10)=>{let mass=0,heat=0;for(let z=min;z<=max;z++)for(let x=min;x<=max;x++)for(let y=0;y<40;y++){const c=s.cell(x,y,z);mass+=c.massKg;heat+=c.enthalpyJ;}return{mass,heat};};
test('shovel cuts an arbitrary SDF cavity and deposits the same mass and enthalpy',()=>{
 const s=new SnowMatter({cellM:.1,depthM:.5}),before=inventory(s);
 const shape={min:[-.3,.1,-.3],max:[.3,.3,.3],distance:p=>Math.max(Math.hypot(p[0],p[2])-.25,Math.abs(p[1]-.2)-.09)};
 const payload=s.cut(shape);assert(payload.massKg>0);assert(s.cell(0,1,0).massKg<.01);assert(s.cell(0,4,0).massKg>0,'cut must retain an overhang');
 const after=inventory(s);assert(Math.abs(before.mass-after.mass-payload.massKg)<1e-8);
 let remaining=s.deposit([.65,0,.65],payload);remaining=s.deposit([.75,0,.75],remaining);assert(remaining.massKg<1e-8);const deposited=inventory(s);assert(Math.abs(before.mass-deposited.mass)<1e-8);assert(Math.abs(before.heat-deposited.heat)<1e-5);
 const total=deposited.mass;for(let i=0;i<30;i++)s.relax(1/60);assert(Math.abs(inventory(s).mass-total)<1e-7);
});
test('vehicle load compacts without creating mass, thermal work melts and increases adhesion',()=>{
 const s=new SnowMatter({cellM:.1,depthM:.5}),before=inventory(s),contact={position:[0,.5,0],radiusM:.16,normalLoadN:4000,slipSpeedMps:5,durationSeconds:1/60};
 for(let i=0;i<60;i++)s.contact(contact);assert(s.sample(0,0).height<.30);assert(Math.abs(inventory(s).mass-before.mass)<1e-7);
 const cold=s.cut(snowSphere([.6,.35,.6],.1));const wet={...cold,enthalpyJ:cold.massKg*334000*.15};assert(s.adhesion(wet,0,8000)>s.adhesion(cold,-5,8000));
 const h=inventory(s).heat;s.contact({...contact,temperatureC:40,heatJ:2000000});const after=inventory(s);assert(after.heat>h);assert(s.sample(0,0).liquidFraction>0);assert(Math.abs(after.heat-before.heat+cold.enthalpyJ-s.heatAddedJ)<1e-4);
 const snapshot=s.snapshot(),copy=new SnowMatter({cellM:.1,depthM:.5});copy.restore(snapshot);assert.deepEqual(copy.sample(0,0),s.sample(0,0));
});

test('gravity survives render dirty-list consumption and collapses a dumped pile without losing mass',()=>{
 const snow=new SnowMatter({cellM:.1});const packet=snow.cut({min:[-1,0,-1],max:[-.5,.48,-.5],distance:()=>-1});snow.pour([.5,0,.5],packet,.15);
 const before=snow.sample(.5,.5).height,ledger=()=>[...snow.cells].reduce((sum,[key,c])=>sum+c.massKg-.01*Math.max(0,Math.min(.1,.48-(+key.split(',')[1])*.1))*160,0);const mass=ledger();
 for(let n=0;n<80;n++){snow.changedColumns.clear();snow.relax(.1,500);}assert(snow.sample(.5,.5).height<before*.7);assert(Math.abs(ledger()-mass)<1e-7);
});

test('adjacent snapshots invalidate only changed terrain and restore evicted columns',()=>{
 const snow=new SnowMatter({cellM:.1});snow.contact({position:[0,0,0],radiusM:.1,normalLoadN:4000,slipSpeedMps:0,durationSeconds:.1});const snap=snow.snapshot(),h=snow.sample(0,0).height;snow.changedColumns.clear();snow.restore(snap);assert.equal(snow.changedColumns.size,0);assert.equal(snow.sample(0,0).height,h);
 snow.restore({...snap,cells:[]});assert(snow.changedColumns.size>0);assert.equal(snow.sample(0,0).height,.48);
});

test('authority removals free worker residency inside a snapshot range',()=>{
 const server=new SnowMatter({cellM:.1,depthM:.1,maxCells:2}),client=new SnowMatter({cellM:.1,depthM:.1,maxCells:2}),touch=x=>server.contact({position:[x,0,.05],radiusM:.01,normalLoadN:1000,slipSpeedMps:0,durationSeconds:.1});
 touch(.05);touch(.25);client.restore(server.snapshot());server.drainEdits();server.detachWhere(()=>true);touch(.45);client.removeCells(server.drainRemoved());client.apply(server.drainEdits());assert.deepEqual(client.snapshot().cells,server.snapshot().cells);assert.equal(client.cells.size,1);assert.equal(client.sample(.05,.05).height,.1);
});
