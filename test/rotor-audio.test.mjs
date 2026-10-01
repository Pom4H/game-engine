import test from 'node:test';
import assert from 'node:assert/strict';
import {renderRotorSound} from '../dist/audio/rotor.js';

const rms=x=>Math.sqrt(x.reduce((s,v)=>s+v*v,0)/x.length);

test('rotor acoustics are deterministic and derive energy from physical rotor state',()=>{
 const a=renderRotorSound({rpm:400,blades:4,radiusM:5.2,loadN:11000},.25,12000);
 const b=renderRotorSound({rpm:400,blades:4,radiusM:5.2,loadN:11000},.25,12000);
 assert.deepEqual([...a.left],[...b.left]);assert.ok(rms(a.left)>.01);
});

test('vortex ring and retreating stall add broadband rotor energy',()=>{
 const clean=renderRotorSound({rpm:400,blades:4,radiusM:5.2,loadN:9000},.3,12000);
 const dirty=renderRotorSound({rpm:400,blades:4,radiusM:5.2,loadN:9000,vortexRing:.9,retreatingStall:.8},.3,12000);
 assert.ok(rms(dirty.left)>rms(clean.left)*1.08);
});
