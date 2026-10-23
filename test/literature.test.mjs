import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Scene} from '../dist/scene/scene.js';
import {decodeWorldBinary} from '../dist/scene/world-binary.js';
import {compileLiteraryDraft,literaryView} from '../dist/literature/index.js';

const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
const hasRust=spawnSync('cargo',['--version']).status===0;
const draft=JSON.parse(readFileSync(join(root,'examples/literature/pereprava.draft.json'),'utf8'));
function world(){
  const dir=mkdtempSync(join(tmpdir(),'literature-'));
  try{
    const output=join(dir,'scene.wscn');
    const command=spawnSync('cargo',['run','--quiet','--manifest-path','compiler/Cargo.toml','--',
      'compile','examples/literature/pereprava.world','-o',output],{cwd:root,encoding:'utf8'});
    assert.equal(command.status,0,command.stderr);
    return decodeWorldBinary(readFileSync(output));
  }finally{rmSync(dir,{recursive:true,force:true});}
}

test('literary claims are grounded in exact spans, including repeated phrases',()=>{
  const base={version:1,entities:[]};
  const d={version:1,source:'Снег. Снег.',claims:[{id:'snow',quote:'Снег.',reading:'uncertain'}],
    facts:[],visuals:[],shots:[]};
  assert.throws(()=>compileLiteraryDraft(d,base),/repeated/);
  d.claims[0].offset=6;
  assert.equal(compileLiteraryDraft(d,base).provenance.claims[0].resolvedOffset,6);
  d.claims[0].offset=5;
  assert.throws(()=>compileLiteraryDraft(d,base),/exact source span/);
});

test('metaphors cannot become authoritative physical facts',()=>{
  const base={version:1,entities:[]};
  const d={version:1,source:'Дом вздохнул.',claims:[{id:'breath',quote:'Дом вздохнул.',reading:'figurative'}],
    facts:[{claimId:'breath',kind:'temperatureC',value:20}],visuals:[],shots:[]};
  assert.throws(()=>compileLiteraryDraft(d,base),/only literal claims/);
  d.facts=[];
  d.visuals=[{claimId:'breath',entity:{id:'breath',mesh:{kind:'sphere',radius:1},renderOnly:true,
    body:{mass:10}}}];
  assert.throws(()=>compileLiteraryDraft(d,base),/renderOnly/);
});

test('a guessed render mesh never acquires an environment or collider',()=>{
  const base={version:1,entities:[{id:'existing',mesh:{kind:'box',size:[1,1,1]},body:{mass:0}}]};
  const d={version:1,source:'Золотой свет на реке.',claims:[{id:'gold',quote:'Золотой свет на реке.',reading:'figurative'}],
    facts:[],visuals:[{claimId:'gold',entity:{id:'highlight',renderOnly:true,mesh:{kind:'plane',size:[3,2]},
      material:{kind:'mirror'}}}],shots:[]};
  const result=compileLiteraryDraft(d,base);
  assert.equal(result.scene.entities[1].renderOnly,true);
  assert.equal(result.scene.entities[1].body,undefined);
  assert.deepEqual(result.provenance.ungrounded,['gold']);
  assert.equal(base.entities.length,1,'compiler must not mutate the canonical scene');
});

test('measured literary facts survive Rust World compilation and observers share replay', {skip:!hasRust},()=>{
  const base=world();
  const result=compileLiteraryDraft(draft,base);
  assert.equal(base.environment.temperatureC,0);
  assert.equal(result.scene.environment.temperatureC,-8);
  assert.equal(result.scene.environment.snowfall,'moderate');
  assert.equal(result.scene.entities.find(e=>e.id==='car').body.mass,2200);
  assert.ok(Math.abs(result.scene.entities.find(e=>e.id==='car').body.velocity[0]-10)<1e-8);
  assert.equal(result.provenance.ungrounded.includes('bridge-breath'),true);
  assert.equal(result.scene.entities.find(e=>e.id==='water-glints').renderOnly,true);
  assert.equal(result.shots.length,2);
  const a=new Scene(result.scene);
  const b=new Scene(result.scene);
  const before=a.snapshot();
  a.setCamera(result.shots[0].camera);
  assert.deepEqual(a.snapshot(),before,'first observer must not mutate physical world');
  a.setCamera(result.shots[1].camera);
  assert.deepEqual(a.snapshot(),before,'changing the observer must not fork physical state');
  assert.deepEqual(literaryView(result.scene,result.shots[0]).entities,result.scene.entities);
  for(let i=0;i<60;i++){a.step(1/60);b.step(1/60);}
  assert.deepEqual(a.snapshot(),b.snapshot(),'camera may not affect world progression');
});

test('hallucinated numeric facts are rejected instead of being silently accepted',{skip:!hasRust},()=>{
  const base=world();
  const changed=structuredClone(draft);
  changed.facts.find(f=>f.kind==='massKg').value=9000;
  assert.throws(()=>compileLiteraryDraft(changed,base),/explicit matching number/);
  const metaphor=structuredClone(draft);
  metaphor.facts.push({claimId:'bridge-breath',kind:'velocityX',entityId:'car',value:10});
  assert.throws(()=>compileLiteraryDraft(metaphor,base),/only literal claims/);
  const metel={version:1,source:'В ущелье бушует метель.',
    claims:[{id:'blizzard',quote:'В ущелье бушует метель.',reading:'literal'}],
    facts:[{claimId:'blizzard',kind:'snowfall',value:'heavy'}],visuals:[],shots:[]};
  assert.throws(()=>compileLiteraryDraft(metel,base),/snowfall needs explicit intensity/);
});
