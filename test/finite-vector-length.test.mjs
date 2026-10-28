import test from 'node:test';import assert from 'node:assert/strict';
import {finiteNorm3} from '../dist/physics/finite-vector-length.js';
test('ordinary finite vector length stays within roundoff while extreme scales retain stable hypot semantics',()=>{
 for(const scale of [1e-300,1e-160,1e-140,1e-6,1,1e6,1e140,1e160,1e300])for(let i=1;i<=100;i++){const v=[Math.sin(i)*scale,Math.cos(i*.7)*scale,Math.sin(i*.13)*scale],expected=Math.hypot(...v);assert.ok(Math.abs(finiteNorm3(...v)-expected)<=expected*5e-16);}
 for(const v of [[0,0,0],[Number.MIN_VALUE,0,0],[1e308,1e308,1e308],[Infinity,1,NaN],[-Infinity,NaN,0],[NaN,0,1]])assert.ok(Object.is(finiteNorm3(...v),Math.hypot(...v)));
});
