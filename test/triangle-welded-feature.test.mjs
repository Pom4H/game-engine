import test from 'node:test';
import assert from 'node:assert/strict';
import {SolidBody,intersectBoxes3,Qaxis,Qrotate} from '../dist/physics/compound.js';
import {prismFeatureNormalAllowed} from '../dist/physics/triangle-prism.js';
const square=()=>[{half:[1,1,.001],triangle:[[0,0,0],[1,0,0],[0,1,0]],structureNodes:[0,1,2],thickness:.0008},{half:[1,1,.001],triangle:[[1,0,0],[1,1,0],[0,1,0]],structureNodes:[1,3,2],thickness:.0008}];

test('welded seam sidewalls remain separating axes but cannot become contradictory penetration normals',()=>{
 const body=new SolidBody({p:[0,0,0],shapes:square()}),[a,b]=body.boxes(),d=Math.SQRT1_2;assert.equal(prismFeatureNormalAllowed(a,[d,d,0]),false);assert.equal(prismFeatureNormalAllowed(b,[-d,-d,0]),false);assert.equal(prismFeatureNormalAllowed(a,[-1,0,0]),true,'the exposed boundary sidewall remains physical');assert.equal(prismFeatureNormalAllowed(a,[0,0,1]),true);
 const outside=new SolidBody({p:[.9,.9,0],half:[.02,.02,.01]}).boxes()[0];assert.equal(intersectBoxes3(a,outside),null,'the hidden seam axis must STILL reject a separated triangle');assert.ok(intersectBoxes3(b,outside));
 const crossing=new SolidBody({p:[.5001,.5001,0],half:[.001,.001,.01]}).boxes()[0];for(const face of [a,b]){const contact=intersectBoxes3(face,crossing);assert.ok(contact);assert.ok(Math.abs(contact.n[2])>1-1e-12,'the next exposed face axis must replace the internal seam axis');assert.ok(contact.depth>0);}
 const separatedAcrossSeam=new SolidBody({p:[.501,.501,0],half:[.0001,.0001,.01]}).boxes()[0],speculative=intersectBoxes3(a,separatedAcrossSeam);assert.ok(speculative);assert.ok(speculative.depth<0,'a hidden separating axis cannot become a positive position constraint');assert.ok(Math.abs(speculative.n[2])>1-1e-12);assert.equal(intersectBoxes3(a,separatedAcrossSeam,0),null);assert.ok(intersectBoxes3(b,separatedAcrossSeam,0));
});

test('convex folded edges retain their physical normal cone and whole-scene rotation preserves eligibility',()=>{
 const shapes=[{half:[1,1,1],triangle:[[0,0,0],[0,0,1],[1,0,0]],geometryNodes:[10,11,12],thickness:.0008},{half:[1,1,1],triangle:[[0,0,1],[0,0,0],[0,1,0]],geometryNodes:[11,10,13],thickness:.0008}],q=Qaxis([.3,.7,-.2],.8),body=new SolidBody({p:[2,-1,3],q,shapes}),face=body.boxes()[0];assert.equal(prismFeatureNormalAllowed(face,Qrotate(q,[-Math.SQRT1_2,-Math.SQRT1_2,0])),true);assert.equal(prismFeatureNormalAllowed(face,Qrotate(q,[-Math.SQRT1_2,Math.SQRT1_2,0])),false);
});

test('fracture reopens an edge and previous geometry snapshots keep their original weld ownership',()=>{
 const shapes=square(),body=new SolidBody({p:[0,0,0],shapes}),old=body.boxes();assert.equal(prismFeatureNormalAllowed(old[0],[Math.SQRT1_2,Math.SQRT1_2,0]),false);body.shapes=[shapes[0]];const cut=body.boxes();assert.equal(prismFeatureNormalAllowed(cut[0],[Math.SQRT1_2,Math.SQRT1_2,0]),true);assert.equal(prismFeatureNormalAllowed(old[0],[Math.SQRT1_2,Math.SQRT1_2,0]),false);
 body.shapes=shapes;shapes[1].triangle=[[0,0,0],[0,0,0],[0,0,0]];assert.equal(prismFeatureNormalAllowed(body.boxes()[0],[Math.SQRT1_2,Math.SQRT1_2,0]),true);
});
