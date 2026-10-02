import test from 'node:test';
import assert from 'node:assert/strict';
import {
 AudioSynthFamily,ENGINE_DEPTH,RenderFrameFamily,Scene,WorldGeneratorFamily,
} from '../dist/index.js';
import {ProjectionFamily,projection,scalar} from '../dist/network/index.js';

test('render depth compiles proxy versus visual geometry once',()=>{
 const scene=new Scene({version:1,gravity:[0,0,0],entities:[{
  id:'subject',mesh:{kind:'box',size:[1,1,1]},renderMesh:{kind:'sphere',radius:3},
 }]});
 const family=new RenderFrameFamily(),proxy=family.compile({defaultDepth:0,axes:{render:96}}),full=family.compile({defaultDepth:0,axes:{render:255}});
 assert.ok(proxy&&full);
 assert.equal(proxy(scene).objects[0].primitive.kind,'box');
 assert.equal(full(scene).objects[0].primitive.kind,'sphere');
});

test('audio depth compiles silence or a direct event synthesizer',()=>{
 const family=new AudioSynthFamily();
 assert.equal(family.compile({defaultDepth:0,axes:{audio:0}}),undefined);
 const synth=family.compile({defaultDepth:0,axes:{audio:64}});
 assert.equal(typeof synth,'function');
 const audio=synth({type:'impact',id:1,time:0,point:[0,0,0],normal:[0,1,0],a:'a',b:'ground',materialA:'steel',materialB:'concrete',energy:1,impulse:1,speed:1,size:1},8000);
 assert.equal(audio.sampleRate,8000);assert.ok(audio.left.length>0);
});

test('network projection family compiles cohort schema by network depth',()=>{
 const coarse=projection('coarse',{x:scalar('linear',-100,100)});
 const full=projection('full',{x:scalar('linear',-100,100),energy:scalar('linear',0,1e6)});
 const family=new ProjectionFamily()
  .use({id:'network.coarse',depth:{axis:'network',min:64,max:159},projection:coarse})
  .use({id:'network.full',depth:{axis:'network',min:160},projection:full});
 assert.equal(family.compile({defaultDepth:0,axes:{network:96}}),coarse);
 assert.equal(family.compile({defaultDepth:0,axes:{network:255}}),full);
});

test('world generator family gives InfiniteWorld a direct depth-selected generator',async()=>{
 const family=new WorldGeneratorFamily()
  .use({id:'world.coarse',depth:{axis:'world',min:64,max:159},generate:async demand=>({kind:'coarse',key:demand.key})})
  .use({id:'world.full',depth:{axis:'world',min:160},generate:async demand=>({kind:'full',key:demand.key})});
 const coarse=family.compile({defaultDepth:0,axes:{world:96}}),full=family.compile({defaultDepth:0,axes:{world:255}});
 const demand={id:{lod:0,x:0,z:0},key:'0:0:0',bounds:{minX:0,minZ:0,maxX:10,maxZ:10},sizeM:10,distanceM:0,priority:1},signal=new AbortController().signal;
 assert.deepEqual(await coarse(demand,signal),{kind:'coarse',key:'0:0:0'});
 assert.deepEqual(await full(demand,signal),{kind:'full',key:'0:0:0'});
});
