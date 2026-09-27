import test from 'node:test';
import assert from 'node:assert/strict';
import {projection,vector,vector3,scalar,Replica,Publication} from '../dist/network/index.js';
import {StructuralBody} from '../dist/physics/structure.js';
import {StructuralStaticContactSolver} from '../dist/physics/structural-contact.js';
import {bindStructuralSkin,applyStructuralSkin} from '../dist/physics/structural-skin.js';
import {material} from '../dist/materials/catalog.js';

const stamp=(tick,sequence=tick)=>({epoch:1,sequence,tick,time:tick/120,paused:false});
const row=(data,generation=0)=>({id:'ball',generation,data});

// Coarse elastic cage for a network/contact regression, not a pneumatic football model.
function fixture(){
 const positions=[[.5,0,0],[-.5,0,0],[0,.5,0],[0,-.5,0],[0,0,.5],[0,0,-.5],[0,0,0]];
 const triangles=[];
 for(const x of [0,1])for(const y of [2,3])for(const z of [4,5])triangles.push([x,y,z]);
 const edges=new Set(),constraints=[];
 for(const triangle of triangles)for(let k=0;k<3;k++){
  const pair=[triangle[k],triangle[(k+1)%3]].sort((a,b)=>a-b),key=pair.join(':');
  if(!edges.has(key)){edges.add(key);constraints.push({kind:'distance',a:pair[0],b:pair[1],areaM2:1e-4,material:material('rubber').mechanical});}
 }
 for(const [a,b,c] of triangles)constraints.push({kind:'volume',a,b,c,d:6,compliance:1e-5,yieldRatio:1,breakRatio:2,plasticity:0});
 const body=new StructuralBody({nodes:positions.map(position=>({position,mass:1/7})),constraints,collisionTriangles:triangles,iterations:8,internalDamping:8});
 const contacts=new StructuralStaticContactSolver([{center:[1.5,0,0],half:[.15,2,2]}],triangles);
 body.activateFromRigid(body.centerOfMass(),[5,0,0],[0,0,0]);
 const rest=body.originalPosition.slice();
 // The skin also has vertices that are not physics nodes.
 const mesh=[...rest,...triangles.flatMap(ids=>[0,1,2].map(axis=>ids.reduce((s,id)=>s+positions[id][axis]/3,0)))];
 return {body,rest,binding:bindStructuralSkin(mesh,rest),contacts};
}

test('fixed vectors capture typed arrays without exposing solver state or aliasing live buffers',()=>{
 const schema=projection('cage/v1',{nodes:vector(195),temperature:scalar('linear',0,2000)});
 const nodes=Float64Array.from({length:195},(_,i)=>i/100),frame=schema.capture(stamp(0),[row({nodes,temperature:300,force:'PRIVATE FORCE',solver:'NOT ON WIRE'})]);
 const text=schema.encode(frame);nodes.fill(999);
 assert.equal(schema.decode(text).rows[0].values[194],1.94);
 assert.ok(!text.includes('PRIVATE FORCE'));assert.ok(!text.includes('NOT ON WIRE'));
 assert.equal(frame.rows[0].values.length,196);assert.ok(Object.isFrozen(frame.rows[0].values));
});

test('buffer validation rejects malformed components, wrong topology dimensions and excessive width',()=>{
 const schema=projection('nodes/v1',{nodes:vector(6)});
 for(const nodes of [[1,2],new Float64Array([0,0,0,0,0,Infinity]),[0,0,0,0,0,'1'],new BigInt64Array(6),new DataView(new ArrayBuffer(48)),null])
  assert.throws(()=>schema.capture(stamp(0),[row({nodes})]));
 for(const n of [0,1,-1,2.5,Infinity,8193])assert.throws(()=>vector(n));
 assert.throws(()=>projection('too-wide',{a:vector(8192),b:scalar()}));
 assert.equal(schema.capture(stamp(0),[row({nodes:new Float32Array(6)})]).rows[0].values.length,6);
 assert.equal(schema.capture(stamp(0),[row({nodes:new Uint8Array(6)})]).rows[0].values.length,6);
});

test('numeric payload is bounded before capture/read copies large arrays',()=>{
 const schema=projection('bounded',{nodes:vector(24)},{maxBytes:256}),data={nodes:new Float64Array(24)};
 const frame=schema.capture(stamp(0),[row(data)]);
 assert.throws(()=>schema.capture(stamp(1),[row(data),{id:'other',data}]));
 const oversized=structuredClone(frame);oversized.rows.push({...oversized.rows[0],id:'other'});
 assert.throws(()=>schema.read(oversized));
 const impossible=projection('bounded',{nodes:vector(40)},{maxBytes:256});
 assert.throws(()=>impossible.capture(stamp(0),[row({nodes:new Float64Array(40)})]));
});

test('array channels use the existing angle/step interpolation rules',()=>{
 const schema=projection('channels',{spin:vector(2,'angle'),broken:vector(2,'step',0,1)}),replica=new Replica(schema,1);
 replica.receive(schema.capture(stamp(0),[row({spin:[3,-3],broken:[0,0]})]),0);
 replica.receive(schema.capture(stamp(120),[row({spin:[-3,3],broken:[1,0]})]),1);
 const values=replica.at(.5).rows[0].values;
 assert.ok(Math.abs(values[0]-Math.PI)<1e-12);assert.ok(Math.abs(values[1]+Math.PI)<1e-12);
 assert.deepEqual([...values.slice(2)],[0,0]);assert.equal(replica.at(1).rows[0].values[2],1);
});

