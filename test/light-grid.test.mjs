import test from 'node:test';
import assert from 'node:assert/strict';
import {buildLightGrid,LIGHT_GRID_SIDE,LIGHTS_PER_CELL,MAX_RENDER_LIGHTS} from '../dist/render/light-grid.js';

const indicesAt=(grid,x,z)=>{
 const [ox,oz,size]=grid.lights,cx=Math.floor((x-ox)/size),cz=Math.floor((z-oz)/size);
 if(cx<0||cz<0||cx>=LIGHT_GRID_SIDE||cz>=LIGHT_GRID_SIDE)return [];
 const base=(cz*LIGHT_GRID_SIDE+cx)*(LIGHTS_PER_CELL+1);
 return Array.from(grid.cells.slice(base+1,base+1+grid.cells[base]));
};
test('world light bins illuminate each end of a long surface independently of its origin',()=>{
 const sources=[-70,0,70].map(x=>({position:[x,5,0],light:{range:12,intensity:6,color:[1,.6,.2]}}));
 const grid=buildLightGrid(sources,[0,2,4]);
 for(const x of [-70,0,70]){
  const indices=indicesAt(grid,x,0);assert.ok(indices.length);
  assert.ok(indices.some(i=>grid.lights[4+i*8]===x));
  assert.ok(indices.every(i=>Math.abs(grid.lights[4+i*8]-x)<20));
 }
 assert.equal(indicesAt(grid,40,70).length,0);
});
test('light storage and crowded bins remain bounded and deterministic',()=>{
 const sources=Array.from({length:300},(_,i)=>({position:[i%4,2,i%7],light:{range:30,intensity:i+1}}));
 const a=buildLightGrid(sources,[0,0,0]),b=buildLightGrid(sources,[0,0,0]);
 assert.deepEqual(a,b);assert.equal(a.count,MAX_RENDER_LIGHTS);assert.ok(a.overflow>0);
 for(let i=0;i<a.cells.length;i+=LIGHTS_PER_CELL+1){assert.ok(a.cells[i]<=LIGHTS_PER_CELL);for(let j=0;j<a.cells[i];j++)assert.ok(a.cells[i+1+j]<a.count);}
 assert.equal(indicesAt(a,-10000,0).length,0);
});
