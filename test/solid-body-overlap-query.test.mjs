import test from 'node:test';
import assert from 'node:assert/strict';
import {SolidBody,SolidBodyOverlapQuery,intersectBoxes3} from '../dist/physics/compound.js';
import {boxBounds} from '../dist/physics/box-overlap.js';

const shapes=()=>[{triangle:[[0,0,0],[.5,0,0],[0,.5,0]],half:[.25,.25,.0004],offset:[.25,.25,0],thickness:.0008,geometryNodes:[0,1,2]},{triangle:[[.5,0,0],[.5,.5,0],[0,.5,0]],half:[.25,.25,.0004],offset:[.25,.25,0],thickness:.0008,geometryNodes:[1,3,2]}];
function oldQuery(){const samples=new Map(),sample=body=>{let value=samples.get(body);if(value)return value;const boxes=body.boxes(),bounds=Float64Array.of(Infinity,Infinity,Infinity,-Infinity,-Infinity,-Infinity);for(const box of boxes){const b=box.bounds??boxBounds(box);for(let axis=0;axis<3;axis++){bounds[axis]=Math.min(bounds[axis],b[axis]);bounds[axis+3]=Math.max(bounds[axis+3],b[axis+3]);}}value={boxes,bounds};samples.set(body,value);return value;};return{invalidate:body=>samples.delete(body),overlaps(a,b){const A=sample(a),B=sample(b),p=A.bounds,q=B.bounds;if(p[0]>q[3]||q[0]>p[3]||p[1]>q[4]||q[1]>p[4]||p[2]>q[5]||q[2]>p[5])return false;for(const first of A.boxes)for(const second of B.boxes)if(intersectBoxes3(first,second,0))return true;return false;}};}

test('opaque separation query preserves complete old bounds/primitive/margin-zero results through invalidated poses and in-place edits',()=>{
 const a=new SolidBody({p:[0,0,0],shapes:shapes()}),b=new SolidBody({p:[0,0,.0002],shapes:shapes()}),actual=new SolidBodyOverlapQuery(),before=oldQuery();
 for(const step of [0,1,2,3,4]){b.p[2]=step%2?.1:.0002;b.shapes[0].triangle[0][2]=step*.00002;actual.invalidate(b);before.invalidate(b);assert.equal(actual.overlaps(a,b),before.overlaps(a,b));assert.equal(actual.overlaps(b,a),before.overlaps(b,a));}
 assert.deepEqual(Object.getOwnPropertyNames(actual),[]);assert.equal(actual.sample,undefined);assert.equal(actual.boxes,undefined);
});

test('boolean queries do not freeze their private prisms; public later exposure remains deeply frozen and old retained geometry never changes',()=>{
 const a=new SolidBody({p:[0,0,0],shapes:shapes()}),b=new SolidBody({p:[0,0,.0002],shapes:shapes()}),query=new SolidBodyOverlapQuery(),freeze=Object.freeze;let prisms=0;Object.freeze=function(value){if(value?.halfThickness!==undefined&&value?.triangle&&value?.vertices)prisms++;return freeze(value);};
 try{assert.equal(query.overlaps(a,b),true);assert.equal(prisms,0);assert.equal(query.overlaps(a,b),true);assert.equal(prisms,0);const old=a.boxes()[0].triangle,saved=JSON.stringify(old);assert.ok(prisms>0);for(const value of [old,...old.vertices,...old.normals,...old.edgeDirections,old.bounds])assert.ok(Object.isFrozen(value));a.shapes[0].triangle[0][2]=.03;query.invalidate(a);query.overlaps(a,b);assert.equal(JSON.stringify(old),saved);for(const box of a.boxes())assert.ok(Object.isFrozen(box.triangle));}finally{Object.freeze=freeze;}
});

test('fake/custom sources retain exact public getter, iterator and cached call behavior',()=>{
 function fixture(Type){const trace=[],source=(id,shift)=>({boxes(){trace.push(id);const boxes=new SolidBody({p:[shift,0,0],half:[.1,.1,.1]}).boxes();return new Proxy(boxes,{get(array,key,receiver){if(key===Symbol.iterator){trace.push(id+':iterator');return array[Symbol.iterator].bind(array);}return Reflect.get(array,key,receiver);}});}}),a=source('A',0),b=source('B',.02),query=new Type();const rows=[query.overlaps(a,b),query.overlaps(a,b)];query.invalidate(a);rows.push(query.overlaps(a,b));return{trace,rows};}
 const expected=fixture(function(){return oldQuery();}),actual=fixture(SolidBodyOverlapQuery);assert.deepEqual(actual,expected);assert.deepEqual(actual.rows,[true,true,true]);
});