test('invalid final node is atomic; topology generations never blend or rewrite prior frames',()=>{
 const schema=projection('topology-a/v1',{position:vector3(),nodes:vector(6)}),replica=new Replica(schema,1);
 const first=schema.capture(stamp(0),[row({position:[0,0,0],nodes:[0,0,0,1,0,0]})]);replica.receive(first,0);
 const next=schema.capture(stamp(120),[row({position:[10,0,0],nodes:[10,0,0,11,0,0]},1)]);
 const bad=structuredClone(next);bad.rows[0].values[8]=NaN;
 assert.throws(()=>replica.receive(bad,1));assert.equal(replica.latest().tick,0);
 replica.receive(next,1);assert.deepEqual([...replica.at(.5).rows[0].values],first.rows[0].values);
 assert.deepEqual([...replica.at(1).rows[0].values],next.rows[0].values);
 const incompatible=projection('topology-b/v1',{position:vector3(),nodes:vector(6)}).capture(stamp(240),[row({position:[0,0,0],nodes:new Float64Array(6)})]);
 assert.throws(()=>replica.receive(incompatible,2));assert.equal(replica.latest().tick,120);
});

test('one real structural authority feeds two passive skins through encoded frames and replay',t=>{
 const {body,rest,binding,contacts}=fixture(),schema=projection('octa-cage/world-space/v1',{center:vector3(),nodes:vector(rest.length)});
 const frames=[],wire=[];
 for(let tick=0;tick<=120;tick++){
  if(tick)body.step(1/120,[0,0,0],b=>contacts.project(b));
  if(tick%4)continue;
  const f=schema.capture(stamp(tick),[row({center:body.centerOfMass(),nodes:body.position,force:body.force})]);
  frames.push(f);const publication=new Publication(schema,f);wire.push(publication.text());assert.equal(publication.text(),wire.at(-1));
 }
 assert.ok(body.steps>0&&body.steps<=120);assert.equal(body.mode,'dormant');assert.ok(contacts.stats.contacts>0);
 // Check deformation, not merely a translating rigid mesh.
 const initialSpan=Math.hypot(...[0,1,2].map(axis=>rest[axis]-rest[3+axis]));
 const maxFlex=Math.max(...frames.map(f=>Math.abs(Math.hypot(...[0,1,2].map(axis=>f.rows[0].values[3+axis]-f.rows[0].values[6+axis]))-initialSpan)));
 assert.ok(maxFlex>.001,{maxFlex});
 const clients=[new Replica(schema,1),new Replica(schema,1)];
 for(const [clientIndex,client] of clients.entries())for(let i=0;i<wire.length;i++){
  client.receive(schema.decode(wire[i]),i/30+clientIndex*.037+(i%3)*.003);
  if(i>1&&i%3===0)assert.equal(client.receive(schema.decode(wire[i-2]),i/30+.05),false);
 }
 const outputs=clients.map(()=>new Float64Array(binding.vertexCount*3)),reference=new Float64Array(outputs[0].length);
 const nodesAtSample=new Float64Array(rest.length),steps=body.steps,live=body.position.slice();
 for(let sample=0;sample<=240;sample++){
  const time=sample/240,lo=Math.min(frames.length-1,Math.floor(time*30+1e-10)),hi=Math.min(frames.length-1,lo+1),alpha=hi===lo?0:(time-frames[lo].time)/(frames[hi].time-frames[lo].time);
  for(let k=0;k<nodesAtSample.length;k++){const a=frames[lo].rows[0].values[3+k],b=frames[hi].rows[0].values[3+k];nodesAtSample[k]=a+(b-a)*alpha;}
  applyStructuralSkin(binding,rest,nodesAtSample,reference);
  for(const [index,client] of clients.entries()){
   const state=client.at(time).rows[0].values;
   for(let axis=0;axis<3;axis++)assert.ok(Math.abs(state[axis]-Array.from({length:rest.length/3},(_,i)=>state[3+i*3+axis]/(rest.length/3)).reduce((a,b)=>a+b,0))<1e-9);
   applyStructuralSkin(binding,rest,state.subarray(3),outputs[index]);
   for(let k=0;k<reference.length;k++)assert.ok(Math.abs(outputs[index][k]-reference[k])<1e-9);
  }
  assert.deepEqual(outputs[0],outputs[1]);
 }
 const atImpact=clients[0].at(.25).rows[0].values.slice();clients[0].at(1);assert.deepEqual(clients[0].at(.25).rows[0].values,atImpact);
 assert.equal(body.steps,steps);assert.deepEqual(body.position,live);
 assert.equal(schema.stats.encodes,frames.length);assert.equal(clients[0].stats.allocations,1);assert.equal(clients[1].stats.allocations,1);
 t.diagnostic(JSON.stringify({authorityTicks:120,physicalSteps:body.steps,nodes:body.nodeCount,skinVertices:binding.vertexCount,publications:frames.length,renderSamplesPerClient:241,maxFlexMeters:maxFlex,contacts:contacts.stats.contacts}));
});
