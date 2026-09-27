import test from 'node:test';
import assert from 'node:assert/strict';
import {projection,scalar,vector3,buffer,Replica,Publication,StructuralProjection,SceneReplicaView} from '../dist/network/index.js';
import {bindStructuralSkin,applyStructuralSkin} from '../dist/physics/structural-skin.js';
import {Scene} from '../dist/scene/scene.js';
import {runStructuralNetworkHarness} from '../tools/structural-network-harness.mjs';
const stamp=(tick,epoch=1,sequence=tick)=>({epoch,sequence,tick,time:tick/60,paused:false});
const rest=new Float64Array([-1,0,0,1,0,0]);
const net=(links=1)=>new StructuralProjection(`cage-${links}/v1`,rest,links);
const source=(x=0,links=1,id='ball',generation=0)=>({id,generation,position:[x,200+x,0],rotation:[0,x,0],scale:[1,1,1],nodes:rest.map((n,k)=>n+(k===1?x:0)),broken:new Uint8Array(links),secret:'PRIVATE',renderVertices:[99,88,77]});
const close=(a,b)=>{assert.equal(a.length,b.length);for(let i=0;i<a.length;i++)assert.ok(Math.abs(a[i]-b[i])<1e-10,`${i}: ${a[i]} != ${b[i]}`);};

