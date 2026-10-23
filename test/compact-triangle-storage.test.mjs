import test from 'node:test';
import assert from 'node:assert/strict';
import {compactTriangleMesh,isOwnedValidatedTriangleMesh,ownedTriangleMeshBounds,primitiveKey,primitiveMesh,freezePrimitive,immutablePrimitive,meshVertexAttributes} from '../dist/procedural/mesh.js';
import {compactTriangleMesh as publicFactory} from '../dist/index.js';
import {Scene} from '../dist/scene/scene.js';
import {buildRenderFrame} from '../dist/render/frame.js';
import {buildSceneRadianceProbe} from '../dist/render/radiance.js';
import * as legacy from './fixtures/mesh-before-compact.mjs';

const triangle=()=>({positions:[-0,0,0,.123456789123,0,1,1,0,1],normals:[-0,1,0,0,1,0,0,1,0],indices:[-0,1,2],colors:[0,.499999999,1,1,1,0,.3,1,1,1,1,1],uvs:[-0,.123456789123,1,0,1,1],variationSeeds:[-0,1.23456789123,3]});
const channels=['positions','normals','indices','colors','uvs','variationSeeds'];
const byteView=value=>new Uint8Array(value.buffer,value.byteOffset,value.byteLength);
function exactPacked(a,b){
 for(const channel of ['vertices','colors','indices','uvs','variationSeeds']){assert.equal(!!a[channel],!!b[channel],channel);if(a[channel])assert.deepEqual(byteView(a[channel]),byteView(b[channel]),channel);}
 assert.equal(a.indexFormat,b.indexFormat);assert.deepEqual(meshVertexAttributes(a),meshVertexAttributes(b));
}

test('explicit compact factory owns exact doubles and exposes stable frozen dense public copies',()=>{
 assert.equal(publicFactory,compactTriangleMesh);
 const source=triangle(),expected=structuredClone(source),mesh=compactTriangleMesh(source);
 assert.equal(Object.isFrozen(source),false);assert.equal(Object.isFrozen(source.positions),false);assert.equal(Object.isFrozen(mesh),true);assert.equal(isOwnedValidatedTriangleMesh(mesh),true);
 assert.equal(immutablePrimitive(mesh),mesh);assert.equal(freezePrimitive(mesh,true),mesh);
 for(const field of channels){const descriptor=Object.getOwnPropertyDescriptor(mesh,field);assert.equal(typeof descriptor.get,'function');assert.equal(descriptor.enumerable,true);assert.equal(descriptor.configurable,false);}
 source.positions.fill(99);source.normals.fill(0);source.indices.fill(0);source.colors.fill(1);source.uvs.fill(9);source.variationSeeds.fill(2);
 for(const field of channels){const values=mesh[field];assert.deepEqual(values,expected[field]);assert.equal(values,mesh[field]);assert.equal(Array.isArray(values),true);assert.equal(Object.isFrozen(values),true);assert.equal(Object.keys(values).length,values.length);assert.throws(()=>values[0]=123,TypeError);}
 assert.equal(Object.is(mesh.positions[0],-0),true);assert.equal(Object.is(mesh.indices[0],-0),true);assert.equal(Object.is(mesh.uvs[0],-0),true);
 const input=triangle();input.positions=Float64Array.from(input.positions);const owned=compactTriangleMesh(input);structuredClone(input.positions,{transfer:[input.positions.buffer]});assert.equal(input.positions.byteLength,0);assert.deepEqual(owned.positions,expected.positions);
});

test('factory snapshots indexed getters once, validates before coercion and consumes no key on invalid input',()=>{
 const expected=triangle(),events=[],input={};
 for(const field of channels)Object.defineProperty(input,field,{get(){events.push(field);return new Proxy(expected[field],{get(target,key,receiver){if(key===Symbol.iterator)throw Error('factory must not use input iterators');if(typeof key==='string')events.push(field+'.'+key);return Reflect.get(target,key,receiver);}});}});
 const mesh=compactTriangleMesh(input);for(const field of channels)assert.deepEqual(mesh[field],expected[field]);
 for(const field of channels){assert.equal(events.filter(value=>value===field).length,1);assert.equal(events.filter(value=>value===field+'.length').length,1);for(let i=0;i<expected[field].length;i++)assert.equal(events.filter(value=>value===field+'.'+i).length,1);}
 const invalid=[p=>delete p.positions[0],p=>p.positions[0]=NaN,p=>p.normals[0]='0',p=>p.indices[0]=-1,p=>p.indices[0]=.5,p=>p.indices[0]=3,p=>p.colors[0]=1.01,p=>delete p.colors[1],p=>p.uvs=[0],p=>p.variationSeeds[0]=1e100,p=>p.positions={length:900003},p=>p.indices={length:1800003}];
 for(const mutate of invalid){const marker=freezePrimitive({kind:'box'},true),next=Number(primitiveKey(marker).split(':')[1])+1,p=triangle();mutate(p);assert.throws(()=>compactTriangleMesh(p),TypeError);assert.equal(primitiveKey(freezePrimitive({kind:'box'},true)),'dynamic:'+next);}
 const before=freezePrimitive({kind:'box'},true),a=compactTriangleMesh(triangle()),b=freezePrimitive({kind:'box'},true),n=Number(primitiveKey(before).split(':')[1]);assert.equal(primitiveKey(a),'dynamic:'+(n+1));assert.equal(primitiveKey(b),'dynamic:'+(n+2));
});

