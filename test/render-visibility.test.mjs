import test from 'node:test';
import assert from 'node:assert/strict';
import {meshBounds,intersectsClip} from '../dist/render/visibility.js';
import {compose,perspective,multiply4,lookAt} from '../dist/math.js';
const bounds={center:[0,0,0],half:[.5,.5,.5]};
const vp=perspective(Math.PI/2,1,.1,100);
const visible=(position,scale=[1,1,1],rotation=[0,0,0])=>intersectsClip(bounds,multiply4(vp,compose(position,rotation,scale)));
test('clip test rejects boxes outside all six WebGPU planes, preserves intersections',()=>{
 assert.equal(visible([0,0,-3]),true);
 for(const p of [[9,0,-3],[-9,0,-3],[0,9,-3],[0,-9,-3],[0,0,3],[0,0,-102]])assert.equal(visible(p),false);
 assert.equal(visible([0,0,-.1]),true); // near-plane straddling
 assert.equal(visible([0,0,-100]),true); // far-plane straddling
 assert.equal(visible([3.4,0,-3]),true);
 assert.equal(visible([7,0,-3],[10,1,1]),true); // center outside, mesh intersects
 assert.equal(visible([0,0,-3],[-2,3,.2],[.4,.8,.6]),true);
});
test('bounds use mesh vertices, not entity origin; mirrored and light views are independent',()=>{
 const b=meshBounds(new Float32Array([9,-2,-1,0,1,0,11,2,1,0,1,0]));assert.deepEqual(b,{center:[10,0,0],half:[1,2,1]});
 assert.equal(intersectsClip(b,multiply4(vp,compose([-10,0,-4],[0,0,0],[1,1,1]))),true);
 assert.equal(intersectsClip(b,multiply4(vp,compose([0,0,-4],[0,0,0],[1,1,1]))),false);
 const reflection=multiply4(vp,lookAt([0,-3,0],[0,0,-4],[0,-1,0]));
 assert.equal(intersectsClip(bounds,multiply4(reflection,compose([0,0,-4],[0,0,0],[1,1,1]))),true);
});
