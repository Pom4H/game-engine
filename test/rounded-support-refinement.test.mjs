import {test} from 'node:test';
import assert from 'node:assert/strict';
import {SolidWorld,SolidBody} from '../dist/physics/compound.js';

function scene(){const world=new SolidWorld();world.addPlane({p:[0,0,0],hu:10,hv:10,tag:'road'});world.add(new SolidBody({p:[.28,.6,0],half:[.1,.3,.4],mass:40,tag:'flank'}));return world;}
test('rejecting an unsupported flank during the query retains the road behind it',()=>{
 const world=scene(),origin=[0,.85,0],direction=[0,-1,0],raw=world.sphereCast(origin,direction,1,.25);
 assert.equal(raw.body.tag,'flank');assert.ok(Math.abs(raw.n[1])<.2);
 const support=world.sphereCast(origin,direction,1,.25,null,hit=>hit.n[1]>.2?hit:null);
 assert.equal(support.tag,'road');assert.ok(support.plane);assert.ok(Math.abs(support.t-.6)<1e-9);
});
test('finite-shape candidate refinement precedes nearest-hit ordering',()=>{
 const world=scene();let refined=0;
 const support=world.sphereCast([0,.85,0],[0,-1,0],1,.25,null,hit=>{refined++;if(hit.body)hit.t=.85;else hit.t+=.1;return hit;});
 assert.ok(refined>=2);assert.equal(support.tag,'road');assert.ok(Math.abs(support.t-.7)<1e-9);
 assert.equal(world.sphereCast([0,.85,0],[0,-1,0],1,.25,null,()=>null),null);
});
