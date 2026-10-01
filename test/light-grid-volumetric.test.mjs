import test from 'node:test';
import assert from 'node:assert/strict';
import {buildLightGrid,LIGHT_SOURCE_FLOATS,MAX_RENDER_LIGHTS} from '../dist/render/light-grid.js';

test('light grid carries physical volumetric fixture data without a second light list',()=>{
 const lantern={position:[4,5,6],light:{kind:'point',color:[1,.84,.69],intensity:8,range:12,volumetric:{profile:'lantern-4pane',yaw:.4,strength:1.45,rangeScale:1.5}}};
 const plain={position:[30,5,0],light:{kind:'point',color:[1,1,1],intensity:1,range:4}};
 const grid=buildLightGrid([plain,lantern],[0,1.7,0]);
 assert.equal(grid.lights.length,4+MAX_RENDER_LIGHTS*LIGHT_SOURCE_FLOATS);
 assert.equal(grid.count,2);
 const o=4;
 assert.deepEqual(Array.from(grid.lights.slice(o,o+4)),[4,5,6,12]);
 assert.ok(Math.abs(grid.lights[o+4]-1)<1e-6);
 assert.ok(Math.abs(grid.lights[o+5]-.84)<1e-5);
 assert.ok(Math.abs(grid.lights[o+6]-.69)<1e-5);
 assert.equal(grid.lights[o+7],8);
 assert.equal(grid.lights[o+8],1);
 assert.ok(Math.abs(grid.lights[o+9]-.4)<1e-5);
 assert.ok(Math.abs(grid.lights[o+10]-1.45)<1e-5);
 assert.ok(Math.abs(grid.lights[o+11]-1.5)<1e-6);
});

test('medium range participates in ranking so nearby off-frustum fog lights are not starved',()=>{
 const visibleWeak={position:[7,2,0],light:{kind:'point',intensity:1,range:4}};
 const outsideStrong={position:[15,2,9],light:{kind:'point',intensity:4,range:7,volumetric:{profile:'lantern-4pane',strength:1.6,rangeScale:1.8}}};
 const grid=buildLightGrid([visibleWeak,outsideStrong],[0,2,0]);
 // The stronger medium contributor is first in the shared packed list. The renderer
 // performs no frustum filter on lights before this ranking.
 assert.deepEqual(Array.from(grid.lights.slice(4,7)),[15,2,9]);
});
