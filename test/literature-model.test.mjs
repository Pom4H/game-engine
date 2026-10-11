import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {compileGeneratedLiterature} from '../dist/literature/generative.js';
import {interpretOffline} from '../tools/literature/offline.mjs';
import {requestLiteraryDraft} from '../tools/literature/provider.mjs';

const source=readFileSync(fileURLToPath(new URL('../examples/literature/pereprava.txt',import.meta.url)),'utf8');
const world=()=>({
  version:1,seed:42,ground:-100,environment:{temperatureC:0,snowfall:'none'},
  entities:[{id:'car',mesh:{kind:'box',size:[4.8,1.8,2.1]},position:[-10,5,0],
    material:{kind:'steel'},body:{mass:2000,velocity:[0,0,0]}}],
});

test('plain Russian page produces a guarded engine scene without authored JSON',()=>{
  const original=world();
  const draft=interpretOffline(source,original);
  assert.equal(draft.source,source);
  const {scene,shots,provenance}=compileGeneratedLiterature(source,draft,original);
  assert.equal(provenance.facts.length,4);
  assert.equal(provenance.ungrounded.length,2);
  assert.equal(original.entities.length,1,'authoritative baseline must not be mutated');
  assert.equal(scene.entities.find(e=>e.id==='car').body.mass,2200);
  assert.ok(Math.abs(scene.entities.find(e=>e.id==='car').body.velocity[0]-10)<1e-8);
  assert.equal(scene.environment.temperatureC,-8);
  assert.equal(scene.environment.snowfall,'moderate');
  assert.ok(shots.length>=2);
  assert.ok(scene.entities.find(e=>e.id==='visual-helicopter-fuselage'));
  assert.ok(scene.entities.find(e=>e.id==='visual-moon'));
  for(const visual of provenance.visualEntities){
    const entity=scene.entities.find(e=>e.id===visual.id);
    assert.equal(entity.renderOnly,true);
    assert.equal(entity.body,undefined);
    assert.equal(entity.environmental,undefined);
  }
});

test('visual model may not introduce geometry with physics, textures or external URLs',()=>{
  const valid=interpretOffline(source,world());
  const hazardous=structuredClone(valid);
  hazardous.visuals[0].entity.body={mass:100};
  assert.throws(()=>compileGeneratedLiterature(source,hazardous,world()),/cannot set body/);
  const texture=structuredClone(valid);
  texture.visuals[0].entity.material.texture={url:'https://bad.example/steal'};
  assert.throws(()=>compileGeneratedLiterature(source,texture,world()),/cannot set texture/);
  const geometry=structuredClone(valid);
  geometry.visuals[0].entity.mesh={kind:'triangle-mesh',positions:[],indices:[],normals:[]};
  assert.throws(()=>compileGeneratedLiterature(source,geometry,world()),/mesh must be/);
});

test('model cannot change source to manufacture proof for physical facts',()=>{
  const payload=interpretOffline(source,world());
  payload.source=source+'\nТуман стал прозрачным.';
  assert.throws(()=>compileGeneratedLiterature(source,payload,world()),/differs from the original/);
  const mass=interpretOffline(source,world());
  mass.facts.find(f=>f.kind==='massKg').value=9000;
  assert.throws(()=>compileGeneratedLiterature(source,mass,world()),/explicit matching number/);
});

test('model cannot replace a physical scene entity with a visual-only twin',()=>{
  const payload=interpretOffline(source,world());
  payload.visuals[0].entity.id='car';
  assert.throws(()=>compileGeneratedLiterature(source,payload,world()),/duplicate/);
});

test('OpenAI-compatible model adapter sends original passage and parses strict JSON',async()=>{
  const proposal=interpretOffline(source,world());
  let called=0;
  const fetcher=async(url,init)=>{
    called++;
    assert.equal(url,'http://127.0.0.1:8000/v1/chat/completions');
    const body=JSON.parse(init.body);
    assert.equal(body.model,'literature-local');
    assert.equal(JSON.parse(body.messages[1].content).source,source);
    assert.match(body.messages[0].content,/renderOnly:true/);
    return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(proposal)}}]}),{
      status:200,headers:{'content-type':'application/json'},
    });
  };
  const result=await requestLiteraryDraft({
    source,world:world(),url:'http://127.0.0.1:8000/v1/chat/completions',
    model:'literature-local',fetcher,
  });
  assert.equal(called,1);
  assert.equal(compileGeneratedLiterature(source,result,world()).scene.environment.temperatureC,-8);
  await assert.rejects(()=>requestLiteraryDraft({
    source,world:world(),url:'http://external.test/v1/chat/completions',
    model:'foo',fetcher,
  }),/HTTPS or loopback/);
});

test('only known nouns are recognized offline; unrecognized text needs real model',()=>{
  const prose='Над городом лежала невероятная тишина.';
  const payload=interpretOffline(prose);
  assert.throws(()=>compileGeneratedLiterature(prose,payload),/no visible world/);
});
