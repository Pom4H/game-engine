import test from 'node:test';
import assert from 'node:assert/strict';
import {SolidBody,SolidWorld,Qaxis,Qrotate} from '../dist/physics/compound.js';

const chart=[];for(const y of [-.2,.2])for(const z of [-1,0,1])for(const x of [-1,0,1])chart.push([x,y,z]);
const surface=[[-.8,0,-.7],[.6,0,-.8],[.1,0,.7]],affine=p=>[1.2*p[0]+.13*p[1]+.1*p[2],1.1*p[1],-.07*p[0]+.9*p[2]];
function stencil(p){const x=p[0]>=0?1:0,z=p[2]>=0?1:0,u=p[0]-[-1,0,1][x],v=p[2]-[-1,0,1][z],nodes=[],weights=[];for(let k=0;k<2;k++)for(let j=0;j<2;j++)for(let i=0;i<2;i++){nodes.push(k*9+(z+j)*3+x+i);weights.push((i?u:1-u)*(j?v:1-v)*.5);}return Object.freeze({nodes:Object.freeze(nodes),weights:Object.freeze(weights)});}
const bindings=()=>Object.freeze(surface.map(stencil));
const near=(a,b,tol=1e-11)=>assert.ok(Math.abs(a-b)<=tol,`${a} vs ${b}`);
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];

test('fine triangle contacts retain their complete affine material map, point velocity, effective mass and actual impulse moment',()=>{
 const q=Qaxis([.3,.2,.5],.7),world=new SolidWorld({gravity:[0,0,0]}),body=world.add(new SolidBody({p:[2,1,3],q,mass:18,half:[2,.3,2],friction:0,restitution:0,shapes:[{half:[2,.3,2],triangle:surface.map(affine),structureBindings:bindings(),geometryNodes:[100,101,102],thickness:.0008}]})),points=chart.map(p=>body.point(affine(p))),captured=[];
 body.deformable={active:false,bindMaterialContact:(point,nodes,weights)=>captured.push({point:[...point],nodes:[...nodes],weights:[...weights]})};world.addPlane({p:body.point([0,-.0003,0]),n:Qrotate(q,[0,1,0]),u:Qrotate(q,[1,0,0]),v:Qrotate(q,[0,0,1]),hu:5,hv:5});world.step(1/120);assert.ok(world.contacts.length>0);assert.ok(captured.length>0);
 for(const c of world.contacts){const map=c.materialA;assert.ok(map);assert.ok(map.nodes.length>3);assert.deepEqual(map.geometryNodes,[100,101,102]);near(map.weights.reduce((s,w)=>s+w,0),1);const p=[0,0,0];for(let i=0;i<map.nodes.length;i++)for(let k=0;k<3;k++)p[k]+=map.weights[i]*points[map.nodes[i]][k];const residual=p.map((v,k)=>v-c.p[k]),n=c.n;assert.ok(Math.hypot(...cross(residual,n))<1e-10,'material point may differ only by normal sheet thickness');
  const J=[3,-2,5],P=[0,0,0],L=[0,0,0],velocity=[0,0,0];let inverse=0,K=0;const field=x=>[.3+.2*x[0],-.1+.4*x[1],.2-.3*x[2]];for(let i=0;i<map.nodes.length;i++){const w=map.weights[i],point=points[map.nodes[i]],j=J.map(v=>v*w),l=cross(point,j),v=field(point);inverse+=w*w;for(let k=0;k<3;k++){P[k]+=j[k];L[k]+=l[k];velocity[k]+=w*v[k];K+=.5*j[k]*j[k];}}const expectedL=cross(p,J);for(let k=0;k<3;k++){near(P[k],J[k]);near(L[k],expectedL[k]);near(velocity[k],field(p)[k]);}near(K,.5*J.reduce((s,v)=>s+v*v,0)*inverse);assert.ok(inverse>0);
 }
});

test('cold affine mappings and independent weld identities invalidate query metadata without rebuilding an unchanged mapping',()=>{
 const world=new SolidWorld(),shape={half:[2,.3,2],triangle:surface.map(affine),structureBindings:bindings(),geometryNodes:[100,101,102],thickness:.0008},body=new SolidBody({shapes:[shape]});const first=world.rayBoxes(body);assert.equal(world.rayBoxes(body),first);const saved=first[0].structureBindings;assert.ok(Object.isFrozen(saved));assert.ok(saved.every(s=>Object.isFrozen(s)&&Object.isFrozen(s.nodes)&&Object.isFrozen(s.weights)));
 shape.triangle[0][0]+=.01;const moved=world.rayBoxes(body);assert.notEqual(moved,first);assert.equal(moved[0].structureBindings,saved);shape.geometryNodes=[200,201,202];const welded=world.rayBoxes(body);assert.notEqual(welded,moved);assert.deepEqual(welded[0].geometryNodes,[200,201,202]);shape.structureBindings=bindings();const remapped=world.rayBoxes(body);assert.notEqual(remapped,welded);assert.notEqual(remapped[0].structureBindings,saved);
 shape.structureBindings=[{nodes:[0],weights:[NaN]},{nodes:[1],weights:[1]},{nodes:[2],weights:[1]}];assert.throws(()=>body.boxes(),/Invalid material surface vertex stencil/);
});
