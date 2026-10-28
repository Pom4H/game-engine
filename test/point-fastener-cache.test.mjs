import test from 'node:test';
import assert from 'node:assert/strict';
import {SolidBody,SolidWorld,Qaxis} from '../dist/physics/compound.js';
import {PointFastener} from '../dist/physics/point-fastener.js';
import {PointFastener as Before} from './fixtures/point-fastener-before-frame-cache.mjs';
test('cached pin geometry retains the frozen velocity solve, reaction and fracture at changing poses and rates',()=>{
 function run(Type,dt,force){const w=new SolidWorld(),a=w.add(new SolidBody({mass:200})),b=w.add(new SolidBody({p:[0,1,0],q:Qaxis([0,0,1],.03),half:[.7,.025,.3],mass:12}));a.ignore.add(b.id);b.ignore.add(a.id);const pin=new Type(a,b,()=>a.point([0,1,0]),[0,0,0],{stiffness:150000,damping:300,failureForce:force,engagement:.2});w.constraint(a,b,pin);const rows=[];for(let i=0;i<80;i++){b.applyForce([Math.sin(i*.1)*500,0,0]);w.step(dt);rows.push([...a.p,...a.v,...a.w,...b.p,...b.v,...b.w,pin.force,pin.extension,pin.broken]);}return rows;}
 for(const dt of [1/60,1/120,1/240])for(const force of [1000,100000])assert.deepEqual(run(PointFastener,dt,force),run(Before,dt,force));
});
