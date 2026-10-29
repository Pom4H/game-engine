import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {RustKernelRuntime,createRustKernelRuntime,RustKernelPass as P} from '../dist/rust.js';
import {solveWheelContact} from '../dist/physics/wheel-contact.js';
import {dihedralGeometry} from '../dist/physics/dihedral.js';
import {applyStructuralSkin} from '../dist/physics/structural-skin.js';
import {m3StructuralBlueprint} from '../dist/vehicles/m3.js';
import {material} from '../dist/materials/catalog.js';
import {ElasticPlasticPanelResponse} from '../dist/vehicles/interaction-physics.js';
let bytes;
try {bytes=await readFile(process.env.ROM4_RUST_WASM??new URL('../artifacts/rust-engine/rom4-engine.scalar.wasm',import.meta.url));}
catch(error){if(error.code!=='ENOENT'||process.env.ROM4_REQUIRE_RUST==='1')throw error;}
const options={skip:!bytes?'Build Rust runtime first: npm run rust:verify':false};
const program=bytes?await WebAssembly.compile(bytes):undefined;
function close(a,b,label,abs=1e-9,rel=1e-10){assert.ok(Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<=abs+rel*Math.abs(a),`${label}: ${a} != ${b}`);}
function rng(seed=41){return()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/2**32;};}
async function runtime(){return createRustKernelRuntime(program);}

