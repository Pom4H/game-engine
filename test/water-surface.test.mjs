import test from 'node:test';
import assert from 'node:assert/strict';
import {appendWaterSurfaceCell} from '../dist/procedural/water-surface.js';
const mesh=()=>({positions:[],normals:[],indices:[]});
const cell={x:0,z:0,size:4,bedM:8.14,depthM:.002,segments:4};

test('optional optical depths exclude the render bias and remain finite at clipped shorelines',()=>{
 const film={...mesh(),depths:[]};appendWaterSurfaceCell(film,cell,(x,z)=>8+.07*x+.02*z);assert.equal(film.depths.length,film.positions.length/3);for(const d of film.depths)assert.ok(Math.abs(d-.002)<1e-12);
 const shore={...mesh(),depths:[]};appendWaterSurfaceCell(shore,{x:0,z:0,size:4,bedM:-6,depthM:8,maximumStepM:10},x=>x);assert.equal(shore.depths.length,shore.positions.length/3);assert.ok(shore.depths.every(d=>Number.isFinite(d)&&d>=0));assert.ok(shore.depths.some(d=>d===0));
});

test('a two millimetre film stays above every point of an inclined deck',()=>{
 const result=mesh(),floor=(x,z)=>8+.07*x+.02*z;
 appendWaterSurfaceCell(result,cell,floor);
 assert.equal(result.indices.length,4*4*6);
 for(let i=0;i<result.positions.length;i+=3){const [x,y,z]=result.positions.slice(i,i+3);assert.ok(Math.abs(y-floor(x,z)-.006)<1e-12);assert.ok(result.normals[i+1]>.99);}
 // Every face is parallel to this substrate, including its interior: there is
 // no wet/dry intersection for subpixel camera jitter to alternate between.
 for(let i=0;i<result.positions.length;i+=9){let x=0,y=0,z=0;for(let k=0;k<3;k++){x+=result.positions[i+k*3]/3;y+=result.positions[i+k*3+1]/3;z+=result.positions[i+k*3+2]/3;}assert.ok(Math.abs(y-floor(x,z)-.006)<1e-12);}
});

test('deep standing water keeps a horizontal free surface',()=>{
 const result=mesh();appendWaterSurfaceCell(result,{...cell,bedM:8.2,depthM:1},x=>8+.05*x);
 for(let i=1;i<result.positions.length;i+=3)assert.ok(Math.abs(result.positions[i]-9.204)<1e-12);
 for(let i=1;i<result.normals.length;i+=3)assert.equal(result.normals[i],1);
});

test('missing supports and height discontinuities do not create water curtains',()=>{
 const result=mesh();appendWaterSurfaceCell(result,cell,(x,z)=>x===2?null:x<2?8:20);
 for(let i=0;i<result.positions.length;i+=9){const xs=[0,3,6].map(k=>result.positions[i+k]);assert.ok(Math.max(...xs)-Math.min(...xs)<=1);}
 assert.ok(result.indices.length>0);assert.ok(result.indices.length<4*4*6);
});

test('shoreline clipping retains its plane and the documented worst-case face bound',()=>{
 const result=mesh();appendWaterSurfaceCell(result,{x:0,z:0,size:4,bedM:-6,depthM:8,maximumStepM:10},x=>x);
 assert.equal(result.indices.length/3,3);assert.ok(result.indices.length/3<=4);
 for(let i=0;i<result.positions.length;i+=3){assert.ok(Math.abs(result.positions[i+1]-2.004)<1e-12);assert.ok(result.positions[i]<=2.004+1e-12);}
});

test('tessellation and invalid substrate values are bounded and rejected',()=>{
 for(const bad of [{segments:0},{segments:17},{segments:1.5},{depthM:-1},{size:Infinity},{biasM:-1}])assert.throws(()=>appendWaterSurfaceCell(mesh(),{...cell,...bad},()=>8),RangeError);
 assert.throws(()=>appendWaterSurfaceCell(mesh(),cell,()=>NaN),RangeError);
 const empty=mesh();appendWaterSurfaceCell(empty,cell,()=>null);assert.equal(empty.indices.length,0);
});
