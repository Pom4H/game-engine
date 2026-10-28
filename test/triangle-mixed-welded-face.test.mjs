import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Qaxis,Qrotate} from '../dist/physics/compound.js';
import {trianglePrism,prismSAT,prismFeatureNormalAllowed} from '../dist/physics/triangle-prism.js';
const captures=JSON.parse(readFileSync(new URL('./fixtures/wall150-mixed-seam.json',import.meta.url),'utf8'));
const dot=(a,b)=>a.reduce((s,v,k)=>s+v*b[k],0);
function projection(shape,n){if(shape.triangle){const p=shape.triangle.vertices.map(v=>dot(v,n));return[Math.min(...p),Math.max(...p)];}const c=dot(shape.p,n),r=shape.axes.reduce((s,a,k)=>s+Math.abs(dot(a,n))*shape.half[k],0);return[c-r,c+r];}
function make(c,q,shift){const point=p=>Qrotate(q,p).map((v,k)=>v+shift[k]),prism=trianglePrism(c.face.triangle.map(point),c.face.thickness),neighbors=rows=>rows.map(row=>row.map(t=>trianglePrism(t.map(point),c.face.thickness)));return[{p:point(c.box.p),axes:c.box.axes.map(n=>Qrotate(q,n)),half:c.box.half},{p:prism.center,axes:[[1,0,0],[0,1,0],[0,0,1]],half:[1,1,1],triangle:prism,triangleAdjacency:{edges:neighbors(c.adjacency.edges),vertices:neighbors(c.adjacency.vertices)}}];}
test('actual 107/109 mixed box/shell captures retain the exposed box face at a welded support point',()=>{
 for(const c of captures)for(const q of [[0,0,0,1],Qaxis([.3,-.4,.7],1.17)])for(const shift of [[0,0,0],[20,-13,7]]){
  const [box,face]=make(c,q,shift),n=box.axes[1],A=projection(box,n),B=projection(face,n),overlap=Math.min(A[1]-B[0],B[1]-A[0]);
  assert.equal(prismFeatureNormalAllowed(face,n),false,'the neighbour legitimately hides this prism support; it does not hide the other body face');
  const actual=prismSAT(box,face,0),reverse=prismSAT(face,box,0);assert.ok(actual&&reverse);assert.ok(actual.depth<=overlap+2e-12,`a real box-face overlap ${overlap} cannot become the historical ${c.oldDepth} m far-axis ejection`);assert.ok(actual.depth>0);assert.ok(Math.abs(actual.depth-reverse.depth)<2e-12);assert.ok(Math.hypot(...actual.n.map((v,k)=>v+reverse.n[k]))<2e-11);
 }
});