test('Rust module has no per-element JavaScript imports',options,()=>{assert.deepEqual(WebAssembly.Module.imports(program),[]);});
test('4096 wheel solves match production across traction, braking, slip and zero limits',options,async()=>{
  const r=await runtime(),batch=r.createBatch({wheelCount:4096}),a=batch.buffers.wheelInput,random=rng(),out={};
  try {
    for(let i=0;i<4096;i++){
      const limit=i%23===0?0:500+random()*5500;
      a.set([1/[60,120,240][i%3],.2+random()*.4,.2+random()*2.8,(random()-.5)*400,
        (random()-.5)*100,(random()-.5)*1.5,limit,(random()-.5)*1800,random()*2000,
        random()/250,(random()-.5)*limit*2,(random()-.5)*limit*2,random(),12,9.5],i*15);
    }
    batch.execute(P.Wheels);const native=batch.buffers.wheelOutput;
    for(let i=0;i<4096;i++){
      solveWheelContact(out,...a.subarray(i*15,i*15+15));
      const expected=[out.force,out.sideForce,out.speed,out.slip,out.brake,out.targetForce,out.targetSide];
      expected.forEach((v,k)=>close(v,native[i*7+k],`wheel ${i}/${k}`,1e-7,1e-9));
    }
  } finally {r.dispose();}
});
test('batched Disney hinge geometry matches the exact TypeScript gradient',options,async()=>{
  const r=await runtime(),b=r.createBatch({nodeCount:1024,hingeCount:256}),v=b.buffers,random=rng(32);
  try {
    for(let i=0;i<256;i++){
      v.positions.set([-.5,0,0,.5,0,0,.1,.4+random(),(random()-.5)*2,-.1,-.4-random(),(random()-.5)*2],i*12);
      v.hinges.set([i*4,i*4+1,i*4+2,i*4+3],i*4);
    }
    v.positions.fill(0,255*12);b.execute(P.Hinges);const g=new Float64Array(12);
    for(let i=0;i<256;i++){
      const angle=dihedralGeometry(v.positions,...v.hinges.subarray(i*4,i*4+4),g);
      if(angle===undefined){assert.ok(Number.isNaN(v.angles[i]));assert.deepEqual([...v.gradients.subarray(i*12,i*12+12)],Array(12).fill(0));}
      else {close(angle,v.angles[i],`angle ${i}`);g.forEach((x,k)=>close(x,v.gradients[i*12+k],`gradient ${i}/${k}`));}
    }
  } finally {r.dispose();}
});
test('actual M3 cage skin and panel displacement agree with existing implementations',options,async()=>{
  const blueprint=m3StructuralBlueprint(1700,material('steel').mechanical),s=blueprint.skin;
  const r=await runtime(),b=r.createBatch({nodeCount:blueprint.definition.nodes.length,vertexCount:s.vertexCount,influences:s.influences,dentCount:1});
  try {
    const v=b.buffers;v.nodeRest.set(blueprint.definition.nodes.flatMap(n=>n.position));
    v.positions.set(v.nodeRest);for(let i=0;i<v.positions.length;i++)v.positions[i]+=.03*Math.sin(i*1.7);
    v.skinRest.set(s.rest);v.skinNodes.set(s.nodes);v.skinWeights.set(s.weights);
    const expected=new Float64Array(s.rest.length);applyStructuralSkin(s,v.nodeRest,v.positions,expected);
    b.execute(P.Skin);expected.forEach((x,i)=>close(x,v.skinPositions[i],`M3 vertex ${i}`));
    const panel=new ElasticPlasticPanelResponse(),point=[1.2,.95,-.72],normal=[0,1,0];
    panel.impact({point,normal,energyJ:180,radiusM:.24,thicknessM:.00075,material:'steel'});
    const dented=new Float64Array(expected.length);panel.deform(expected,dented);
    v.dents.set([...point,...normal,.24,-panel.maxElasticDepthM-panel.maxPermanentDepthM,1]);
    b.execute(P.Skin|P.Dents);dented.forEach((x,i)=>close(x,v.skinPositions[i],`M3 panel ${i}`,2e-9,1e-9));
    const first=new Float64Array(v.skinPositions);b.execute(P.Skin|P.Dents);
    assert.deepEqual(v.skinPositions,first,'projection reads must not accumulate damage');
  } finally {r.dispose();}
});
test('skin, dent, normals and GPU staging compose in a single native call',options,async()=>{
  const r=await runtime(),b=r.createBatch({nodeCount:1,vertexCount:3,influences:1,triangleCount:1,dentCount:1});
  try {
    const v=b.buffers;v.skinRest.set([0,0,0,1,0,0,0,0,1]);v.skinWeights.fill(1);v.triangles.set([0,2,1]);
    v.dents.set([0,0,0,0,1,0,.4,.1,0]);b.execute(P.Skin|P.Dents|P.Normals|P.Pack);
    close(-.1,v.skinPositions[1],'inward dent');
    for(let i=0;i<3;i++){
      close(1,Math.hypot(...v.normals.subarray(i*3,i*3+3)),'unit normal');
      for(let k=0;k<3;k++){assert.equal(v.packed[i*6+k],Math.fround(v.skinPositions[i*3+k]));assert.equal(v.packed[i*6+3+k],Math.fround(v.normals[i*3+k]));}
    }
  } finally {r.dispose();}
});
test('invalid input rejection is transactional across the complete batch',options,async()=>{
  const r=await runtime(),b=r.createBatch({wheelCount:2,nodeCount:4,hingeCount:1});
  try {
    const v=b.buffers;v.wheelOutput.fill(123);v.angles[0]=99;
    const wheel=[1/120,.33,1,20,5,0,4000,200,0,.001,0,0,.5,12,9.5];v.wheelInput.set(wheel);v.wheelInput.set(wheel,15);
    v.hinges.set([0,1,2,0xffffffff]);assert.throws(()=>b.execute(P.Wheels|P.Hinges),/input buffer/);
    assert.ok(v.wheelOutput.every(x=>x===123));assert.equal(v.angles[0],99);
    v.hinges.set([0,1,2,3]);v.wheelInput[20]=NaN;assert.throws(()=>b.execute(P.Wheels),/input buffer/);
    assert.ok(v.wheelOutput.every(x=>x===123));
  } finally {r.dispose();}
});
test('native generations reject stale handles; memory growth refreshes live views',options,()=>{
  const instance=new WebAssembly.Instance(program,{}),e=instance.exports,r=new RustKernelRuntime(e);
  try {
    const old=e.rom4_create(0,0,0,0,0,0,0);assert.equal(e.rom4_free(old),1);
    const next=e.rom4_create(0,0,0,0,0,0,0);assert.notEqual(old,next);
    assert.equal(e.rom4_execute(old,0),0);assert.equal(e.rom4_last_error(),1);assert.equal(e.rom4_free(next),1);
    const b=r.createBatch({wheelCount:1}),v=b.buffers;v.wheelInput[0]=.01;e.memory.grow(1);
    assert.equal(v.wheelInput.byteLength,0);assert.equal(b.buffers.wheelInput[0],.01);
  } finally {r.dispose();}
  assert.equal(e.rom4_live_handles(),0);assert.equal(e.rom4_live_bytes(),0);
});
test('budget overflow fails without leaking a handle and freed capacity is reusable',options,async()=>{
  const r=await runtime();try {
    assert.throws(()=>r.createBatch({nodeCount:1,vertexCount:1_000_000,influences:8}),/capacity/);
    assert.equal(r.stats.liveHandles,0);
    for(let i=0;i<200;i++){const b=r.createBatch({wheelCount:64});b.dispose();}
    assert.equal(r.stats.liveHandles,0);assert.equal(r.stats.liveBytes,0);
  } finally {r.dispose();}
});