test('fully validated identity cannot be forged by public freeze, a Proxy, a prototype or serialized metadata',()=>{
 const source=triangle(),mesh=compactTriangleMesh(source),invalid=freezePrimitive({kind:'triangle-mesh',positions:[0,0,0],normals:[],indices:[0]},true);
 assert.equal(isOwnedValidatedTriangleMesh(invalid),false);assert.equal(isOwnedValidatedTriangleMesh(new Proxy(mesh,{})),false);assert.equal(isOwnedValidatedTriangleMesh(Object.create(mesh)),false);
 const scene=new Scene({version:1,entities:[]});assert.throws(()=>scene.add({id:'invalid',mesh:invalid,renderOnly:true}));
 assert.throws(()=>scene.add({id:'forged',mesh:{kind:'triangle-mesh',ownedValidated:true,positions:[0,0,0],normals:[],indices:[0]},renderOnly:true}));
 scene.add({id:'valid',mesh,renderOnly:true});assert.equal(scene.entities.get('valid').mesh,mesh);assert.equal(scene.physics.bodies.size,0);assert.equal(scene.tick,0);
 assert.equal(buildRenderFrame(scene).objects[0].primitive,mesh);exactPacked(primitiveMesh(mesh),legacy.primitiveMesh({kind:'triangle-mesh',...source}));
 const clone=structuredClone(mesh);assert.equal(isOwnedValidatedTriangleMesh(clone),false);exactPacked(primitiveMesh(clone),primitiveMesh(mesh));
 const authored=new Scene({version:1,entities:[{id:'authored',mesh,renderOnly:true}]});assert.equal(isOwnedValidatedTriangleMesh(authored.entities.get('authored').mesh),false);exactPacked(primitiveMesh(authored.entities.get('authored').mesh),primitiveMesh(mesh));
});

test('packing returns fresh independently mutable arrays, exact color rounding and original index widths',()=>{
 const source=triangle(),mesh=compactTriangleMesh(source),expected=legacy.primitiveMesh({kind:'triangle-mesh',...source}),first=primitiveMesh(mesh),second=primitiveMesh(mesh);exactPacked(first,expected);
 for(const channel of ['vertices','colors','indices','uvs','variationSeeds']){assert.notEqual(first[channel],second[channel]);assert.notEqual(first[channel].buffer,second[channel].buffer);first[channel].fill(0);}
 exactPacked(primitiveMesh(mesh),expected);
 for(const count of [65535,65536]){const input={positions:Array.from({length:count*3},(_,i)=>i%3===0?i*.00001:0),normals:Array.from({length:count*3},(_,i)=>i%3===1?1:0),indices:[0,count-2,count-1]},owned=compactTriangleMesh(input),packed=primitiveMesh(owned);exactPacked(packed,legacy.primitiveMesh({kind:'triangle-mesh',...input}));assert.equal(packed.indexFormat,count>65535?'uint32':'uint16');for(const field of ['colors','uvs','variationSeeds'])assert.equal(Object.hasOwn(owned,field),false);}
});

