#!/usr/bin/env node
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {SolidWorld,SolidBody,Qeuler} from '../../dist/physics/compound.js';

// The uncached control is the former dynamic-ray geometry boundary exactly:
// body.boxes() on every query. All broadphase tests and ray math stay shared.
function run(count,moving,cached){
 const world=new SolidWorld(),bodies=[],initial=[];
 for(let i=0;i<count;i++){
  const p=[(i%7)*1.5-5,2,Math.floor(i/7)*1.5-5];initial.push(p);
  bodies.push(world.add(new SolidBody({mass:1,p,q:Qeuler(i*.17),half:[2,2,2],tag:'body:'+i,shapes:Array.from({length:8},(_,n)=>({half:[.3,.2,.3],offset:[(n%3-1)*.4,Math.floor(n/3)*.1,(n%2-.5)*.7],q:Qeuler(n*.1)}))})));
 }
 let builds=0;const native=world.rayBoxes.bind(world);
 world.rayBoxes=body=>{
  if(!cached){builds++;return body.boxes();}
  const old=world.rayBoxCache.get(body)?.boxes,result=native(body);if(result!==old)builds++;return result;
 };
 const query=frame=>{
  if(moving&&frame%4===0)for(let n=0;n<Math.min(5,count);n++){bodies[n].p[0]=initial[n][0]+Math.sin(frame*.015+n)*.08;bodies[n].q=Qeuler((n+frame)*.003,.01,.02);}
  const n=frame%count,p=initial[n];return world.ray([p[0]+.1,10,p[2]+.2],[0,-1,0],40);
 };
 for(let frame=0;frame<64;frame++)query(frame);
 builds=0;const start=performance.now();let hitCount=0,distanceSum=0,pointSum=0;
 for(let frame=64;frame<1064;frame++){const hit=query(frame);if(hit){hitCount++;distanceSum+=hit.t;pointSum+=hit.p[0]+hit.p[1]+hit.p[2];}}
 return{cached,queries:1000,elapsedMs:performance.now()-start,geometryBuilds:builds,hitCount,distanceSum,pointSum};
}
const scenarios=[];
for(const moving of [false,true])for(const bodies of [16,43,128]){
 const before=run(bodies,moving,false),after=run(bodies,moving,true);
 for(const key of ['hitCount','distanceSum','pointSum'])if(before[key]!==after[key])throw new Error(`Ray cache changed ${key} for ${bodies} bodies`);
 scenarios.push({bodies,shapesPerBody:8,movingBodies:moving?5:0,before,after,speedup:before.elapsedMs/after.elapsedMs});
}
const report={version:1,status:'passed',scope:'Isolated compound wheel-ray workload, not authority tick time or game FPS. Mutable poses advance at the same four-ray cadence in both paths.',scenarios};
const output=resolve(import.meta.dirname,'../../artifacts/render-stability');await mkdir(output,{recursive:true});await writeFile(resolve(output,'physics-ray-cache.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
