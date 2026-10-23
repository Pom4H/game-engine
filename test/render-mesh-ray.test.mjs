import test from 'node:test';
import assert from 'node:assert/strict';
import {Scene} from '../dist/scene/scene.js';
import {RenderMeshQuery,avoidCameraObstacles} from '../dist/render/mesh-ray.js';
import {compose,V3} from '../dist/math.js';
import {readFileSync} from 'node:fs';

const scene=(entities)=>new Scene({version:1,ground:-100,entities:entities.map(e=>({...e,renderOnly:true}))});
const box=(id,p,size=[1,1,1])=>({id,position:p,mesh:{kind:'box',size}});
const close=(a,b,epsilon=1e-6)=>assert.ok(Math.abs(a-b)<epsilon,`${a} != ${b}`);

test('captured original wagon exit triangle reproduces the millimetre camera collapse and its clearance',()=>{
 const f=JSON.parse(readFileSync(new URL('./fixtures/office-exit-camera.json',import.meta.url),'utf8')),a=f.positions.slice(0,3),b=f.positions.slice(3,6),c=f.positions.slice(6,9),n=V3.normalize(V3.cross(V3.sub(b,a),V3.sub(c,a))),s=scene([{id:'captured-vehicle',mesh:{kind:'triangle-mesh',positions:f.positions,normals:[...n,...n,...n],indices:[0,1,2]}}]),q=new RenderMeshQuery(s);
 const old=avoidCameraObstacles(q,f.desired);assert.equal(old.distance,f.oldDistance);assert.equal(q.withinDistance(f.desired.target,Math.SQRT2*.18+.12),true);
 const ignored=avoidCameraObstacles(q,f.desired,{filter:e=>e.id!=='captured-vehicle'});close(ignored.distance,f.newDistance);assert.equal(q.withinDistance(V3.add(f.desired.target,[3,0,0]),Math.SQRT2*.18+.12),false);
});

test('mesh clearance measures triangle faces, edges and holes instead of their bounds',()=>{
 const triangle={kind:'triangle-mesh',positions:[0,0,0,2,0,0,0,2,0],normals:[0,0,1,0,0,1,0,0,1],indices:[0,1,2]},s=scene([{id:'surface',mesh:triangle}]),q=new RenderMeshQuery(s);
 assert.equal(q.withinDistance([.3,.3,.2],.199),false);assert.equal(q.withinDistance([.3,.3,.2],.201),true);
 assert.equal(q.withinDistance([1.8,1.8,0],.5),false);assert.equal(q.withinDistance([1.8,1.8,0],1.14),true);
 assert.equal(q.withinDistance([-.2,0,0],.19),false);assert.equal(q.withinDistance([-.2,0,0],.21),true);
 assert.equal(q.withinDistance([.3,.3,.2],1,e=>e.id!=='surface'),false);assert.equal(s.physics.bodies.size,0);assert.equal(s.tick,0);
});
test('mesh clearance follows nonuniform render poses, edits, visibility and zero-area triangles',()=>{
 const tri={kind:'triangle-mesh',positions:[0,0,0,1,0,0,0,1,0],normals:[0,0,1,0,0,1,0,0,1],indices:[0,1,2]},s=scene([{id:'tilted',mesh:tri,position:[3,4,5],rotation:[.2,.4,-.3],scale:[2,3,.7]}]),q=new RenderMeshQuery(s),e=s.entities.get('tilted'),m=compose(e.position,e.rotation,e.scale),point=[0,1,2].map(i=>m[12+i]+m[i]*.2+m[4+i]*.2),normal=V3.normalize(V3.cross([m[0],m[1],m[2]],[m[4],m[5],m[6]])),above=V3.add(point,V3.scale(normal,.3));
 assert.equal(q.withinDistance(above,.299),false);assert.equal(q.withinDistance(above,.301),true);
 e.position[0]+=20;assert.equal(q.withinDistance(above,.4),false);e.position[0]-=20;s.setRenderVisible(e.id,false);assert.equal(q.withinDistance(above,.4),false);s.setRenderVisible(e.id,true);assert.equal(q.withinDistance(above,.4),true);
 e.renderMesh={kind:'triangle-mesh',positions:[0,0,0,1,0,0,2,0,0],normals:[0,0,1,0,0,1,0,0,1],indices:[0,1,2]};const at=V3.add(e.position,V3.scale([m[0],m[1],m[2]],.5));assert.equal(q.withinDistance(at,.001),true);s.remove(e.id);assert.equal(q.withinDistance(at,100),false);
 for(const [p,d]of [[[NaN,0,0],1],[[0,0,0],-1],[[0,0,0],Infinity]])assert.throws(()=>q.withinDistance(p,d),RangeError);
});

