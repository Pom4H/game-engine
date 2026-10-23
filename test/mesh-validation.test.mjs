import test from 'node:test';
import assert from 'node:assert/strict';
import {validateScene} from '../dist/scene/validate.js';

const mesh=()=>({kind:'triangle-mesh',positions:[0,0,0,1,0,0,0,0,1],normals:[0,1,0,0,1,0,0,1,0],uvs:[0,0,1,0,0,1],colors:Array(12).fill(.5),indices:[0,1,2]});
const validate=m=>validateScene({version:1,entities:[{id:'surface',mesh:m,renderOnly:true}]});
test('large-array validation keeps indexed errors, finite coordinates and colour bounds',()=>{
 for(const field of ['positions','normals','uvs','colors'])for(const value of [NaN,Infinity,-Infinity,'0',null]){const m=mesh();m[field][2]=value;assert.throws(()=>validate(m),new RegExp(field+'\\[2\\]'));}
 for(const value of [-.01,1.01]){const m=mesh();m.colors[1]=value;assert.throws(()=>validate(m),/colors\[1\]/);}
 const sparse=mesh();delete sparse.positions[2];assert.throws(()=>validate(sparse),/positions\[2\]/);
});
test('mutable and shallow-frozen authoring is checked again after nested edits',()=>{
 for(const freeze of [m=>m,Object.freeze]){const m=freeze(mesh());validate(m);m.uvs[0]=NaN;assert.throws(()=>validate(m),/uvs\[0\]/);}
});
