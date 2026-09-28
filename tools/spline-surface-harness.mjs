import {performance} from 'node:perf_hooks';
import {tessellateSurface,normalVariation} from '../dist/geometry/parametric-surface.js';

const wheel={x:1.5365,y:.346,r:.346},clearance=.034,archR=wheel.r+clearance;
const lerp=(a,b,t)=>a+(b-a)*t;
const smooth=t=>t*t*(3-2*t);

/** Semantic fender surface: wheel relationship is authoritative, not sampled vertices. */
const fender={
 id:'m3/front-fender-left',
 point(u,v){
   const z=lerp(wheel.x-archR*1.38,wheel.x+archR*1.38,u),dz=(z-wheel.x)/archR;
   const arch=wheel.y+Math.sqrt(Math.max(0,archR*archR-Math.min(1,dz*dz)*archR*archR));
   const shoulder=.88+.055*Math.exp(-dz*dz*1.2),y=lerp(arch+.004,shoulder,v);
   const flare=.034*Math.exp(-dz*dz)*Math.sin(Math.PI*v),x=.944+flare+.048*Math.exp(-dz*dz*.75)*smooth(v);
   return [x,y,z];
 }
};
const fixed=(nu,nv)=>{
 const positions=[],indices=[];for(let j=0;j<=nv;j++)for(let i=0;i<=nu;i++)positions.push(...fender.point(i/nu,j/nv));
 for(let j=0;j<nv;j++)for(let i=0;i<nu;i++){const a=j*(nu+1)+i,b=a+1,d=a+nu+1,c=d+1;indices.push(a,b,c,a,c,d);}return{positions,indices};
};
const bench=fn=>{for(let i=0;i<20;i++)fn();const a=[];for(let i=0;i<101;i++){const t=performance.now();fn();a.push(performance.now()-t);}a.sort((a,b)=>a-b);return a[50];};
const reference=tessellateSurface(fender,{errorM:.00015,maxDepth:8});
const rows=[];
for(const errorM of [.008,.004,.002,.001,.0005]){
 const mesh=tessellateSurface(fender,{errorM,maxDepth:8});
 rows.push({errorM,triangles:mesh.indices.length/3,vertices:mesh.positions.length/3,patches:mesh.patches,medianMs:bench(()=>tessellateSurface(fender,{errorM,maxDepth:8}))});
}
const legacy=fixed(16,4),fine=fixed(64,16);
const report={surface:'m3/front-fender-left',relationship:{wheelRadiusM:wheel.r,clearanceM:clearance,archRadiusM:archR},normalVariation:normalVariation(fender),referenceTriangles:reference.indices.length/3,legacy:{triangles:legacy.indices.length/3,medianMs:bench(()=>fixed(16,4))},fine:{triangles:fine.indices.length/3,medianMs:bench(()=>fixed(64,16))},adaptive:rows,sourceControlScalars:8};
console.log(JSON.stringify(report,null,2));