test('visible mesh queries use render geometry, holes and both triangle sides without creating physics',()=>{
 const wall={kind:'triangle-mesh',positions:[-2,-2,3,-.5,-2,3,-2,2,3, .5,-2,3,2,-2,3,2,2,3],normals:Array.from({length:18},(_,i)=>i%3===2?1:0),indices:[0,1,2,3,4,5]};
 const s=scene([{...box('wall',[0,0,0],[10,10,1]),renderMesh:wall}]),q=new RenderMeshQuery(s);
 assert.equal(q.cast([0,0,0],[0,0,1],10),null);
 close(q.cast([-1.8,0,0],[0,0,1],10).distance,3);
 close(q.cast([-1.8,0,6],[0,0,-1],10).distance,3);
 assert.equal(s.physics.bodies.size,0);assert.equal(s.tick,0);assert.equal(s.time,0);
});

test('rotated nonuniform scales use the same render transform and retain world distances',()=>{
 const s=scene([{...box('tilted',[2,3,-4],[2,3,4]),rotation:[.27,.73,-.19],scale:[1.2,.8,1.7]}]),e=s.entities.get('tilted'),m=compose(e.position,e.rotation,[2.4,2.4,6.8]),normal=V3.normalize([m[8],m[9],m[10]]),face=V3.add(e.position,V3.scale(normal,3.4)),origin=V3.add(face,V3.scale(normal,7));
 const hit=new RenderMeshQuery(s).cast(origin,V3.scale(normal,-1),12);assert.equal(hit.entity,e);close(hit.distance,7,1e-5);hit.point.forEach((v,i)=>close(v,face[i],1e-5));
});

test('direct pose edits, render mesh replacement, hide and removal invalidate prior hits',()=>{
 const s=scene([box('moving',[0,0,4])]),q=new RenderMeshQuery(s),e=s.entities.get('moving');close(q.cast([0,0,0],[0,0,1],10).distance,3.5);
 e.position[2]=6;close(q.cast([0,0,0],[0,0,1],10).distance,5.5);e.renderMesh={kind:'box',size:[1,1,2]};close(q.cast([0,0,0],[0,0,1],10).distance,5);
 s.setRenderVisible('moving',false);assert.equal(q.cast([0,0,0],[0,0,1],10),null);s.setRenderVisible('moving',true);assert.ok(q.cast([0,0,0],[0,0,1],10));s.remove('moving');assert.equal(q.cast([0,0,0],[0,0,1],10),null);
});

test('camera stops before a wall, excludes the body and returns its authored distance when clear',()=>{
 const s=scene([box('actor',[0,1,0]),box('wall',[0,1,4],[10,6,.2])]),q=new RenderMeshQuery(s),camera={position:[0,1,8],target:[0,1,0],fov:39},filter=e=>e.id!=='actor';
 const r=avoidCameraObstacles(q,camera,{filter});assert.equal(r.hit.entity.id,'wall');close(r.distance,3.78);assert.equal(camera.position[2],8);assert.equal(r.camera.target,camera.target);
 s.remove('wall');const clear=avoidCameraObstacles(q,camera,{filter});assert.equal(clear.camera,camera);assert.equal(clear.hit,null);assert.equal(clear.distance,8);
});

test('near-plane corner rays catch an obstruction missed by the centre ray',()=>{
 const s=scene([box('edge',[.18,1.18,4],[.1,.1,.2])]),q=new RenderMeshQuery(s),camera={position:[0,1,8],target:[0,1,0]};
 assert.equal(q.cast(camera.target,[0,0,1],8),null);const r=avoidCameraObstacles(q,camera);assert.equal(r.hit.entity.id,'edge');close(r.distance,3.78);
});

test('nearest visible geometry and query bounds are honoured; invalid rays fail early',()=>{
 const s=scene([box('far',[0,0,8]),box('near',[0,0,3]),{...box('hidden',[0,0,1]),renderVisible:false}]),q=new RenderMeshQuery(s);
 assert.equal(q.cast([0,0,0],[0,0,1],10).entity.id,'near');assert.equal(q.cast([0,0,0],[0,0,1],2),null);assert.equal(q.cast([0,0,0],[0,0,1],10,e=>e.id!=='near').entity.id,'far');
 for(const args of [[[0,0,0],[0,0,2],10],[[NaN,0,0],[0,0,1],10],[[0,0,0],[0,0,1],-1]])assert.throws(()=>q.cast(...args),RangeError);
 assert.throws(()=>avoidCameraObstacles(q,{position:[0,0,8],target:[0,0,0]},{radius:-1}),RangeError);
});
