import test from 'node:test';
import assert from 'node:assert/strict';
import {materialAngle} from '../dist/physics/material-angle.js';
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],norm=v=>Math.hypot(...v);
test('curved material flange angle has exact parent-axis and both surface-pair gradients',()=>{
 const points=[[.7,.2,-.1],[-.5,-.1,.3],[.11,.08,.02],[.09,.02,-.01],[.14,.04,.08],[.10,.01,.01]],state=materialAngle(...points),gradients=[state.hinge,state.hinge.map(v=>-v),state.reference,state.reference.map(v=>-v),state.child,state.child.map(v=>-v)];
 for(let i=0;i<points.length;i++)for(let k=0;k<3;k++){const plus=points.map(p=>[...p]),minus=points.map(p=>[...p]),h=1e-7;plus[i][k]+=h;minus[i][k]-=h;const difference=materialAngle(...plus).angle-materialAngle(...minus).angle,numeric=Math.atan2(Math.sin(difference),Math.cos(difference))/(2*h);assert.ok(Math.abs(numeric-gradients[i][k])<2e-7,`${i}/${k}: ${numeric} versus ${gradients[i][k]}`);}
 const linear=[0,0,0],angular=[0,0,0];for(let i=0;i<points.length;i++){const torque=cross(points[i],gradients[i]);for(let k=0;k<3;k++){linear[k]+=gradients[i][k];angular[k]+=torque[k];}}
 assert.ok(norm(linear)<1e-12);assert.ok(norm(angular)<1e-12);assert.ok(norm(state.hinge)>1e-3);
});
test('degenerate material angle does not invent a hinge direction',()=>{
 assert.equal(materialAngle([0,0,0],[0,0,0],[0,1,0],[0,0,0],[0,0,1],[0,0,0]),undefined);
 assert.equal(materialAngle([1,0,0],[0,0,0],[0,0,0],[0,0,0],[0,0,1],[0,0,0]),undefined);
});
