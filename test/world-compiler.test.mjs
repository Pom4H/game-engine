import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Scene} from '../dist/scene/scene.js';
import {decodeWorldBinary,isWorldBinary} from '../dist/scene/world-binary.js';
import {sceneFromURL} from '../dist/scene/url.js';

const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
const manifest=join(root,'compiler/Cargo.toml');
const example=join(root,'examples/worlds/collision.world');
const hasRust=spawnSync('cargo',['--version'],{encoding:'utf8'}).status===0;

function worldc(...args){
  const result=spawnSync('cargo',['run','--quiet','--manifest-path',manifest,'--',...args],{
    cwd:root,encoding:'utf8',
  });
  return result;
}
function compiledFixture(){
  const dir=mkdtempSync(join(tmpdir(),'worldc-'));
  const output=join(dir,'collision.wscn');
  const result=worldc('compile',example,'-o',output);
  if(result.status!==0){
    rmSync(dir,{recursive:true,force:true});
    assert.fail('worldc compilation failed: '+result.stderr);
  }
  return {bytes:new Uint8Array(readFileSync(output)),dir};
}

test('WSCN decoder rejects malformed and incompatible binary without allocating entities',()=>{
  assert.equal(isWorldBinary(new Uint8Array([87,83,67,78])),true);
  assert.equal(isWorldBinary(new Uint8Array([87,83,67])),false);
  assert.throws(()=>decodeWorldBinary(new Uint8Array(4)),/invalid byte length/);
  const bad=new Uint8Array(160);
  new TextEncoder().encodeInto('WSCN',bad);
  const view=new DataView(bad.buffer);
  view.setUint16(4,2,true);
  assert.throws(()=>decodeWorldBinary(bad),/unsupported ABI version/);
  view.setUint16(4,1,true);
  view.setUint16(6,160,true);
  view.setUint32(8,160,true);
  view.setUint32(16,160,true);
  view.setUint32(20,160,true);
  view.setUint32(24,160,true);
  view.setUint32(28,1<<30,true);
  assert.throws(()=>decodeWorldBinary(bad),/unknown world flags/);
});

test('Rust World compiler produces reproducible engine-ready physics scenes', {skip:!hasRust},()=>{
  const {bytes,dir}=compiledFixture();
  try{
    const {bytes:again,dir:againDir}=compiledFixture();
    try{assert.deepEqual(bytes,again);}finally{rmSync(againDir,{recursive:true,force:true});}
    assert.ok(isWorldBinary(bytes));
    const spec=decodeWorldBinary(bytes);
    assert.equal(spec.version,1);
    assert.equal(spec.seed,42);
    assert.equal(spec.environment.temperatureC,-5);
    assert.equal(spec.environment.snowfall,'light');
    assert.equal(spec.entities.length,2);
    assert.deepEqual(spec.entities[1].mesh,{kind:'sphere',radius:.5});
    assert.equal(spec.entities[1].body.mass,3);
    const a=new Scene(spec),b=new Scene(spec);
    for(let i=0;i<180;i++){a.step(1/60);b.step(1/60);}
    assert.deepEqual(a.snapshot(),b.snapshot());
    assert.ok(a.entities.get('ball').position[1]<3);
    assert.equal(a.entities.get('floor').body.mass,0);
    // Subarray decoder must respect byteOffset (Buffers, packed asset bundles).
    const withPrefix=new Uint8Array(bytes.byteLength+17);
    withPrefix.set(bytes,17);
    assert.deepEqual(decodeWorldBinary(withPrefix.subarray(17)),spec);
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('Rust compiler rejects unit mistakes instead of silently normalizing dimensions', {skip:!hasRust},()=>{
  const dir=mkdtempSync(join(tmpdir(),'worldc-invalid-'));
  try{
    const invalid=join(dir,'bad.world');
    writeFileSync(invalid,'world Bad { entity ball { mesh: sphere(2kg); body: static } }');
    const result=worldc('check',invalid);
    assert.notEqual(result.status,0);
    assert.match(result.stderr,/expected m\/cm\/mm/);
    assert.match(result.stderr,/bad.world:1:/);
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('sceneFromURL loads compiled binary by extension via the existing scene loader', {skip:!hasRust},async()=>{
  const {bytes,dir}=compiledFixture();
  try{
    const url='https://example.test/?src=/collision.wscn&t=0.5&play=0';
    const result=await sceneFromURL(url,async()=>new Response(bytes,{
      status:200,headers:{'content-type':'application/octet-stream'},
    }));
    assert.equal(result.scene.entities[1].id,'ball');
    assert.equal(result.options.time,0.5);
    assert.equal(result.options.paused,true);
    assert.deepEqual(result.scene,decodeWorldBinary(bytes));
  }finally{rmSync(dir,{recursive:true,force:true});}
});
