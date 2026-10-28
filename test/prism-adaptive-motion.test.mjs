import test from 'node:test';
import assert from 'node:assert/strict';
import {SolidBody,SolidWorld,Qaxis,Qrotate,Qmul} from '../dist/physics/compound.js';
import {triangleAdaptiveFeatures,triangleAdaptiveMotion} from '../dist/physics/prism-adaptive-motion.js';
const dot=(a,b)=>a.reduce((s,n,k)=>s+n*b[k],0),sub=(a,b)=>a.map((n,k)=>n-b[k]);
function sheet(divisions=1,{q=[0,0,0,1],baked=false,hole=false,reverse=false}={}){
 const coordinates=hole?[-.5,-.45,.45,.5]:Array.from({length:divisions+1},(_,i)=>-.5+i/divisions),points=[],indices=new Map(),shapes=[];
 const vertex=(x,y)=>{const key=x+':'+y;let i=indices.get(key);if(i===undefined){i=points.length;indices.set(key,i);points.push(baked?Qrotate(q,[x,y,0]):[x,y,0]);}return i;};
 for(let j=0;j<coordinates.length-1;j++)for(let i=0;i<coordinates.length-1;i++){if(hole&&i===1&&j===1)continue;const x0=coordinates[i],x1=coordinates[i+1],y0=coordinates[j],y1=coordinates[j+1];for(let row=0;row<(hole?divisions:1);row++)for(let col=0;col<(hole?divisions:1);col++){const a=vertex(x0+(x1-x0)*col/divisions*(hole?1:divisions),y0+(y1-y0)*row/divisions*(hole?1:divisions)),b=vertex(x0+(x1-x0)*(col+1)/(hole?divisions:1),y0+(y1-y0)*row/(hole?divisions:1)),c=vertex(x0+(x1-x0)*(col+1)/(hole?divisions:1),y0+(y1-y0)*(row+1)/(hole?divisions:1)),d=vertex(x0+(x1-x0)*col/(hole?divisions:1),y0+(y1-y0)*(row+1)/(hole?divisions:1));for(const ids of reverse?[[a,b,d],[b,c,d]]:[[a,b,c],[a,c,d]]){const triangle=ids.map(i=>points[i].slice()),min=[0,1,2].map(k=>Math.min(...triangle.map(p=>p[k]))),max=[0,1,2].map(k=>Math.max(...triangle.map(p=>p[k])));shapes.push({triangle,geometryNodes:ids,thickness:.0008,offset:min.map((n,k)=>(n+max[k])/2),half:min.map((n,k)=>(max[k]-n)/2+.0004)});}}}
 return new SolidBody({p:[3,8,-4],q:baked?[0,0,0,1]:q,half:[.5,.5,.5],mass:1,shapes});
}
function advance(body,velocity,dt=1/120){const world=new SolidWorld({gravity:[0,0,0]});world.add(body);body.v=velocity;world.step(dt);return{steps:world.metrics.substeps,world,body};}
test('a welded planar source has one physical boundary under subdivision and either diagonal',()=>{
 for(const reverse of [false,true])for(const n of [1,2,4,8,16]){const body=sheet(n,{reverse}),features=triangleAdaptiveFeatures(body);assert.equal(features.length,5);assert.deepEqual(features.map(f=>f.halfWidth).sort((a,b)=>a-b),[.0004,.5,.5,.5,.5]);assert.equal(advance(body,[20,0,0]).steps,2);}
});
test('world-equivalent prism geometry uses the same normal approach count regardless of its rigid frame',()=>{
 for(const q of [Qaxis([0,1,0],Math.PI/4),Qaxis([.3,.8,-.1],.73),Qmul(Qaxis([1,0,0],.6),Qaxis([0,0,1],.9))]){
  const a=sheet(4,{q}),b=sheet(4,{q,baked:true}),A=a.boxes().flatMap(b=>b.triangle.triangle.flat()),B=b.boxes().flatMap(b=>b.triangle.triangle.flat());for(let i=0;i<A.length;i++)assert.ok(Math.abs(A[i]-B[i])<1e-14);
  const velocity=Qrotate(q,[0,0,20]);assert.equal(advance(a,velocity).steps,7);assert.equal(advance(b,velocity).steps,7);for(let k=0;k<3;k++)assert.ok(Math.abs(a.p[k]-b.p[k])<1e-13);
 }
});
test('a real open aperture retains the narrow physical strip and is not replaced by a filled hull',()=>{
 const full=advance(sheet(),[40,0,0]);assert.equal(full.steps,3);
 for(const divisions of [1,2,4]){const body=sheet(divisions,{hole:true}),features=triangleAdaptiveFeatures(body),boundary=features.filter(f=>Math.abs(f.normal[0])>.99);assert.ok(boundary.length>=4);for(const f of boundary)assert.ok(Math.abs(f.halfWidth-.025)<1e-12);assert.equal(advance(body,[40,0,0]).steps,14);}
});
test('only exact geometry/topology changes invalidate cold local features, including one ulp and a crack',()=>{
 const body=sheet(8),first=triangleAdaptiveFeatures(body);body.p=[20,3,7];body.q=Qaxis([.2,.7,.3],.4);assert.equal(triangleAdaptiveFeatures(body),first);
 body.shapes[0].triangle[0][0]+=Number.EPSILON;const shifted=triangleAdaptiveFeatures(body);assert.notEqual(shifted,first);assert.equal(triangleAdaptiveFeatures(body),shifted);
 body.shapes[0].thickness*=2;const thick=triangleAdaptiveFeatures(body);assert.notEqual(thick,shifted);
 for(let i=0;i<body.shapes.length;i++)body.shapes[i].geometryNodes=[i*3,i*3+1,i*3+2];const cracked=triangleAdaptiveFeatures(body);assert.notEqual(cracked,thick);assert.ok(cracked.length>thick.length);
});
test('retired zero-area or roundoff-collinear faces and actual source removal have finite empty motion',()=>{
 const body=sheet(),before=triangleAdaptiveFeatures(body);for(const shape of body.shapes)shape.triangle=[[0,0,0],[.5,0,0],[1,Number.EPSILON,0]];const retired=triangleAdaptiveFeatures(body);assert.notEqual(retired,before);assert.equal(retired.length,0);body.v=[20,3,7];body.w=[100,-50,20];assert.equal(triangleAdaptiveMotion(body,1/120),0);body.shapes.length=0;assert.notEqual(triangleAdaptiveFeatures(body),retired);assert.equal(triangleAdaptiveMotion(body,1/120),0);
});
test('the Rodrigues envelope bounds all material feature vertices across small and large angular sweeps',()=>{
 const body=sheet(2,{hole:true,q:Qaxis([.3,.4,.7],.8)});body.v=[2.3,-1.1,.8];body.w=[2.1,-1.3,4.6];const speed=Math.hypot(...body.w),axis=body.w.map(n=>n/speed);
 for(const dt of [1/120,.4,1.2]){const motion=triangleAdaptiveMotion(body,dt);for(const feature of triangleAdaptiveFeatures(body)){const normal=Qrotate(body.q,feature.normal),bound=motion*Math.max(.025,Math.min(.14,feature.halfWidth*.8));for(const p of feature.vertices){const r=Qrotate(body.q,p);for(let sample=0;sample<=64;sample++){const t=dt*sample/64,q=Qaxis(axis,speed*t),moved=Qrotate(q,r).map((n,k)=>n+body.v[k]*t),travel=Math.abs(dot(sub(moved,r),normal));assert.ok(travel<=bound+1e-12,`${travel} > ${bound}`);}}}}
});
test('a thin prism approaching a finite plane retains physical normal coverage in either representation',()=>{
 const q=Qaxis([0,1,0],Math.PI/4),direction=Qrotate(q,[0,0,1]),normal=direction.map(n=>-n),u=Qrotate(q,[1,0,0]),v=Qrotate(q,[0,1,0]);
 for(const baked of [false,true]){const body=sheet(2,{q,baked}),world=new SolidWorld({gravity:[0,0,0]}),planePoint=body.p.map((n,k)=>n+direction[k]*.09);world.add(body);world.addPlane({p:planePoint,n:normal,u,v,hu:2,hv:2});body.v=direction.map(n=>n*20);world.step(1/120);assert.equal(world.metrics.substeps,7);let gap=Infinity;for(const box of body.boxes())for(const p of box.triangle.vertices)gap=Math.min(gap,dot(sub(p,planePoint),normal));assert.ok(gap>=-.006,`physical thin sheet crossed plane by ${gap}`);assert.ok(world.contacts.length>0);}
});
function legacyMotion(body,dt){let motion=0;const len=a=>Math.hypot(...a),add=(a,b)=>a.map((n,k)=>n+b[k]),cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],scale=(a,s)=>a.map(n=>n*s),speed=len(body.w),theta=speed*dt,rotation=speed>0?scale(body.w,1/speed):null,sine=theta>=Math.PI/2?1:Math.sin(theta),cosine=theta>=Math.PI?2:1-Math.cos(theta);for(const box of body.boxes()){const arms=[sub(box.p,body.p),...box.axes],crossed=rotation?arms.map(r=>cross(rotation,r)):[],curved=rotation?arms.map(r=>sub(scale(rotation,dot(rotation,r)),r)):[];for(let axis=0;axis<3;axis++){const n=box.axes[axis],feature=Math.max(.025,Math.min(.14,box.half[axis]*.8));let angular=0;if(rotation)for(let j=0;j<4;j++)angular+=(j===0?1:box.half[j-1])*(sine*Math.abs(dot(crossed[j],n))+cosine*Math.abs(dot(curved[j],n)));motion=Math.max(motion,(Math.abs(dot(body.v,n))*dt+angular)/feature);}}return Math.min(16,Math.max(1,Math.ceil(motion)));}
test('ordinary OBB motion and custom triangle geometry keep the existing path and method behavior',()=>{
 for(let i=0;i<40;i++){const body=new SolidBody({p:[0,10,0],q:Qaxis([.3,.4,.2],i*.13),half:[.1+i*.02,.025+i*.01,.3],mass:1});body.v=[i*.7,-i*.1,2];body.w=[.1*i,.03*i,-.02*i];const expected=legacyMotion(body,1/120),world=new SolidWorld({gravity:[0,0,0]});world.add(body);world.step(1/120);assert.equal(world.metrics.substeps,expected);}
 for(const method of ['point','axes','boxes']){const body=sheet(8),original=body[method];body[method]=function(...args){return original.apply(this,args);};body.v=[20,0,0];const expected=legacyMotion(body,1/120);assert.equal(advance(body,[20,0,0]).steps,expected);}
});
