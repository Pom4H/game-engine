import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {Scene} from '../dist/index.js';
import {MemoryContentStore,canonicalContent,contentHash} from '../dist/render-ir/index.js';
import {createRenderSequenceBundle,lowerRenderProgram,projectSceneRenderFrame} from '../dist/execution/index.js';

test('Scene projects into a content-addressed portable render sequence without touching local renderer',()=>{
 const scene=new Scene({version:1,gravity:[0,0,0],entities:[
  {id:'box',position:[0,0,0],mesh:{kind:'box',size:[1,1,1]},material:{kind:'steel'},body:{motion:'kinematic',mass:1,velocity:[.1,0,0]}},
  {id:'lamp',position:[2,3,1],mesh:{kind:'sphere',radius:.1},light:{kind:'point',intensity:15,range:20}},
 ]});
 const store=new MemoryContentStore(),frames=[];for(let i=0;i<8;i++){frames.push(projectSceneRenderFrame(scene,store,{epoch:1n,frame:BigInt(i)}).frame);scene.step(1/60);}
 const bundle=createRenderSequenceBundle(store,frames,{profileHash:'profile:test',warmupFrames:2}),graph=lowerRenderProgram(bundle.program);
 assert.equal(graph.nodes.length,1);assert.equal(graph.nodes[0].operation,'render.sequence');
 assert.equal(bundle.checkpoint.frames.length,8);assert.equal(bundle.checkpoint.firstFrame,0n);assert.equal(bundle.checkpoint.lastFrameExclusive,8n);
 assert.ok(store.has(bundle.checkpointRef.hash)&&store.has(bundle.manifestRef.hash)&&store.has(bundle.programRef.hash));
 assert.ok(bundle.manifest.resources.some(ref=>ref.kind==='mesh'));assert.ok(bundle.manifest.resources.some(ref=>ref.kind==='material'));
});
test('content hashes are canonical SHA-256 and preserve non-finite numbers',()=>{
 const a={z:Infinity,a:[1,-0,NaN]},b={a:[1,-0,NaN],z:Infinity},canonical=canonicalContent(a);
 assert.equal(canonical,canonicalContent(b));
 const expected='sha256:'+createHash('sha256').update(canonical).digest('hex');assert.equal(contentHash(a),expected);
 const store=new MemoryContentStore(),ra=store.put('buffer',a),rb=store.put('buffer',b);assert.equal(ra.hash,rb.hash);assert.match(ra.hash,/^sha256:[0-9a-f]{64}$/);
});
