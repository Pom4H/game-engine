import test from 'node:test';
import assert from 'node:assert/strict';
import {createCharacterHead,characterHeadTopOffset} from '../dist/characters/face.js';
import {sampleWalker,bindHumanoid} from '../dist/animation/locomotion.js';
import {Scene} from '../dist/scene/scene.js';

const defaults={id:'cast-a',seed:17,skin:[.64,.43,.30,1],hair:[.105,.055,.024,1],expression:'skeptical',hairStyle:'swept'};
const points=mesh=>Array.from({length:mesh.positions.length/3},(_,i)=>mesh.positions.slice(i*3,i*3+3));
test('head authoring produces finite indexed surfaces within the declared height for every style and expression',()=>{
  for(const hairStyle of ['swept','short','none'])for(const expression of ['neutral','skeptical','smirk']){
    const head=createCharacterHead({...defaults,hairStyle,expression});let top=-Infinity,triangles=0;
    for(const entity of head.entities){const mesh=entity.mesh;if(mesh.kind!=='triangle-mesh')continue;
      assert.equal(mesh.normals.length,mesh.positions.length);assert.equal(mesh.indices.length%3,0);
      assert.ok(mesh.positions.every(Number.isFinite));assert.ok(mesh.normals.every(Number.isFinite));
      assert.ok(mesh.indices.every(i=>Number.isSafeInteger(i)&&i>=0&&i<mesh.positions.length/3));
      assert.equal(mesh.colors.length,mesh.positions.length/3*4);assert.ok(mesh.colors.every(v=>v>=0&&v<=1));
      top=Math.max(top,...points(mesh).map(p=>p[1]));triangles+=mesh.indices.length/3;
    }
    assert.ok(Math.abs(top-characterHeadTopOffset(hairStyle))<1e-10,`${hairStyle} ${expression} height disagrees with body normalization`);
    assert.ok(triangles>6000&&triangles<40000,'head geometry has a fixed bounded budget');
  }
});
test('the complete head follows one skeletal frame at arbitrary position heading and scale',()=>{
  const head=createCharacterHead(defaults),ids=head.entities.map(e=>e.id);
  assert.equal(new Set(ids).size,ids.length);assert.deepEqual(head.bindings.map(b=>b.entity),ids);
  assert.ok(head.bindings.every(b=>b.joint==='head'&&!b.boneTo));
  const a=sampleWalker({id:'a',root:[0,0,0],speed:0},0),b=sampleWalker({id:'b',root:[7,2,-3],heading:1.1,heightScale:1.4,speed:0},0);
  const before=bindHumanoid(a,head.bindings),after=bindHumanoid(b,head.bindings),cs=Math.cos(1.1),sn=Math.sin(1.1);
  for(let i=0;i<before.length;i++){
    const local=before[i].position.map((v,k)=>v-a.joints.head[k]),world=after[i].position.map((v,k)=>v-b.joints.head[k]);
    const expected=[(cs*local[0]+sn*local[2])*1.4,local[1]*1.4,(-sn*local[0]+cs*local[2])*1.4];
    assert.ok(world.every((v,k)=>Math.abs(v-expected[k])<1e-10));
    assert.ok(after[i].scale.every((v,k)=>Math.abs(v-before[i].scale[k]*1.4)<1e-10));
  }
  const transforms=new Map(after.map(p=>[p.entity,p]));
  assert.doesNotThrow(()=>new Scene({version:1,entities:head.entities.map(e=>({...e,...transforms.get(e.id)}))}));
});
test('expressions change the continuous skin while hair seed leaves anatomy intact',()=>{
  const a=createCharacterHead(defaults),b=createCharacterHead({...defaults,seed:18}),neutral=createCharacterHead({...defaults,expression:'neutral'});
  const part=(head,name)=>head.entities.find(e=>e.id.endsWith('-'+name)).mesh;
  assert.deepEqual(part(a,'skin'),part(b,'skin'));assert.notDeepEqual(part(a,'hair'),part(b,'hair'));
  assert.notDeepEqual(part(a,'skin').positions,part(neutral,'skin').positions);
  assert.deepEqual(a,createCharacterHead(defaults),'same authored spec must reproduce the same geometry');
  part(a,'skin').positions[0]+=1;
  assert.deepEqual(part(b,'skin'),part(createCharacterHead(defaults),'skin'),'separate characters cannot share mutable geometry');
});
test('invalid head parameters fail before producing partial scene data',()=>{
  for(const invalid of [{seed:NaN},{seed:-1},{seed:2**32},{hairStyle:'hat'},{expression:'unknown'},{skin:[1,0,0,.5]},{hair:[1,NaN,0,1]},{id:'../../outside'}])assert.throws(()=>createCharacterHead({...defaults,...invalid}));
});
