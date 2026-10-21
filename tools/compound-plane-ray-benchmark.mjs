import {performance} from 'node:perf_hooks';
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {SolidWorld} from '../src/physics/compound.ts';
import {planeRayBeforeWorld} from '../test/fixtures/compound-plane-ray-before.mjs';

// Prototype mode permits measuring the candidate before editing the solver.
// The default always measures the actual production SolidWorld.ray method.
function prototypeRay(origin,dir,maxDistance){
 let best=null;const mx=origin[0]+dir[0]*maxDistance*.5,my=origin[1]+dir[1]*maxDistance*.5,mz=origin[2]+dir[2]*maxDistance*.5,enclosingRadius=maxDistance*.5+1,horizontalRadius=Math.min(enclosingRadius,Math.hypot(dir[0],dir[2])*maxDistance*.5+1);
 const candidates=this.candidates([mx,my,mz],horizontalRadius,enclosingRadius);
 for(let index=0;index<candidates.length;index++){
  const item=candidates[index],dn=dir[0]*item.n[0]+dir[1]*item.n[1]+dir[2]*item.n[2];if(dn>=-1e-8)continue;
  const ox=item.p[0]-origin[0],oy=item.p[1]-origin[1],oz=item.p[2]-origin[2],t=(ox*item.n[0]+oy*item.n[1]+oz*item.n[2])/dn;if(t<0||t>maxDistance||best&&t>=best.t)continue;
  const sx=dir[0]*t,sy=dir[1]*t,sz=dir[2]*t,px=origin[0]+sx,py=origin[1]+sy,pz=origin[2]+sz,dx=px-item.p[0],dy=py-item.p[1],dz=pz-item.p[2];
  if(Math.abs(dx*item.u[0]+dy*item.u[1]+dz*item.u[2])>item.hu+.001||Math.abs(dx*item.v[0]+dy*item.v[1]+dz*item.v[2])>item.hv+.001)continue;
  const p=[px,py,pz];if(item.filter&&!item.filter(p))continue;best={t,p,n:item.n,body:null,tag:item.tag,plane:item};
 }
 return best;
}
function fixture(name){
 const world=new SolidWorld(),planes=[];
 for(let index=0;index<96;index++)planes.push(world.addPlane({p:[(index%12)*2,(index%5)*.1,Math.floor(index/12)*2],hu:name==='indexed-road'?6:.75,hv:.5,tag:'ground-'+index,...(name==='indexed-road'?{filter:p=>Math.abs(p[0]%4)>.125}:{})}));
 if(name==='fixed-finite-misses')world.candidates=()=>planes;
 const queries=Array.from({length:128},(_,index)=>[[name==='fixed-finite-misses'?1000:(index%12)*2+((index*13)%7-3)*.15,5,Math.floor(index/12)%8*2+((index*7)%5-2)*.2],[0,-1,0],10]);
 return{world,queries};
}
const prototype=process.argv.includes('--prototype'),quick=process.argv.includes('--quick'),rounds=quick?3:7,iterations=quick?4000:18000;
const results=[];let checksum=0;
for(const name of ['fixed-finite-misses','indexed-ground','indexed-road']){
 const {world,queries}=fixture(name),candidate=prototype?prototypeRay.bind(world):world.ray.bind(world),before=(...query)=>planeRayBeforeWorld(world,...query),counts={candidates:0,facing:0,inRange:0,insideBounds:0,temporaryArrays:0};
 for(const query of queries){const expected=planeRayBeforeWorld(world,...query,counts),actual=candidate(...query);assert.deepEqual(actual,expected);}
 const timed=fn=>{const start=performance.now();for(let index=0;index<iterations;index++){const hit=fn(...queries[index%queries.length]);checksum+=hit?hit.t+hit.p[0]:0;}return performance.now()-start;};
 for(let warm=0;warm<3;warm++){timed(before);timed(candidate);}
 const baseline=[],optimized=[];
 for(let round=0;round<rounds;round++){if(round%2){optimized.push(timed(candidate));baseline.push(timed(before));}else{baseline.push(timed(before));optimized.push(timed(candidate));}}
 const median=values=>[...values].sort((a,b)=>a-b)[Math.floor(values.length/2)],oldMs=median(baseline),newMs=median(optimized);
 results.push({name,iterations,rounds,baselineMs:baseline,candidateMs:optimized,medianBeforeMs:oldMs,medianAfterMs:newMs,ratio:newMs/oldMs,countsPer128Queries:counts,estimatedCandidateTemporaryArrays:counts.insideBounds,estimatedAvoidedArrays:counts.temporaryArrays-counts.insideBounds});
}
const report={runtime:globalThis.Bun?`Bun ${Bun.version}`:`Node ${process.version}`,mode:prototype?'isolated scalar prototype':'production SolidWorld.ray',method:'Alternating paired warmed CPU-only finite-plane queries; identical ordered candidates, bit-exact hit oracle. Not live FPS or GC pause evidence.',checksum,results};
const output=process.argv.find(argument=>argument.startsWith('--output='))?.slice('--output='.length);if(output)writeFileSync(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