test('fixed buffers share the existing codec; singleton buffer is not a scalar',()=>{
 const s=projection('buffer-test/v1',{one:buffer(1),pose:vector3(),flags:buffer(2,{sample:'step',integer:true,min:0,max:0xffffffff})});
 const frame=s.capture(stamp(0),[{id:'x',data:{one:new Float32Array([.5]),pose:[1,2,3],flags:new Uint32Array([0xffffffff,1])}}]);
 assert.deepEqual(s.decode(s.encode(frame)),frame);assert.equal(frame.rows[0].values[0],.5);
 assert.throws(()=>s.capture(stamp(1),[{id:'x',data:{one:.5,pose:[1,2,3],flags:[1,2]}}]));
 const old=projection('old/v1',{x:scalar(),p:vector3()});assert.equal(old.signature,JSON.stringify(['old/v1',[['x',1,'step',-1e12,1e12],['p',3,'linear',-1e12,1e12]]]));
});
test('fixed-buffer validation rejects holes, fractions in masks, bigint and wrong dimensions',()=>{
 const s=projection('x',{x:buffer(3,{sample:'step',integer:true})});
 for(const x of [[1,,2],[1,.1,2],[1,2],new BigInt64Array([1n,2n,3n]),new DataView(new ArrayBuffer(24)),[NaN,1,2]])assert.throws(()=>s.capture(stamp(0),[{id:'x',data:{x}}]));
 for(const width of [0,-1,1.2,NaN,Infinity,129])assert.throws(()=>projection('bad',{x:buffer(width)}));
 assert.throws(()=>projection('bad',{x:buffer(1,{integer:true})}));
 assert.throws(()=>projection('bad',{x:buffer(2)},{maxStride:32769}));
 assert.throws(()=>projection('bad',{x:buffer(128),y:scalar()}));
});
test('compact structural capture excludes mesh/private/solver state and copies borrowed buffers',()=>{
 const c=net(65),a=source(1,65),b=source(2,65,'second');a.broken[0]=a.broken[31]=a.broken[32]=a.broken[64]=1;
 const frame=c.capture(stamp(1),[a,b]),text=c.schema.encode(frame);
 assert.equal(c.schema.stride,18);assert.ok(!text.includes('PRIVATE'));assert.ok(!text.includes('renderVertices'));
 assert.deepEqual(frame.rows[0].values.slice(-3),[2147483649,1,1]);assert.deepEqual(frame.rows[1].values.slice(-3),[0,0,0]);
 a.nodes.fill(99);a.broken.fill(0);assert.equal(frame.rows[0].values[10],1);
 const r=new Replica(c.schema,1),view=c.bind('ball',1);r.receive(c.schema.decode(text),0);c.apply(r.at(1/60),view);
 assert.equal(view.nodes[1],1);assert.equal(view.broken[31],1);assert.equal(view.broken[64],1);
});
test('pose, interpolated nodes and discrete breakage use the same sampled time',()=>{
 const c=net(),r=new Replica(c.schema,1),a=source(0),b=source(2);b.broken[0]=1;
 r.receive(c.capture(stamp(0),[a]),0);r.receive(c.capture(stamp(60),[b]),1);
 const scene=new Scene({version:1,entities:[{id:'ball',mesh:{kind:'sphere',radius:1},collision:'none'}]}),pose=new SceneReplicaView(scene),shape=c.bind('ball',1);
 const sample=r.at(.5);pose.apply(sample);c.apply(sample,shape);
 assert.equal(scene.entities.get('ball').position[0],1);assert.equal(shape.nodes[1],1);assert.equal(shape.broken[0],0);
 c.apply(r.at(1),shape);assert.equal(shape.broken[0],1);assert.equal(shape.nodes[1],2);
 assert.equal(scene.physics.steps,0);assert.equal(scene.physics.bodies.size,0);pose.dispose();scene.dispose();
});
test('geometry at two render densities binds to the same replicated cage without a second solver',()=>{
 const c=net(),r=new Replica(c.schema,1),view=c.bind('ball',1),s=source(.3),low=bindStructuralSkin(rest,c.rest),densePoints=Float64Array.from({length:300},(_,i)=>i%3===0?-1+2*Math.floor(i/3)/99:0),high=bindStructuralSkin(densePoints,c.rest);
 r.receive(c.capture(stamp(0),[s]),0);c.apply(r.at(0),view);
 for(const binding of [low,high]){const remote=new Float64Array(binding.rest.length),local=new Float64Array(binding.rest.length);applyStructuralSkin(binding,c.rest,view.nodes,remote);applyStructuralSkin(binding,c.rest,s.nodes,local);close(remote,local);}
});
test('generation, epoch and roster changes never reuse another body template',()=>{
 const c=net(),r=new Replica(c.schema,1),view=c.bind('ball',1);r.receive(c.capture(stamp(0),[source(0)]),0);r.receive(c.capture(stamp(60),[source(9,1,'ball',1)]),1);
 c.apply(r.at(.5),view);assert.equal(view.nodes[1],0);assert.equal(c.apply(r.at(1),view),false);assert.equal(view.visible,false);
 const next=c.bind('ball',1,1);c.apply(r.at(1),next);assert.equal(next.nodes[1],9);
 r.receive(c.capture(stamp(120),[]),2);assert.equal(c.apply(r.at(2),next),false);
 r.reset(2);r.receive(c.capture(stamp(0,2),[source(0)]),3);assert.equal(c.apply(r.at(0),view),false);
 const changed=new StructuralProjection('new-template/v2',rest,1);assert.throws(()=>changed.schema.decode(c.schema.encode(c.capture(stamp(1),[source()]))));
});
test('bad final row is rejected atomically before accepted replica history changes',()=>{
 const c=net(),r=new Replica(c.schema,1);r.receive(c.capture(stamp(0),[source()]),0);
 for(const value of [NaN,.5,0x100000000,-1]){const bad=structuredClone(c.capture(stamp(1),[source(),source(0,1,'second')]));bad.rows[1].values[15]=value;assert.throws(()=>r.receive(bad,.1));assert.equal(r.latest().sequence,0);}
});
test('view validation does not partially overwrite nodes for corrupt masks or non-finite offsets',()=>{
 const c=net(),r=new Replica(c.schema,1),view=c.bind('ball',1);r.receive(c.capture(stamp(0),[source(1)]),0);const frame=structuredClone(r.at(0));
 frame.rows[0].values[15]=2;assert.throws(()=>c.apply(frame,view));assert.deepEqual(view.nodes,rest);assert.equal(view.visible,false);
 frame.rows[0].values[15]=0;frame.rows[0].values[10]=NaN;assert.throws(()=>c.apply(frame,view));assert.deepEqual(view.nodes,rest);
});
test('loss/reordering holds authoritative deformation; replay does not resimulate',()=>{
 const c=net(),r=new Replica(c.schema,1,4),view=c.bind('ball',1),nodes=view.nodes,bits=view.broken;
 for(let i=0;i<10;i++)r.receive(c.capture(stamp(i),[source(i/10)]),i/60);
 assert.equal(r.receive(c.capture(stamp(4),[source(100)]),1),false);
 c.apply(r.present(999),view);assert.equal(view.nodes[1],.9);
 c.apply(r.at(6/60),view);assert.ok(Math.abs(view.nodes[1]-.6)<1e-12);
 for(let i=0;i<100;i++)c.apply(r.at(.13),view);assert.equal(view.nodes,nodes);assert.equal(view.broken,bits);assert.equal(r.stats.allocations,1);assert.equal(r.latest().sequence,9);assert.equal(r.inspect().frames,4);
});
test('large structural cages opt into a bounded stride instead of arbitrary packet arrays',()=>{
 const c=new StructuralProjection('max/v1',new Float64Array(2048*3),16384,{maxEntities:1}),s=source();s.nodes=new Float64Array(6144);s.broken=new Uint8Array(16384);
 assert.equal(c.schema.stride,6665);assert.doesNotThrow(()=>c.capture(stamp(0),[s]));assert.throws(()=>c.capture(stamp(0),[s,{...s,id:'other'}]));
 assert.throws(()=>new StructuralProjection('bad',new Float64Array(6147),1));assert.throws(()=>new StructuralProjection('bad',rest,16385));assert.throws(()=>new StructuralProjection('bad',[0,0,0,'1',0,0],1));
 assert.throws(()=>c.capture(stamp(0),[{...s,nodes:[0,0,0]}]));
 const small=net();assert.throws(()=>small.capture(stamp(0),[{...source(),nodes:['1',0,0,1,0,0]}]));assert.throws(()=>small.capture(stamp(0),[{...source(),broken:[2]}]));
});
test('one structural publication reuses identical bytes across readers',()=>{
 const c=net(),p=new Publication(c.schema,c.capture(stamp(0),[source()]));const text=p.text();for(let i=0;i<16;i++)assert.equal(p.text(),text);assert.equal(c.schema.stats.encodes,1);
});
test('real structural solver -> loopback stream -> two independent replicas and skins',async()=>{
 const report=await runStructuralNetworkHarness();assert.equal(report.clients,2);assert.equal(report.framesPerClient,61);assert.equal(report.authoritySteps,240);assert.equal(report.encodes,61);assert.ok(report.maxNodeError<1e-10);assert.ok(report.maxSkinError<1e-10);assert.ok(report.maxEdgeStrain>1e-4);
});