test('private buffers and dictionaries never escape through replaceable builtins, iterators or prototype getters',()=>{
 const saved={arrayFrom:Array.from,float32From:Float32Array.from,float64Iterator:Float64Array.prototype[Symbol.iterator],get:WeakMap.prototype.get,set:WeakMap.prototype.set,has:WeakMap.prototype.has},apply=Reflect.apply,escaped=[];let forged,packed,mesh;
 try{
  Array.from=function(...args){if(ArrayBuffer.isView(args[0]))escaped.push(args[0]);return apply(saved.arrayFrom,this,args);};
  Float32Array.from=function(...args){if(ArrayBuffer.isView(args[0]))escaped.push(args[0]);return apply(saved.float32From,this,args);};
  Float64Array.prototype[Symbol.iterator]=function(){escaped.push(this);return apply(saved.float64Iterator,this,[]);};
  WeakMap.prototype.get=function(key){const value=apply(saved.get,this,[key]);if(value&&typeof value==='object'&&ArrayBuffer.isView(value.positions))escaped.push(value);return value;};
  WeakMap.prototype.set=function(key,value){if(value&&typeof value==='object'&&ArrayBuffer.isView(value.positions))escaped.push(value);return apply(saved.set,this,[key,value]);};
  WeakMap.prototype.has=function(){return true;};
  for(const field of ['positions','colors','uvs','variationSeeds'])Object.defineProperty(Object.prototype,field,{configurable:true,get(){escaped.push(this);return undefined;}});
  const input=Object.assign(Object.create(null),{positions:[0,0,0,1,0,0,0,1,0],normals:[0,0,1,0,0,1,0,0,1],indices:[0,1,2],colors:undefined,uvs:undefined,variationSeeds:undefined});
  mesh=compactTriangleMesh(input);packed=primitiveMesh(mesh);for(const field of ['positions','normals','indices'])void mesh[field];ownedTriangleMeshBounds(mesh);forged=isOwnedValidatedTriangleMesh({kind:'triangle-mesh'});
 }finally{Array.from=saved.arrayFrom;Float32Array.from=saved.float32From;Float64Array.prototype[Symbol.iterator]=saved.float64Iterator;WeakMap.prototype.get=saved.get;WeakMap.prototype.set=saved.set;WeakMap.prototype.has=saved.has;for(const field of ['positions','colors','uvs','variationSeeds'])delete Object.prototype[field];}
 assert.equal(escaped.length,0);assert.equal(forged,false);assert.equal(packed.indices.length,3);assert.deepEqual(mesh.positions,[0,0,0,1,0,0,0,1,0]);
 const fresh=compactTriangleMesh(triangle());let numericSetterCalls=0,values;
 try{Object.defineProperty(Array.prototype,'0',{configurable:true,set(){numericSetterCalls++;},get(){return 999;}});values=fresh.positions;}finally{delete Array.prototype[0];}
 assert.equal(numericSetterCalls,0);assert.equal(Object.getOwnPropertyDescriptor(values,'0').value,-0);assert.equal(Object.isFrozen(values),true);
});

test('radiance uses original-double bounds while packed GPU positions retain their existing Float32 rounding',()=>{
 const source=triangle();source.positions=[1e12-1.125,-2e12+2.875,3e12-3.125,1e12+1.875,-2e12-1.5,3e12+.5,1e12+.125,-2e12+.75,3e12+2.875];
 const regular=freezePrimitive({kind:'triangle-mesh',...structuredClone(source)},true),compact=compactTriangleMesh(source),bounds=ownedTriangleMeshBounds(compact);
 assert.equal(Object.isFrozen(bounds),true);assert.throws(()=>bounds[0]=0,TypeError);assert.equal(ownedTriangleMeshBounds(regular),undefined);assert.ok(bounds[3]-bounds[0]>0);
 const packed=primitiveMesh(compact);assert.equal(packed.vertices[0],packed.vertices[6]);exactPacked(packed,legacy.primitiveMesh(regular));
 const a=new Scene({version:1,entities:[]}),b=new Scene({version:1,entities:[]});a.add({id:'mesh',mesh:regular,position:[-20,2,8],material:{color:[.2,.3,.4,1],roughness:.6},renderOnly:true});b.add({id:'mesh',mesh:compact,position:[-20,2,8],material:{color:[.2,.3,.4,1],roughness:.6},renderOnly:true});
 for(const scale of [[.3,2.7,.125],[-.3,2.7,.125],[1e-300,1e-300,1e-300],[1e300,1e300,1e300],[Infinity,1,1],[NaN,1,1],[0,0,0]]){a.entities.get('mesh').scale=[...scale];b.entities.get('mesh').scale=[...scale];assert.deepEqual(buildSceneRadianceProbe(b,[0,1,0]),buildSceneRadianceProbe(a,[0,1,0]));}
});

test('unbranded freeze and packing retain the frozen original getter, Proxy and custom iterator behavior',()=>{
 function traced(){const events=[],input=triangle(),mesh={kind:'triangle-mesh'};for(const field of channels)mesh[field]=new Proxy(input[field],{get(t,k,r){events.push(field+'.get:'+String(k));return Reflect.get(t,k,r);},ownKeys(t){events.push(field+'.keys');return Reflect.ownKeys(t);},getOwnPropertyDescriptor(t,k){events.push(field+'.descriptor:'+String(k));return Reflect.getOwnPropertyDescriptor(t,k);},preventExtensions(t){events.push(field+'.preventExtensions');return Reflect.preventExtensions(t);}});return{events,mesh};}
 const a=traced(),b=traced();legacy.freezePrimitive(a.mesh,true);freezePrimitive(b.mesh,true);assert.deepEqual(b.events,a.events);a.events.length=0;b.events.length=0;exactPacked(primitiveMesh(b.mesh),legacy.primitiveMesh(a.mesh));assert.deepEqual(b.events,a.events);
 function iterated(){const p={kind:'triangle-mesh',...triangle()},calls=[];for(const field of channels){const data=p[field];Object.defineProperty(data,Symbol.iterator,{value:function*(){calls.push(field);for(let i=0;i<this.length;i++)yield this[i];}});}return{p,calls};}
 const c=iterated(),d=iterated();exactPacked(primitiveMesh(d.p),legacy.primitiveMesh(c.p));assert.deepEqual(d.calls,c.calls);
});
